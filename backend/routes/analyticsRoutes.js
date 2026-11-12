// ==========================================
// SPLITSMART AI - ANALYTICS ROUTES
// ==========================================

const express = require("express");
const router = express.Router();
const db = require("../database/db");
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

// ==========================================
// DETECT EXPENSE CATEGORY
// ==========================================

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
// GET GROUP SPENDING ANALYTICS
// ==========================================

router.get("/:groupId/analytics", (req, res) => {
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
                id,
                description,
                amount_cents,
                created_at
            FROM expenses
            WHERE group_id = ?
            ORDER BY id DESC
        `).all(groupId);

        // ======================================
        // CATEGORY TOTALS
        // ======================================

        const categoryMap = {};

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
        });

        const categories = Object.values(categoryMap)
            .sort((a, b) => b.totalCents - a.totalCents);

        // ======================================
        // MONTHLY SPENDING
        // ======================================

        const monthlyMap = {};

        expenses.forEach(expense => {
            const dateText = String(expense.created_at || "");
            const monthKey = dateText.slice(0, 7);

            if (!/^\d{4}-\d{2}$/.test(monthKey)) {
                return;
            }

            if (!monthlyMap[monthKey]) {
                monthlyMap[monthKey] = {
                    month: monthKey,
                    totalCents: 0,
                    count: 0
                };
            }

            monthlyMap[monthKey].totalCents += expense.amount_cents;
            monthlyMap[monthKey].count += 1;
        });

        const monthly = Object.values(monthlyMap)
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(-6)
            .map(item => {
                const [year, month] = item.month.split("-").map(Number);

                return {
                    ...item,
                    label: new Date(year, month - 1, 1)
                        .toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric"
                        })
                };
            });

        // ======================================
        // BIGGEST EXPENSE
        // ======================================

        const biggestExpense = expenses.length
            ? [...expenses].sort(
                (a, b) => b.amount_cents - a.amount_cents
            )[0]
            : null;

        // ======================================
        // TOTAL SPENDING
        // ======================================

        const totalSpentCents = expenses.reduce(
            (sum, expense) => sum + expense.amount_cents,
            0
        );

        return res.json({
            success: true,
            group,
            totalSpentCents,
            expenseCount: expenses.length,
            categories,
            monthly,
            biggestExpense,

            // Individual records for AG Grid
            expenses: expenses.map(expense => ({
                id: expense.id,
                description: expense.description,
                amount_cents: expense.amount_cents,
                created_at: expense.created_at
            }))
        });

    } catch (error) {
        console.error("Group analytics error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load spending analytics."
        });
    }
});

module.exports = router;