const crypto = require("crypto");
const db = require("../database/db");
const { getGroupLedger } = require("./ledger");

const REFERENCE_PATTERN = /^SS-CH-\d{8}-[A-F0-9]{8}$/;

function newReference() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `SS-CH-${day}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function identitiesForUser(userId) {
    return db.prepare(`
        SELECT
            i.group_id AS groupId,
            g.name AS groupName,
            i.member_id AS memberId,
            m.name AS memberName
        FROM group_member_identity i
        JOIN groups g ON g.id = i.group_id
        JOIN members m ON m.id = i.member_id
        WHERE i.user_id = ?
        ORDER BY g.name COLLATE NOCASE
    `).all(userId);
}

function unlinkedOwnedGroups(userId) {
    return db.prepare(`
        SELECT g.id, g.name
        FROM groups g
        WHERE g.owner_id = ?
          AND NOT EXISTS (
              SELECT 1
              FROM group_member_identity i
              WHERE i.group_id = g.id AND i.user_id = ?
          )
        ORDER BY g.name COLLATE NOCASE
    `).all(userId, userId);
}

function userForMember(groupId, memberId) {
    return db.prepare(`
        SELECT user_id AS userId
        FROM group_member_identity
        WHERE group_id = ? AND member_id = ?
    `).get(groupId, memberId);
}

function userCanPayAsPayer(groupId, userId, fromMemberId) {
    const link = db.prepare(`
        SELECT member_id
        FROM group_member_identity
        WHERE group_id = ? AND user_id = ?
    `).get(groupId, userId);

    return Boolean(link && link.member_id === fromMemberId);
}

function ledgerSettlement(groupId, fromId, toId) {
    return getGroupLedger(groupId).settlements.find(item =>
        item.fromId === fromId && item.toId === toId
    ) || null;
}

function openRequest(groupId, fromId, toId) {
    return db.prepare(`
        SELECT *
        FROM payment_requests
        WHERE group_id = ?
          AND from_member_id = ?
          AND to_member_id = ?
          AND status = 'open'
    `).get(groupId, fromId, toId);
}

function latestRequest(groupId, fromId, toId) {
    return db.prepare(`
        SELECT *
        FROM payment_requests
        WHERE group_id = ?
          AND from_member_id = ?
          AND to_member_id = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(groupId, fromId, toId);
}

function money(cents) {
    const amount = Number.isInteger(cents) ? cents : 0;
    return `$${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

function publicStatus(status) {
    return status === "open" ? "pending" : status;
}

function notifyUser(userId, requestId, role, status, message) {
    if (!userId) return;

    db.prepare(`
        INSERT INTO payment_notifications (
            user_id, request_id, role, status, message
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, request_id, role)
        DO UPDATE SET
            status = excluded.status,
            message = excluded.message,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, requestId, role, status, message || null);
}

function requestView(row, settlement) {
    if (!row) return null;

    const outstandingCents = row.status === "open" && settlement
        ? settlement.amountCents
        : 0;

    return {
        reference: row.reference,
        status: publicStatus(row.status),
        currency: row.currency || "USD",
        issuedAmountCents: row.issued_amount_cents,
        outstandingCents,
        paidAmountCents: row.paid_amount_cents,
        delivery: row.debtor_user_id ? "delivered" : "undeliverable",
        createdAt: row.created_at,
        paidAt: row.paid_at,
        cancelledAt: row.cancelled_at,
        captureId: row.paypal_capture_id || null
    };
}

function pairRows(userId) {
    const receivables = [];
    const payables = [];

    identitiesForUser(userId).forEach(identity => {
        const { settlements } = getGroupLedger(identity.groupId);

        settlements.forEach(settlement => {
            const request = latestRequest(
                identity.groupId,
                settlement.fromId,
                settlement.toId
            );
            const base = {
                groupId: identity.groupId,
                groupName: identity.groupName,
                amountCents: settlement.amountCents,
                currency: "USD",
                ledgerStatus: "outstanding",
                request: requestView(request, settlement)
            };

            if (settlement.toId === identity.memberId) {
                receivables.push({
                    ...base,
                    memberId: settlement.fromId,
                    memberName: settlement.from,
                    direction: "receivable"
                });
            }

            if (settlement.fromId === identity.memberId) {
                payables.push({
                    ...base,
                    memberId: settlement.toId,
                    memberName: settlement.to,
                    direction: "payable"
                });
            }
        });
    });

    return { receivables, payables };
}

function recentlyPaid(userId) {
    return db.prepare(`
        SELECT
            sr.amount_cents AS amountCents,
            sr.created_at AS createdAt,
            g.name AS groupName,
            payer.name AS payerName,
            payee.name AS payeeName,
            CASE
                WHEN i.member_id = sr.to_member_id THEN 'received'
                ELSE 'paid'
            END AS direction,
            p.paypal_capture_id AS captureId,
            pr.reference AS reference
        FROM ss_settlement_records sr
        JOIN group_member_identity i
            ON i.group_id = sr.group_id
           AND i.user_id = ?
           AND (
                i.member_id = sr.from_member_id
                OR i.member_id = sr.to_member_id
           )
        JOIN groups g ON g.id = sr.group_id
        JOIN members payer ON payer.id = sr.from_member_id
        JOIN members payee ON payee.id = sr.to_member_id
        LEFT JOIN payments p
            ON p.group_id = sr.group_id
           AND p.payer_id = sr.from_member_id
           AND p.payee_id = sr.to_member_id
           AND p.amount_cents = sr.amount_cents
           AND p.status = 'COMPLETED'
        LEFT JOIN payment_requests pr
            ON pr.group_id = sr.group_id
           AND pr.from_member_id = sr.from_member_id
           AND pr.to_member_id = sr.to_member_id
           AND pr.status = 'paid'
           AND pr.paid_amount_cents = sr.amount_cents
        WHERE sr.status = 'paid'
        ORDER BY sr.created_at DESC, sr.id DESC
        LIMIT 8
    `).all(userId);
}

function notificationsForUser(userId) {
    return db.prepare(`
        SELECT
            n.id,
            n.role,
            n.status,
            n.message,
            n.created_at AS createdAt,
            pr.reference,
            pr.currency,
            pr.issued_amount_cents AS amountCents,
            g.name AS groupName,
            payer.name AS payerName,
            payee.name AS payeeName
        FROM payment_notifications n
        JOIN payment_requests pr ON pr.id = n.request_id
        JOIN groups g ON g.id = pr.group_id
        JOIN members payer ON payer.id = pr.from_member_id
        JOIN members payee ON payee.id = pr.to_member_id
        WHERE n.user_id = ?
        ORDER BY n.id DESC
        LIMIT 20
    `).all(userId);
}

function dashboardForUser(userId) {
    const { receivables, payables } = pairRows(userId);
    const pendingRequests = db.prepare(`
        SELECT
            pr.reference,
            pr.status,
            pr.currency,
            pr.issued_amount_cents AS issuedAmountCents,
            pr.created_at AS createdAt,
            pr.debtor_user_id AS debtorUserId,
            g.name AS groupName,
            payer.name AS payerName,
            payee.name AS payeeName,
            pr.from_member_id AS fromMemberId,
            pr.to_member_id AS toMemberId,
            pr.group_id AS groupId
        FROM payment_requests pr
        JOIN groups g ON g.id = pr.group_id
        JOIN members payer ON payer.id = pr.from_member_id
        JOIN members payee ON payee.id = pr.to_member_id
        WHERE pr.status = 'open'
          AND (
              pr.created_by_user_id = ?
              OR pr.debtor_user_id = ?
          )
        ORDER BY pr.id DESC
    `).all(userId, userId).map(row => {
        const settlement = ledgerSettlement(
            row.groupId,
            row.fromMemberId,
            row.toMemberId
        );

        return {
            reference: row.reference,
            status: publicStatus(row.status),
            currency: row.currency,
            issuedAmountCents: row.issuedAmountCents,
            outstandingCents: settlement ? settlement.amountCents : 0,
            groupName: row.groupName,
            payerName: row.payerName,
            payeeName: row.payeeName,
            delivery: row.debtorUserId ? "delivered" : "undeliverable",
            createdAt: row.createdAt
        };
    });

    return {
        success: true,
        currency: "USD",
        partialPayments: false,
        identities: identitiesForUser(userId),
        unlinkedGroups: unlinkedOwnedGroups(userId),
        totalReceivableCents: receivables.reduce((sum, item) => sum + item.amountCents, 0),
        totalPayableCents: payables.reduce((sum, item) => sum + item.amountCents, 0),
        receivables,
        payables,
        pendingRequests,
        notifications: notificationsForUser(userId),
        recentlyPaid: recentlyPaid(userId)
    };
}

function newReceiptNumber() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `SS-RC-${day}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function groupLabel(groupId) {
    return db.prepare(`SELECT name FROM groups WHERE id = ?`).get(groupId)?.name || "your group";
}

function debtorNotice(settlement, groupId) {
    return `You have a payment request of ${money(settlement.amountCents)} to ${settlement.to} in ${groupLabel(groupId)}.`;
}

function ensureDebtorNotice(userId, requestId, message) {
    if (!userId) return;

    const note = db.prepare(`
        SELECT id, message
        FROM payment_notifications
        WHERE user_id = ? AND request_id = ? AND role = 'debtor'
    `).get(userId, requestId);

    if (!note) {
        notifyUser(userId, requestId, "debtor", "unread", message);
        return;
    }

    if (!note.message) {
        db.prepare(`
            UPDATE payment_notifications
            SET message = ?
            WHERE id = ?
        `).run(message, note.id);
    }
}

function insertRequest(userId, groupId, settlement) {
    const debtor = userForMember(groupId, settlement.fromId);
    const recipient = userForMember(groupId, settlement.toId);
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const result = db.prepare(`
                INSERT INTO payment_requests (
                    reference,
                    group_id,
                    from_member_id,
                    to_member_id,
                    currency,
                    issued_amount_cents,
                    status,
                    created_by_user_id,
                    debtor_user_id,
                    recipient_user_id,
                    updated_at
                )
                VALUES (?, ?, ?, ?, 'USD', ?, 'open', ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(
                newReference(),
                groupId,
                settlement.fromId,
                settlement.toId,
                settlement.amountCents,
                userId,
                debtor ? debtor.userId : null,
                recipient ? recipient.userId : null
            );

            const requestId = Number(result.lastInsertRowid);

            if (debtor) {
                notifyUser(
                    debtor.userId,
                    requestId,
                    "debtor",
                    "unread",
                    debtorNotice(settlement, groupId)
                );
            }

            return db.prepare(`
                SELECT * FROM payment_requests WHERE id = ?
            `).get(requestId);
        } catch (error) {
            lastError = error;

            if (String(error.message).includes("payment_requests_one_open")) {
                return openRequest(groupId, settlement.fromId, settlement.toId);
            }

            if (!String(error.message).includes("UNIQUE")) {
                throw error;
            }
        }
    }

    throw lastError || new Error("Could not create a payment request.");
}

function generateForUser(userId, options = {}) {
    const force = Boolean(options.force);
    const onlyFromId = Number(options.fromMemberId);
    const onlyGroupId = Number(options.groupId);
    const created = [];

    identitiesForUser(userId).forEach(identity => {
        if (Number.isInteger(onlyGroupId) && onlyGroupId > 0 && identity.groupId !== onlyGroupId) {
            return;
        }

        getGroupLedger(identity.groupId).settlements.forEach(settlement => {
            const iAmRecipient = settlement.toId === identity.memberId;
            const iAmDebtor = settlement.fromId === identity.memberId;

            if (!iAmRecipient && !iAmDebtor) return;
            if (Number.isInteger(onlyFromId) && onlyFromId > 0 && !iAmRecipient) return;
            if (Number.isInteger(onlyFromId) && onlyFromId > 0 && settlement.fromId !== onlyFromId) {
                return;
            }

            const existing = openRequest(
                identity.groupId,
                settlement.fromId,
                settlement.toId
            );

            if (existing) {
                const debtor = userForMember(identity.groupId, settlement.fromId);
                const recipient = userForMember(identity.groupId, settlement.toId);

                if (existing.issued_amount_cents !== settlement.amountCents) {
                    db.prepare(`
                        UPDATE payment_requests
                        SET issued_amount_cents = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND status = 'open'
                    `).run(settlement.amountCents, existing.id);
                }

                if (!existing.debtor_user_id && debtor) {
                    db.prepare(`
                        UPDATE payment_requests
                        SET debtor_user_id = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND debtor_user_id IS NULL AND status = 'open'
                    `).run(debtor.userId, existing.id);
                }

                if (!existing.recipient_user_id && recipient) {
                    db.prepare(`
                        UPDATE payment_requests
                        SET recipient_user_id = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND recipient_user_id IS NULL AND status = 'open'
                    `).run(recipient.userId, existing.id);
                }

                if (debtor) {
                    ensureDebtorNotice(
                        debtor.userId,
                        existing.id,
                        debtorNotice(settlement, identity.groupId)
                    );
                }

                created.push(existing.reference);
                return;
            }

            const cancelled = db.prepare(`
                SELECT id
                FROM payment_requests
                WHERE group_id = ?
                  AND from_member_id = ?
                  AND to_member_id = ?
                  AND status = 'cancelled'
                  AND issued_amount_cents = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(
                identity.groupId,
                settlement.fromId,
                settlement.toId,
                settlement.amountCents
            );

            if (cancelled && !force) return;

            const row = insertRequest(userId, identity.groupId, settlement);
            if (row) created.push(row.reference);
        });
    });

    return {
        ...dashboardForUser(userId),
        generated: created
    };
}

function loadAuthorizedRequest(userId, reference) {
    if (!REFERENCE_PATTERN.test(reference)) return null;

    const row = db.prepare(`
        SELECT pr.*, g.name AS group_name, g.owner_id
        FROM payment_requests pr
        JOIN groups g ON g.id = pr.group_id
        WHERE pr.reference = ?
    `).get(reference);

    if (!row) return null;

    const link = db.prepare(`
        SELECT member_id
        FROM group_member_identity
        WHERE group_id = ? AND user_id = ?
    `).get(row.group_id, userId);

    const allowed = row.created_by_user_id === userId
        || row.debtor_user_id === userId
        || row.owner_id === userId
        || (link && (link.member_id === row.from_member_id || link.member_id === row.to_member_id));

    if (!allowed) return null;

    const payer = db.prepare(`SELECT id, name FROM members WHERE id = ?`).get(row.from_member_id);
    const payee = db.prepare(`SELECT id, name FROM members WHERE id = ?`).get(row.to_member_id);
    const settlement = row.status === "open"
        ? ledgerSettlement(row.group_id, row.from_member_id, row.to_member_id)
        : null;
    const role = link && link.member_id === row.from_member_id
        ? "payer"
        : link && link.member_id === row.to_member_id
            ? "recipient"
            : row.created_by_user_id === userId
                ? "recipient"
                : "viewer";

    return {
        success: true,
        role,
        reference: row.reference,
        status: publicStatus(row.status),
        currency: "USD",
        group: { id: row.group_id, name: row.group_name },
        payer: { memberId: payer.id, name: payer.name },
        recipient: { memberId: payee.id, name: payee.name },
        issuedAmountCents: row.issued_amount_cents,
        outstandingCents: settlement ? settlement.amountCents : 0,
        paidAmountCents: row.paid_amount_cents,
        receiptNumber: row.receipt_number || null,
        captureId: row.paypal_capture_id || null,
        paypalPaymentId: row.paypal_payment_id || null,
        delivery: row.debtor_user_id ? "delivered" : "undeliverable",
        createdAt: row.created_at,
        paidAt: row.paid_at,
        cancelledAt: row.cancelled_at,
        partialPayments: false,
        canPay: role === "payer" && row.status === "open" && Boolean(settlement)
    };
}

function markRequestRead(userId, reference) {
    const view = loadAuthorizedRequest(userId, reference);
    if (!view) return null;

    db.prepare(`
        UPDATE payment_notifications
        SET status = 'read', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND status = 'unread'
          AND request_id = (
              SELECT id FROM payment_requests WHERE reference = ?
          )
    `).run(userId, reference);

    return loadAuthorizedRequest(userId, reference);
}

function cancelRequest(userId, reference) {
    const row = db.prepare(`
        SELECT *
        FROM payment_requests
        WHERE reference = ?
    `).get(reference);

    if (!row || !REFERENCE_PATTERN.test(reference)) return { status: 404 };

    const view = loadAuthorizedRequest(userId, reference);
    const isRecipient = view && view.role === "recipient";

    if (!isRecipient) return { status: 404 };
    if (row.status === "cancelled") return { status: 200, already: true };
    if (row.status !== "open") return { status: 409 };

    const updated = db.prepare(`
        UPDATE payment_requests
        SET status = 'cancelled',
            cancelled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'open'
    `).run(row.id);

    if (updated.changes !== 1) return { status: 409 };

    db.prepare(`
        UPDATE payment_notifications
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
    `).run(row.id);

    return { status: 200, already: false };
}

function recordVerifiedRequestPayment({
    groupId,
    fromMemberId,
    toMemberId,
    amountCents,
    captureId,
    paymentId
}) {
    const request = openRequest(groupId, fromMemberId, toMemberId);
    if (!request || !captureId) return null;

    const payer = db.prepare(`SELECT name FROM members WHERE id = ?`).get(fromMemberId);
    const payee = db.prepare(`SELECT name FROM members WHERE id = ?`).get(toMemberId);
    const receiptNumber = newReceiptNumber();
    const updated = db.prepare(`
        UPDATE payment_requests
        SET status = 'paid',
            paid_amount_cents = ?,
            paypal_capture_id = ?,
            paypal_payment_id = ?,
            receipt_number = ?,
            paid_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'open'
    `).run(amountCents, captureId, paymentId, receiptNumber, request.id);

    if (updated.changes !== 1) return null;

    const amount = money(amountCents);
    const payerName = payer?.name || "The payer";
    const payeeName = payee?.name || "the recipient";
    const recipient = userForMember(groupId, toMemberId);

    notifyUser(
        request.debtor_user_id,
        request.id,
        "debtor",
        "paid",
        `Your payment of ${amount} to ${payeeName} was successful. Your settlement has been cleared.`
    );
    notifyUser(
        recipient ? recipient.userId : request.recipient_user_id,
        request.id,
        "recipient",
        "paid",
        `${payerName} paid you ${amount}. The settlement has been cleared.`
    );

    if (
        request.created_by_user_id &&
        request.created_by_user_id !== request.debtor_user_id &&
        request.created_by_user_id !== (recipient && recipient.userId)
    ) {
        notifyUser(
            request.created_by_user_id,
            request.id,
            "recipient",
            "paid",
            `${payerName} paid you ${amount}. The settlement has been cleared.`
        );
    }

    return {
        reference: request.reference,
        receiptNumber,
        captureId,
        amountCents
    };
}

function ledgerAnswer(userId) {
    const data = dashboardForUser(userId);
    const lines = [];

    if (data.identities.length) {
        lines.push(`Linked as ${data.identities.map(item => `${item.memberName} in ${item.groupName}`).join(", ")}.`);
    } else {
        lines.push("This account is not linked to a group member yet.");
    }

    if (data.payables.length) {
        lines.push("You need to pay:");
        data.payables.forEach(item => {
            const request = item.request;
            const requestText = request && request.status === "pending"
                ? ` Payment request ${request.reference} is PENDING. Open challan.html?ref=${request.reference} and choose Pay Now.`
                : " No payment request has been delivered yet.";
            lines.push(`- ${money(item.amountCents)} to ${item.memberName} in ${item.groupName}.${requestText}`);
        });
    } else {
        lines.push("You do not owe anyone in your linked groups.");
    }

    if (data.receivables.length) {
        lines.push("People who owe you:");
        data.receivables.forEach(item => {
            const delivery = item.request && item.request.delivery === "undeliverable"
                ? " This request cannot be delivered until that member links an account."
                : "";
            const reference = item.request ? ` Request ${item.request.reference} is ${String(item.request.status).toUpperCase()}.` : "";
            lines.push(`- ${item.memberName} owes ${money(item.amountCents)} in ${item.groupName}.${reference}${delivery}`);
        });
    } else {
        lines.push("Nobody owes you in your linked groups.");
    }

    const cleared = (data.recentlyPaid || []).filter(item => item.captureId);
    if (cleared.length) {
        lines.push("Verified payments:");
        cleared.forEach(item => {
            const direction = item.direction === "received"
                ? `${item.payerName} paid you ${money(item.amountCents)}`
                : `You paid ${item.payeeName} ${money(item.amountCents)}`;
            lines.push(`- ${direction} in ${item.groupName}. Capture ${item.captureId}.`);
        });
    } else {
        lines.push("No verified PayPal payments are recorded for your linked members.");
    }

    lines.push("These figures come from the verified ledger. Nothing is marked paid from this answer.");
    return lines.join("\n");
}

module.exports = {
    REFERENCE_PATTERN,
    userCanPayAsPayer,
    dashboardForUser,
    generateForUser,
    loadAuthorizedRequest,
    markRequestRead,
    cancelRequest,
    recordVerifiedRequestPayment,
    ledgerAnswer
};
