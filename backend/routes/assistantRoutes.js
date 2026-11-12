// ==========================================
// SPLITSMART AI - ASSISTANT ROUTES
// ==========================================

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { searchWorkspace } = require("../services/workspaceSearch");
const { getGroupLedger } = require("../services/ledger");
const finnyAi = require("../services/finnyAi");
const finnyAgent = require("../services/finnyAgent");
const finnyTools = require("../services/finnyTools");
const paypal = require("../services/paypalService");
const paymentRequests = require("../services/paymentRequests");
const { userCanAccessGroup } = require("../services/groupAccess");
// ==========================================
// GROUP OWNERSHIP HELPER
// ==========================================

function userOwnsGroup(groupId, userId) {
    return db.prepare(`
        SELECT id
        FROM groups
        WHERE id = ? AND owner_id = ?
    `).get(groupId, userId);
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


// ==========================================
// GET GROUP DATA FOR FINNY
// ==========================================

router.get("/:groupId/assistant-data", (req, res) => {
    const groupId = Number(req.params.groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    try {
        if (!userCanAccessGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const group = db.prepare(`
            SELECT id, name
            FROM groups
            WHERE id = ?
        `).get(groupId);

        const expenses = db.prepare(`
            SELECT
                e.id,
                e.description,
                e.amount_cents,
                e.created_at,
                m.name AS payer_name
            FROM expenses e
            JOIN members m ON m.id = e.payer_id
            WHERE e.group_id = ?
            ORDER BY e.id DESC
        `).all(groupId);

        const ledger = getGroupLedger(groupId);

        const balances = ledger.balances.map(member => ({
            memberId: member.memberId,
            name: member.name,
            totalPaidCents: member.totalPaid,
            totalShareCents: member.totalShare,
            balanceCents: member.balance
        }));

        const totalSpentCents = expenses.reduce(
            (sum, expense) => sum + expense.amount_cents,
            0
        );

        const categoryMap = {};
        const monthlyMap = {};

        expenses.forEach(expense => {
            const category = detectCategory(expense.description);

            if (!categoryMap[category]) {
                categoryMap[category] = {
                    name: category,
                    totalCents: 0,
                    count: 0
                };
            }

            categoryMap[category].totalCents += expense.amount_cents;
            categoryMap[category].count += 1;

            const monthKey = String(expense.created_at || "").slice(0, 7);

            if (/^\d{4}-\d{2}$/.test(monthKey)) {
                if (!monthlyMap[monthKey]) {
                    monthlyMap[monthKey] = {
                        month: monthKey,
                        totalCents: 0,
                        count: 0
                    };
                }

                monthlyMap[monthKey].totalCents += expense.amount_cents;
                monthlyMap[monthKey].count += 1;
            }
        });

        const settlements = ledger.settlements.map(item => ({
            from: item.from,
            to: item.to,
            amountCents: item.amountCents
        }));

        return res.json({
            success: true,
            group,
            totalSpentCents,
            expenseCount: expenses.length,
            expenses,
            balances,
            categories: Object.values(categoryMap)
                .sort((a, b) => b.totalCents - a.totalCents),
            monthly: Object.values(monthlyMap)
                .sort((a, b) => a.month.localeCompare(b.month)),
            settlements
        });

    } catch (error) {
        console.error("Assistant data error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load group information for Finny."
        });
    }
});

router.get("/:groupId/assistant-search", async (req, res) => {
    const groupId = Number(req.params.groupId);
    const searchText = String(req.query.q || "").trim();

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    if (searchText.length < 2 || searchText.length > 120) {
        return res.status(400).json({
            success: false,
            message: "Search must contain between 2 and 120 characters."
        });
    }

    try {
        if (!userCanAccessGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const outcome = await searchWorkspace({
            userId: req.user.id,
            query: searchText,
            groupId
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error("Finny search error:", error);
        return res.status(500).json({
            success: false,
            message: "Finny could not search expenses right now."
        });
    }
});

router.post("/:groupId/assistant-chat", async (req, res) => {
    const groupId = Number(req.params.groupId);
    const mode = req.body?.mode === "personal" ? "personal" : "group";
    const question = String(req.body?.question || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!Number.isInteger(groupId) || groupId < 0 || (groupId === 0 && mode !== "personal")) {
        return res.status(400).json({
            success: false,
            message: "Select a group before asking Finny about shared expenses."
        });
    }

    if (question.length < 2 || question.length > 500) {
        return res.status(400).json({
            success: false,
            message: "Ask Finny a question between 2 and 500 characters."
        });
    }

    try {
        if (groupId > 0 && !userCanAccessGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        if (!finnyAi.geminiConfigured()) {
            return res.json({
                success: true,
                source: "ledger",
                answer: paymentRequests.ledgerAnswer(req.user.id),
                actions: [],
                progress: [],
                notice: "Gemini is not configured. This answer comes from the verified ledger and payment records."
            });
        }

        const result = await finnyAgent.reply({
            userId: req.user.id,
            groupId,
            mode,
            question,
            history
        });

        return res.json({
            success: true,
            source: "gemini",
            model: result.model,
            answer: result.answer,
            progress: result.progress,
            actions: result.actions,
            notice: "Finny used verified SplitSmart tools. Approve a card before anything is saved or sent to PayPal."
        });

    } catch (error) {
        const unavailable = error instanceof finnyAi.FinnyAiError;
        console.error("Finny chat error:", unavailable ? error.message : "Unexpected assistant failure.");

        return res.json({
            success: true,
            source: "ledger",
            answer: paymentRequests.ledgerAnswer(req.user.id),
            actions: [],
            progress: [],
            notice: "Gemini is unavailable. This answer comes from the verified ledger and payment records."
        });
    }
});

router.post("/assistant-actions/:actionId/approve", async (req, res) => {
    const outcome = await finnyTools.approveAction(
        req.user.id,
        req.params.actionId,
        () => paypal.checkoutUrls(req)
    );
    return res.status(outcome.status).json(outcome.body);
});

router.post("/assistant-actions/:actionId/cancel", (req, res) => {
    const outcome = finnyTools.cancelAction(req.user.id, req.params.actionId);
    return res.status(outcome.status).json(outcome.body);
});

module.exports = router;