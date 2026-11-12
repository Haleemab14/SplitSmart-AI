const crypto = require("crypto");
const db = require("../database/db");
const { getGroupLedger } = require("./ledger");
const paypal = require("./paypalService");

const PREPARE_TOOLS = new Set([
    "prepare_expense_creation",
    "prepare_expense_update",
    "prepare_group_creation",
    "prepare_settlement",
    "prepare_paypal_payment",
    "prepare_payment_request",
    "prepare_receipt_processing",
    "prepare_notification"
]);

function money(cents) {
    const amount = Number.isInteger(cents) ? cents : Math.round(Number(cents) || 0);
    const sign = amount < 0 ? "-" : "";
    const absolute = Math.abs(amount);
    return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function clip(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function dollarsToCents(value) {
    const text = String(value ?? "").replace(/[$,\s]/g, "");
    const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);

    if (!match) {
        return null;
    }

    return (Number(match[1]) * 100) + Number((match[2] || "").padEnd(2, "0"));
}

function detectCategory(description) {
    const text = String(description || "").toLowerCase();

    if (/restaurant|food|pizza|burger|coffee|cafe|lunch|dinner|breakfast|meal|snack|drink|grocery|groceries|supermarket/.test(text)) {
        return "Food";
    }

    if (/uber|taxi|bus|train|metro|fuel|petrol|parking|transport|flight|travel/.test(text)) {
        return "Transport";
    }

    if (/movie|cinema|game|concert|party|netflix|entertainment|museum/.test(text)) {
        return "Entertainment";
    }

    if (/shirt|shoes|clothes|shopping|store|mall|jacket|dress/.test(text)) {
        return "Shopping";
    }

    if (/hotel|hostel|airbnb|accommodation|rent/.test(text)) {
        return "Accommodation";
    }

    if (/electricity|water bill|internet|wifi|gas bill|utility/.test(text)) {
        return "Utilities";
    }

    if (/medicine|pharmacy|doctor|medical|hospital/.test(text)) {
        return "Health";
    }

    return "Other";
}

const { userCanAccessGroup } = require("./groupAccess");

function ownedGroup(userId, groupId) {
    return db.prepare(`
        SELECT id, name
        FROM groups
        WHERE id = ? AND owner_id = ?
    `).get(groupId, userId) || null;
}

function accessibleGroup(userId, groupId) {
    if (!userCanAccessGroup(groupId, userId)) return null;

    return db.prepare(`
        SELECT id, name
        FROM groups
        WHERE id = ?
    `).get(groupId) || null;
}

function resolveGroup(userId, args, fallbackGroupId, access = "read") {
    const requestedId = Number(args?.groupId);
    const requestedName = clip(args?.groupName, 100);
    const findById = access === "own" ? ownedGroup : accessibleGroup;

    if (Number.isInteger(requestedId) && requestedId > 0) {
        const group = findById(userId, requestedId);
        return group || { error: "Group not found." };
    }

    if (requestedName) {
        const matches = db.prepare(`
            SELECT g.id, g.name
            FROM groups g
            WHERE g.name = ? COLLATE NOCASE
              AND (
                  (? = 'own' AND g.owner_id = ?)
                  OR (? = 'read' AND (
                      g.owner_id = ?
                      OR EXISTS (
                          SELECT 1
                          FROM group_member_identity i
                          WHERE i.group_id = g.id AND i.user_id = ?
                      )
                  ))
              )
        `).all(requestedName, access, userId, access, userId, userId);

        if (matches.length === 1) {
            return matches[0];
        }

        return { error: matches.length ? "That group name matches more than one group." : "Group not found." };
    }

    if (Number.isInteger(fallbackGroupId) && fallbackGroupId > 0) {
        const group = findById(userId, fallbackGroupId);
        return group || { error: "Group not found." };
    }

    const groups = db.prepare(`
        SELECT g.id, g.name
        FROM groups g
        WHERE (? = 'own' AND g.owner_id = ?)
           OR (? = 'read' AND (
               g.owner_id = ?
               OR EXISTS (
                   SELECT 1
                   FROM group_member_identity i
                   WHERE i.group_id = g.id AND i.user_id = ?
               )
           ))
        ORDER BY g.id
    `).all(access, userId, access, userId, userId);

    if (groups.length === 1) {
        return groups[0];
    }

    return { error: "Tell Finny which group to use." };
}

function activeMembers(groupId) {
    return db.prepare(`
        SELECT id, name
        FROM members
        WHERE group_id = ? AND is_active = 1
        ORDER BY name COLLATE NOCASE
    `).all(groupId);
}

function findMember(groupId, name) {
    const wanted = clip(name, 60).toLowerCase();

    if (!wanted) {
        return null;
    }

    const matches = activeMembers(groupId).filter(member =>
        member.name.toLowerCase() === wanted
    );

    return matches.length === 1 ? matches[0] : null;
}

function myMember(userId, groupId) {
    const row = db.prepare(`
        SELECT m.id, m.name
        FROM group_member_identity g
        JOIN members m ON m.id = g.member_id
        WHERE g.user_id = ? AND g.group_id = ? AND m.group_id = ?
    `).get(userId, groupId, groupId);

    return row || null;
}

function balanceView(member) {
    return {
        name: member.name,
        position: member.balance > 0 ? "should receive" : member.balance < 0 ? "owes" : "settled",
        amount: money(Math.abs(member.balance)),
        amountCents: member.balance
    };
}

function stageAction(userId, groupId, toolName, summary, payload, details) {
    const encoded = JSON.stringify(payload);
    const existing = db.prepare(`
        SELECT id
        FROM finny_actions
        WHERE user_id = ? AND tool_name = ? AND status = 'pending' AND payload_json = ?
        ORDER BY created_at DESC
        LIMIT 1
    `).get(userId, toolName, encoded);

    const actionId = existing?.id || crypto.randomUUID();

    if (!existing) {
        db.prepare(`
            INSERT INTO finny_actions (
                id, user_id, group_id, tool_name, status, summary, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)
        `).run(actionId, userId, groupId || null, toolName, summary, encoded);
    }

    return {
        ok: true,
        needsApproval: true,
        action: {
            id: actionId,
            tool: toolName,
            status: "pending",
            title: summary,
            details
        }
    };
}

function getMyGroups(userId) {
    const groups = db.prepare(`
        SELECT g.id, g.name
        FROM groups g
        WHERE g.owner_id = ?
           OR EXISTS (
               SELECT 1
               FROM group_member_identity i
               WHERE i.group_id = g.id AND i.user_id = ?
           )
        ORDER BY g.name COLLATE NOCASE
    `).all(userId, userId);

    return {
        ok: true,
        groups: groups.map(group => ({
            groupId: group.id,
            name: group.name,
            members: activeMembers(group.id).map(member => member.name)
        }))
    };
}

function getGroupBalances(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const ledger = getGroupLedger(group.id);
    const identity = myMember(userId, group.id);

    return {
        ok: true,
        group: group.name,
        groupId: group.id,
        myMember: identity?.name || null,
        balances: ledger.balances.map(balanceView),
        note: "Quote these ledger balances exactly. Do not recompute them."
    };
}

function getOutstandingSettlements(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const ledger = getGroupLedger(group.id);
    const identity = myMember(userId, group.id);
    const settlements = ledger.settlements.map(item => ({
        from: item.from,
        to: item.to,
        amount: money(item.amountCents),
        amountCents: item.amountCents,
        currency: "USD",
        direction: !identity
            ? "group"
            : item.fromId === identity.id
                ? "you pay"
                : item.toId === identity.id
                    ? "you receive"
                    : "other members"
    }));

    return {
        ok: true,
        group: group.name,
        groupId: group.id,
        myMember: identity?.name || null,
        settlements,
        note: identity
            ? "Directions use the member linked to this login. Amounts are unpaid ledger suggestions."
            : "This login is not linked to a member, so every outstanding settlement is listed."
    };
}

function getExpenseHistory(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const limit = Math.min(Math.max(Number(args?.limit) || 8, 1), 20);
    const rows = db.prepare(`
        SELECT e.description, e.amount_cents, m.name AS payer_name, e.created_at
        FROM expenses e
        JOIN members m ON m.id = e.payer_id
        WHERE e.group_id = ?
        ORDER BY e.id DESC
        LIMIT ?
    `).all(group.id, limit);

    return {
        ok: true,
        group: group.name,
        expenses: rows.map(row => ({
            description: clip(row.description, 80),
            amount: money(row.amount_cents),
            paidBy: row.payer_name,
            createdAt: row.created_at
        }))
    };
}

function getSpendingSummary(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const totals = db.prepare(`
        SELECT COUNT(id) AS count, COALESCE(SUM(amount_cents), 0) AS total
        FROM expenses
        WHERE group_id = ?
    `).get(group.id);
    const count = Number(totals.count) || 0;
    const total = Number(totals.total) || 0;

    return {
        ok: true,
        group: group.name,
        expenseCount: count,
        totalSpent: money(total),
        averageExpense: money(count ? Math.floor(total / count) : 0),
        note: "The average is whole cents from the ledger total. Do not invent another total."
    };
}

function getSpendingByCategory(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const rows = db.prepare(`
        SELECT description, amount_cents
        FROM expenses
        WHERE group_id = ?
    `).all(group.id);
    const categories = new Map();

    rows.forEach(row => {
        const name = detectCategory(row.description);
        const current = categories.get(name) || { name, totalCents: 0, count: 0 };
        current.totalCents += Number(row.amount_cents) || 0;
        current.count += 1;
        categories.set(name, current);
    });

    return {
        ok: true,
        group: group.name,
        categories: [...categories.values()]
            .sort((a, b) => b.totalCents - a.totalCents)
            .map(category => ({
                name: category.name,
                total: money(category.totalCents),
                count: category.count
            }))
    };
}

function searchExpenses(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const query = clip(args?.query, 80).replace(/[%_\\]/g, "");

    if (query.length < 2) {
        return { ok: false, error: "Use a search word of at least 2 characters." };
    }

    const rows = db.prepare(`
        SELECT e.description, e.amount_cents, m.name AS payer_name
        FROM expenses e
        JOIN members m ON m.id = e.payer_id
        WHERE e.group_id = ? AND e.description LIKE ? COLLATE NOCASE
        ORDER BY e.id DESC
        LIMIT 20
    `).all(group.id, `%${query}%`);

    return {
        ok: true,
        group: group.name,
        query,
        expenses: rows.map(row => ({
            description: clip(row.description, 80),
            amount: money(row.amount_cents),
            paidBy: row.payer_name
        }))
    };
}

function getPaymentHistory(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId);

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const notes = db.prepare(`
        SELECT sr.amount_cents, sr.status, sr.created_at, sender.name AS payer, receiver.name AS recipient
        FROM ss_settlement_records sr
        JOIN members sender ON sender.id = sr.from_member_id
        JOIN members receiver ON receiver.id = sr.to_member_id
        WHERE sr.group_id = ?
        ORDER BY sr.id DESC
        LIMIT 20
    `).all(group.id);

    const captured = db.prepare(`
        SELECT p.amount_cents, p.currency, p.paypal_capture_id, p.captured_at,
               sender.name AS payer, receiver.name AS recipient
        FROM payments p
        JOIN members sender ON sender.id = p.payer_id
        JOIN members receiver ON receiver.id = p.payee_id
        WHERE p.group_id = ? AND p.status = 'COMPLETED'
        ORDER BY p.id DESC
        LIMIT 20
    `).all(group.id);

    return {
        ok: true,
        group: group.name,
        records: notes.map(row => ({
            payer: row.payer,
            recipient: row.recipient,
            amount: money(row.amount_cents),
            status: row.status,
            createdAt: row.created_at,
            changesBalances: row.status === "paid"
        })),
        verifiedPayPalCaptures: captured.map(row => ({
            payer: row.payer,
            recipient: row.recipient,
            amount: money(row.amount_cents),
            currency: row.currency || "USD",
            reference: row.paypal_capture_id,
            capturedAt: row.captured_at
        })),
        note: "Only status paid changes balances. A missing PayPal reference means the payment is not verified."
    };
}

function prepareExpenseCreation(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "own");

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const description = clip(args?.description, 120);
    const amountCents = dollarsToCents(args?.amount);
    const payer = findMember(group.id, args?.payerName || args?.paidBy);

    if (!description || description.length < 2) {
        return { ok: false, error: "The expense needs a description." };
    }

    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
        return { ok: false, error: "The expense needs a valid USD amount." };
    }

    if (!payer) {
        return { ok: false, error: "Name one active member who paid this expense." };
    }

    const memberCount = activeMembers(group.id).length;
    const payload = {
        groupId: group.id,
        description,
        amountCents,
        payerId: payer.id,
        payerName: payer.name
    };

    return stageAction(
        userId,
        group.id,
        "prepare_expense_creation",
        `Add expense “${description}”`,
        payload,
        [
            { label: "Group", value: group.name },
            { label: "Description", value: description },
            { label: "Amount", value: money(amountCents) },
            { label: "Currency", value: "USD" },
            { label: "Paid by", value: payer.name },
            { label: "Split", value: `Equal split across ${memberCount} active members` },
            { label: "Effect", value: "Nothing is saved until you approve." }
        ]
    );
}

function prepareExpenseUpdate(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "own");

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const description = clip(args?.description, 120);
    const amountCents = dollarsToCents(args?.amount);
    let expense = null;

    if (Number.isInteger(Number(args?.expenseId)) && Number(args.expenseId) > 0) {
        expense = db.prepare(`
            SELECT id, description, amount_cents, payer_id
            FROM expenses
            WHERE id = ? AND group_id = ?
        `).get(Number(args.expenseId), group.id);
    } else if (clip(args?.currentDescription, 120)) {
        const matches = db.prepare(`
            SELECT id, description, amount_cents, payer_id
            FROM expenses
            WHERE group_id = ? AND description = ? COLLATE NOCASE
        `).all(group.id, clip(args.currentDescription, 120));
        expense = matches.length === 1 ? matches[0] : null;

        if (matches.length > 1) {
            return { ok: false, error: "More than one expense has that description." };
        }
    }

    if (!expense) {
        return { ok: false, error: "That expense was not found in this group." };
    }

    const itemized = db.prepare(`
        SELECT id FROM receipt_items WHERE expense_id = ? LIMIT 1
    `).get(expense.id);

    if (itemized) {
        return { ok: false, error: "Itemized receipt expenses must be edited from the receipt page." };
    }

    const payer = args?.payerName || args?.paidBy
        ? findMember(group.id, args.payerName || args.paidBy)
        : activeMembers(group.id).find(member => member.id === expense.payer_id);

    if (!payer) {
        return { ok: false, error: "Name an active member who paid." };
    }

    if (!description || !Number.isInteger(amountCents) || amountCents < 1 || amountCents > 100000000) {
        return { ok: false, error: "The update needs a description and a valid USD amount." };
    }

    const currentPayer = activeMembers(group.id).find(member => member.id === expense.payer_id);

    return stageAction(
        userId,
        group.id,
        "prepare_expense_update",
        `Update expense “${expense.description}”`,
        {
            groupId: group.id,
            expenseId: expense.id,
            description,
            amountCents,
            payerId: payer.id,
            payerName: payer.name
        },
        [
            { label: "Group", value: group.name },
            { label: "Current", value: `${expense.description} · ${money(expense.amount_cents)} · ${currentPayer?.name || "Unknown"}` },
            { label: "New description", value: description },
            { label: "New amount", value: money(amountCents) },
            { label: "Paid by", value: payer.name },
            { label: "Effect", value: "The expense stays unchanged until you approve." }
        ]
    );
}

function prepareGroupCreation(userId, args) {
    const name = clip(args?.name, 100);
    const members = Array.isArray(args?.members)
        ? args.members.map(member => clip(member, 60)).filter(Boolean)
        : [];

    if (!name || name.length < 2 || members.length < 1 || members.length > 20) {
        return { ok: false, error: "A group needs a name and 1 to 20 member names." };
    }

    if (new Set(members.map(member => member.toLowerCase())).size !== members.length) {
        return { ok: false, error: "Member names must be unique." };
    }

    return stageAction(
        userId,
        null,
        "prepare_group_creation",
        `Create group “${name}”`,
        { name, members },
        [
            { label: "Name", value: name },
            { label: "Members", value: members.join(", ") },
            { label: "Effect", value: "The group is created only after you approve." }
        ]
    );
}

function settlementPair(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "own");

    if (group.error) {
        return { error: group.error };
    }

    const from = findMember(group.id, args?.fromName || args?.payer);
    const to = findMember(group.id, args?.toName || args?.recipient);

    if (!from || !to || from.id === to.id) {
        return { error: "Name the two members exactly as they appear in the group." };
    }

    const match = getGroupLedger(group.id).settlements.find(item =>
        item.fromId === from.id && item.toId === to.id
    );

    if (!match) {
        return { error: "The ledger has no outstanding settlement for that pair." };
    }

    return { group, from, to, amountCents: match.amountCents };
}

function prepareSettlement(userId, args, fallbackGroupId) {
    const pair = settlementPair(userId, args, fallbackGroupId);

    if (pair.error) {
        return { ok: false, error: pair.error };
    }

    return stageAction(
        userId,
        pair.group.id,
        "prepare_settlement",
        `${pair.from.name} notes ${money(pair.amountCents)} to ${pair.to.name}`,
        {
            groupId: pair.group.id,
            fromId: pair.from.id,
            toId: pair.to.id,
            fromName: pair.from.name,
            toName: pair.to.name,
            amountCents: pair.amountCents,
            currency: "USD"
        },
        [
            { label: "Group", value: pair.group.name },
            { label: "From", value: pair.from.name },
            { label: "To", value: pair.to.name },
            { label: "Amount", value: money(pair.amountCents) },
            { label: "Currency", value: "USD" },
            { label: "Effect", value: "Approval saves an unpaid note. Balances do not change and no PayPal payment is sent." }
        ]
    );
}

function preparePaypalPayment(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "read");

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const from = findMember(group.id, args?.fromName || args?.payer);
    const to = findMember(group.id, args?.toName || args?.recipient);
    const match = from && to
        ? getGroupLedger(group.id).settlements.find(item =>
            item.fromId === from.id && item.toId === to.id
        )
        : null;

    if (!from || !to || !match) {
        return { ok: false, error: "The ledger has no outstanding settlement for that pair." };
    }

    const me = myMember(userId, group.id);

    if (!me || me.id !== from.id) {
        return {
            ok: false,
            error: `Only ${from.name}'s linked account can pay ${to.name} ${money(match.amountCents)}. The payment request is on that member's dashboard.`
        };
    }

    if (!paypal.paypalEnabled()) {
        return { ok: false, error: "PayPal Sandbox is not configured." };
    }

    return stageAction(
        userId,
        group.id,
        "prepare_paypal_payment",
        `Pay ${to.name} ${money(match.amountCents)}`,
        {
            groupId: group.id,
            groupName: group.name,
            fromId: from.id,
            toId: to.id,
            fromName: from.name,
            toName: to.name,
            amountCents: match.amountCents,
            currency: "USD"
        },
        [
            { label: "Group", value: group.name },
            { label: "From", value: from.name },
            { label: "To", value: to.name },
            { label: "Amount", value: money(match.amountCents) },
            { label: "Currency", value: "USD" },
            { label: "Effect", value: "Approval opens PayPal Sandbox. The settlement stays unpaid until PayPal capture is verified." }
        ]
    );
}

function preparePaymentRequest(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "read");

    if (group.error) {
        return { ok: false, error: group.error };
    }

    const from = findMember(group.id, args?.fromName || args?.payer);
    const me = myMember(userId, group.id);
    const match = from
        ? getGroupLedger(group.id).settlements.find(item =>
            item.fromId === from.id && (!me || item.toId === me.id || item.fromId === me.id)
        )
        : null;

    if (!from || !match || !me) {
        return { ok: false, error: "The ledger has no outstanding payment request for your linked member." };
    }

    if (me.id === match.fromId) {
        const requests = require("./paymentRequests");
        const open = requests.dashboardForUser(userId).payables.find(item =>
            item.groupId === group.id && item.request && item.request.status === "pending"
        );
        const reference = open?.request?.reference;
        return {
            ok: true,
            message: reference
                ? `Open challan.html?ref=${reference} and choose Pay Now. The amount is ${money(match.amountCents)} and it stays unpaid until PayPal verifies the capture.`
                : `Your payment of ${money(match.amountCents)} to ${match.to} is outstanding. Open the dashboard payment requests and choose Pay Now.`
        };
    }

    if (me.id !== match.toId) {
        return { ok: false, error: "Only the member who is owed this amount can prepare the payment request." };
    }

    return stageAction(
        userId,
        group.id,
        "prepare_payment_request",
        `Request ${money(match.amountCents)} from ${from.name}`,
        {
            groupId: group.id,
            groupName: group.name,
            fromMemberId: from.id,
            fromName: from.name,
            toName: match.to,
            amountCents: match.amountCents
        },
        [
            { label: "Group", value: group.name },
            { label: "From", value: from.name },
            { label: "To", value: match.to },
            { label: "Amount", value: money(match.amountCents) },
            { label: "Effect", value: "Approval creates a pending payment request. It does not mark anything paid." }
        ]
    );
}

function getMyPaymentRequests(userId) {
    const data = require("./paymentRequests").dashboardForUser(userId);

    return {
        ok: true,
        owe: data.payables.map(item => ({
            group: item.groupName,
            to: item.memberName,
            amount: money(item.amountCents),
            status: item.request ? item.request.status : "pending",
            reference: item.request ? item.request.reference : null,
            challan: item.request ? `challan.html?ref=${item.request.reference}` : null
        })),
        owed: data.receivables.map(item => ({
            group: item.groupName,
            from: item.memberName,
            amount: money(item.amountCents),
            status: item.request ? item.request.status : "pending",
            reference: item.request ? item.request.reference : null,
            delivery: item.request ? item.request.delivery : "undeliverable"
        })),
        verified: (data.recentlyPaid || []).filter(item => item.captureId).map(item => ({
            direction: item.direction,
            payer: item.payerName,
            recipient: item.payeeName,
            amount: money(item.amountCents),
            captureId: item.captureId
        })),
        note: "Quote these ledger amounts exactly. Pending is unpaid. Do not mark a payment paid."
    };
}

function prepareReceiptProcessing(userId, args, fallbackGroupId) {
    const group = resolveGroup(userId, args, fallbackGroupId, "own");

    if (group.error) {
        return { ok: false, error: group.error };
    }

    return stageAction(
        userId,
        group.id,
        "prepare_receipt_processing",
        `Open receipt scanning for ${group.name}`,
        { groupId: group.id, groupName: group.name },
        [
            { label: "Group", value: group.name },
            { label: "Effect", value: "Approval opens the receipt scanner. No expense is created from this chat." }
        ]
    );
}

function prepareNotification(userId, args, fallbackGroupId) {
    const title = clip(args?.title, 80);
    const message = clip(args?.message, 280);
    const group = args?.groupId || args?.groupName
        ? resolveGroup(userId, args, fallbackGroupId, "own")
        : null;

    if (group?.error) {
        return { ok: false, error: group.error };
    }

    if (!title || !message) {
        return { ok: false, error: "A reminder needs a title and a message." };
    }

    return stageAction(
        userId,
        group?.id || null,
        "prepare_notification",
        title,
        {
            groupId: group?.id || null,
            title,
            message
        },
        [
            { label: "Title", value: title },
            { label: "Message", value: message },
            { label: "Delivery", value: "In-app only. No email or text message is sent." },
            { label: "Effect", value: "The reminder is saved only after you approve." }
        ]
    );
}

function runTool(userId, name, args, fallbackGroupId) {
    const input = args && typeof args === "object" ? args : {};

    switch (name) {
        case "get_my_groups":
            return getMyGroups(userId);
        case "get_group_balances":
            return getGroupBalances(userId, input, fallbackGroupId);
        case "get_outstanding_settlements":
            return getOutstandingSettlements(userId, input, fallbackGroupId);
        case "get_expense_history":
            return getExpenseHistory(userId, input, fallbackGroupId);
        case "get_spending_summary":
            return getSpendingSummary(userId, input, fallbackGroupId);
        case "get_spending_by_category":
            return getSpendingByCategory(userId, input, fallbackGroupId);
        case "search_expenses":
            return searchExpenses(userId, input, fallbackGroupId);
        case "get_payment_history":
            return getPaymentHistory(userId, input, fallbackGroupId);
        case "get_my_payment_requests":
            return getMyPaymentRequests(userId);
        case "prepare_expense_creation":
            return prepareExpenseCreation(userId, input, fallbackGroupId);
        case "prepare_expense_update":
            return prepareExpenseUpdate(userId, input, fallbackGroupId);
        case "prepare_group_creation":
            return prepareGroupCreation(userId, input);
        case "prepare_settlement":
            return prepareSettlement(userId, input, fallbackGroupId);
        case "prepare_paypal_payment":
            return preparePaypalPayment(userId, input, fallbackGroupId);
        case "prepare_payment_request":
            return preparePaymentRequest(userId, input, fallbackGroupId);
        case "prepare_receipt_processing":
            return prepareReceiptProcessing(userId, input, fallbackGroupId);
        case "prepare_notification":
            return prepareNotification(userId, input, fallbackGroupId);
        default:
            return { ok: false, error: "That tool is not available." };
    }
}

function writeShares(expenseId, amountCents, members) {
    const baseShare = Math.floor(amountCents / members.length);
    const remainder = amountCents % members.length;
    const insertShare = db.prepare(`
        INSERT INTO expense_shares (expense_id, member_id, amount_cents)
        VALUES (?, ?, ?)
    `);

    members.forEach((member, index) => {
        insertShare.run(
            expenseId,
            member.id,
            baseShare + (index < remainder ? 1 : 0)
        );
    });
}

function executePayload(userId, action) {
    const payload = JSON.parse(action.payload_json);

    if (action.tool_name === "prepare_expense_creation") {
        const group = ownedGroup(userId, payload.groupId);
        const members = group ? activeMembers(group.id) : [];

        if (!group || !members.some(member => member.id === payload.payerId)) {
            throw new Error("The expense is no longer valid for this group.");
        }

        const expenseId = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO expenses (group_id, description, amount_cents, payer_id)
                VALUES (?, ?, ?, ?)
            `).run(payload.groupId, payload.description, payload.amountCents, payload.payerId);
            writeShares(Number(result.lastInsertRowid), payload.amountCents, members);
            return Number(result.lastInsertRowid);
        })();

        return { expenseId, message: "Expense saved." };
    }

    if (action.tool_name === "prepare_expense_update") {
        const group = ownedGroup(userId, payload.groupId);
        const expense = group && db.prepare(`
            SELECT id FROM expenses WHERE id = ? AND group_id = ?
        `).get(payload.expenseId, payload.groupId);
        const members = group ? activeMembers(group.id) : [];

        if (!expense || !members.some(member => member.id === payload.payerId)) {
            throw new Error("The expense update is no longer valid.");
        }

        db.transaction(() => {
            db.prepare(`
                UPDATE expenses
                SET description = ?, amount_cents = ?, payer_id = ?
                WHERE id = ? AND group_id = ?
            `).run(
                payload.description,
                payload.amountCents,
                payload.payerId,
                payload.expenseId,
                payload.groupId
            );
            db.prepare(`DELETE FROM expense_shares WHERE expense_id = ?`).run(payload.expenseId);
            writeShares(payload.expenseId, payload.amountCents, members);
        })();

        return { expenseId: payload.expenseId, message: "Expense updated." };
    }

    if (action.tool_name === "prepare_group_creation") {
        const groupId = db.transaction(() => {
            const group = db.prepare(`
                INSERT INTO groups (name, owner_id) VALUES (?, ?)
            `).run(payload.name, userId);
            const id = Number(group.lastInsertRowid);
            const addMember = db.prepare(`
                INSERT INTO members (group_id, name) VALUES (?, ?)
            `);
            payload.members.forEach(member => addMember.run(id, member));
            return id;
        })();

        return { groupId, message: "Group created." };
    }

    if (action.tool_name === "prepare_settlement") {
        const fresh = settlementPair(userId, {
            groupId: payload.groupId,
            fromName: payload.fromName,
            toName: payload.toName
        }, payload.groupId);

        if (fresh.error || fresh.amountCents !== payload.amountCents) {
            throw new Error("That settlement changed. Ask Finny to prepare it again.");
        }

        const settlementId = db.prepare(`
            INSERT INTO ss_settlement_records (
                group_id, from_member_id, to_member_id, amount_cents, status
            )
            VALUES (?, ?, ?, ?, 'demo-noted')
        `).run(payload.groupId, payload.fromId, payload.toId, payload.amountCents)
            .lastInsertRowid;

        return {
            settlementId: Number(settlementId),
            message: "Unpaid note saved. Balances are unchanged."
        };
    }

    if (action.tool_name === "prepare_notification") {
        const result = db.prepare(`
            INSERT INTO finny_notifications (
                user_id, group_id, kind, title, body, currency
            )
            VALUES (?, ?, 'reminder', ?, ?, 'USD')
        `).run(userId, payload.groupId, payload.title, payload.message);

        return {
            notificationId: Number(result.lastInsertRowid),
            message: "Reminder saved in SplitSmart. No external message was sent."
        };
    }

    if (action.tool_name === "prepare_payment_request") {
        const requests = require("./paymentRequests");
        const dashboard = requests.generateForUser(userId, {
            force: true,
            groupId: payload.groupId,
            fromMemberId: payload.fromMemberId
        });
        const created = dashboard.receivables.find(item =>
            item.groupId === payload.groupId &&
            item.memberId === payload.fromMemberId &&
            item.request
        );

        return {
            reference: created?.request?.reference || null,
            message: created?.request?.reference
                ? `Payment request ${created.request.reference} is pending. It is not paid.`
                : "No outstanding amount was available to request."
        };
    }

    if (action.tool_name === "prepare_receipt_processing") {
        if (!ownedGroup(userId, payload.groupId)) {
            throw new Error("Group not found.");
        }

        return {
            navigate: `/receipt.html?group=${payload.groupId}`,
            message: "Open the receipt scanner to process a receipt. No expense was created."
        };
    }

    throw new Error("This action cannot be executed.");
}

async function executePaypal(userId, payload, urls) {
    const returnUrl = urls && urls.returnUrl;
    const cancelUrl = urls && urls.cancelUrl;
    const deployedHttps = typeof returnUrl === "string" &&
        returnUrl.startsWith("https://") &&
        typeof cancelUrl === "string" &&
        cancelUrl.startsWith("https://") &&
        !/localhost|127\.0\.0\.1/i.test(returnUrl) &&
        !/localhost|127\.0\.0\.1/i.test(cancelUrl);

    if (process.env.NODE_ENV === "production" && !deployedHttps) {
        throw new Error("PayPal Sandbox needs the deployed HTTPS address.");
    }

    if (!returnUrl || !cancelUrl) {
        throw new Error("PayPal Sandbox needs the deployed HTTPS address.");
    }

    const checkout = require("./paypalCheckout");
    const outcome = await checkout.startSettlementCheckout({
        userId,
        groupId: payload.groupId,
        fromId: payload.fromId,
        toId: payload.toId,
        returnUrl,
        cancelUrl
    });

    if (!outcome.body.success) {
        throw new Error(outcome.body.message || "PayPal Sandbox checkout could not start.");
    }

    if (outcome.body.next === "capture") {
        return {
            message: "PayPal has approved this order. Open the payment request and finish capture there. It is not marked paid yet.",
            groupId: payload.groupId,
            amountCents: outcome.body.amountCents,
            currency: "USD"
        };
    }

    return {
        orderId: outcome.body.orderId,
        groupId: payload.groupId,
        groupName: payload.groupName,
        payer: outcome.body.payer || payload.fromName,
        payee: outcome.body.payee || payload.toName,
        amountCents: outcome.body.amountCents,
        currency: "USD",
        message: "Sandbox order ready. Approve it in PayPal. The settlement is still unpaid."
    };
}

function publicAction(action, result) {
    let details = [];

    try {
        const payload = JSON.parse(action.payload_json);
        details = [
            payload.groupName ? { label: "Group", value: payload.groupName } : null,
            payload.fromName ? { label: "From", value: payload.fromName } : null,
            payload.toName ? { label: "To", value: payload.toName } : null,
            Number.isInteger(payload.amountCents)
                ? { label: "Amount", value: money(payload.amountCents) }
                : null,
            payload.currency ? { label: "Currency", value: payload.currency } : null
        ].filter(Boolean);
    } catch (error) {
        details = [];
    }

    return {
        id: action.id,
        tool: action.tool_name,
        status: action.status,
        title: action.summary,
        details,
        result: result || null
    };
}

async function approveAction(userId, actionId, checkoutUrlBuilder) {
    const id = clip(actionId, 80);
    const action = db.prepare(`
        SELECT * FROM finny_actions WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!action) {
        return { status: 404, body: { success: false, message: "Action not found." } };
    }

    if (action.status === "executed" || action.status === "awaiting_paypal") {
        return {
            status: 200,
            body: {
                success: true,
                already: true,
                action: publicAction(action, action.result_json ? JSON.parse(action.result_json) : null)
            }
        };
    }

    if (action.status !== "pending") {
        return { status: 409, body: { success: false, message: "This action is no longer waiting for approval." } };
    }

    const claimed = db.prepare(`
        UPDATE finny_actions
        SET status = 'executing', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'pending'
    `).run(id, userId);

    if (claimed.changes !== 1) {
        return { status: 409, body: { success: false, message: "This action was already handled." } };
    }

    try {
        const payload = JSON.parse(action.payload_json);
        const result = action.tool_name === "prepare_paypal_payment"
            ? await executePaypal(
                userId,
                payload,
                typeof checkoutUrlBuilder === "function" ? checkoutUrlBuilder() : null
            )
            : executePayload(userId, action);
        const status = action.tool_name === "prepare_paypal_payment"
            ? "awaiting_paypal"
            : "executed";

        db.prepare(`
            UPDATE finny_actions
            SET status = ?, result_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND status = 'executing'
        `).run(status, JSON.stringify(result), id, userId);

        return {
            status: 200,
            body: {
                success: true,
                action: {
                    ...publicAction({ ...action, status }, result),
                    result
                }
            }
        };
    } catch (error) {
        db.prepare(`
            UPDATE finny_actions
            SET status = 'failed', result_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND status = 'executing'
        `).run(JSON.stringify({ message: error.message }), id, userId);

        return {
            status: 409,
            body: { success: false, message: error.message || "The action could not be completed." }
        };
    }
}

function cancelAction(userId, actionId) {
    const id = clip(actionId, 80);
    const action = db.prepare(`
        SELECT * FROM finny_actions WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!action) {
        return { status: 404, body: { success: false, message: "Action not found." } };
    }

    if (action.status === "cancelled") {
        return { status: 200, body: { success: true, already: true, action: publicAction(action, null) } };
    }

    if (action.status !== "pending") {
        return { status: 409, body: { success: false, message: "This action can no longer be cancelled." } };
    }

    const updated = db.prepare(`
        UPDATE finny_actions
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'pending'
    `).run(id, userId);

    if (updated.changes !== 1) {
        return { status: 409, body: { success: false, message: "This action was already handled." } };
    }

    return {
        status: 200,
        body: { success: true, action: publicAction({ ...action, status: "cancelled" }, null) }
    };
}

function recordPaymentReceipt({ userId, groupId, payerName, payeeName, amountCents, currency, captureId }) {
    const existing = db.prepare(`
        SELECT id, title, body, amount_cents, currency, reference, created_at
        FROM finny_notifications
        WHERE user_id = ? AND reference = ?
    `).get(userId, captureId);

    if (existing) {
        return receiptFromRow(existing, payerName, payeeName);
    }

    const title = "PayPal Sandbox payment verified";
    const body = `${payerName} paid ${payeeName} ${money(amountCents)} ${currency}.`;
    const result = db.prepare(`
        INSERT INTO finny_notifications (
            user_id, group_id, kind, title, body, amount_cents, currency, reference
        )
        VALUES (?, ?, 'payment_receipt', ?, ?, ?, ?, ?)
    `).run(userId, groupId, title, body, amountCents, currency, captureId);

    return {
        id: Number(result.lastInsertRowid),
        title,
        body,
        payer: payerName,
        recipient: payeeName,
        amount: money(amountCents),
        currency,
        reference: captureId,
        createdAt: new Date().toISOString()
    };
}

function receiptFromRow(row, payerName, payeeName) {
    return {
        id: row.id,
        title: row.title,
        body: row.body,
        payer: payerName,
        recipient: payeeName,
        amount: money(row.amount_cents),
        currency: row.currency,
        reference: row.reference,
        createdAt: row.created_at
    };
}

module.exports = {
    PREPARE_TOOLS,
    runTool,
    approveAction,
    cancelAction,
    recordPaymentReceipt
};
