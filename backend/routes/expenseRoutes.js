
const express = require("express");
const db = require("../database/db");
const { userCanAccessGroup } = require("../services/groupAccess");

const router = express.Router();

// Check whether the logged-in user owns this group
function userOwnsGroup(groupId, userId) {
    return db.prepare(`
        SELECT id
        FROM groups
        WHERE id = ? AND owner_id = ?
    `).get(groupId, userId);
}

// ==========================================
// GET GROUP EXPENSES
// ==========================================

router.get("/:groupId/expenses", (req, res) => {
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

        const expenses = db.prepare(`
            SELECT
                expenses.*,
                members.name AS payer_name
            FROM expenses
            JOIN members
                ON expenses.payer_id = members.id
            WHERE expenses.group_id = ?
            ORDER BY expenses.id DESC
        `).all(groupId);

        res.json({
            success: true,
            expenses
        });

    } catch (error) {
        console.error("Load group expenses error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load expenses."
        });
    }
});

// ==========================================
// CREATE GROUP EXPENSE
// ==========================================

router.post("/:groupId/expenses", (req, res) => {
    const groupId = Number(req.params.groupId);
    const { description, amount, payerId } = req.body;

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    if (
        typeof description !== "string" ||
        !description.trim() ||
        description.trim().length > 120 ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1000000 ||
        !Number.isInteger(payerId)
    ) {
        return res.status(400).json({
            success: false,
            message: "Please enter valid expense details."
        });
    }

    try {
        if (!userOwnsGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const members = db.prepare(`
            SELECT id
            FROM members
            WHERE group_id = ? AND is_active = 1
        `).all(groupId);

        if (members.length === 0) {
            return res.status(400).json({
                success: false,
                message: "This group has no members."
            });
        }

        if (!members.some(member => member.id === payerId)) {
            return res.status(400).json({
                success: false,
                message: "The selected payer is not in this group."
            });
        }

        const amountCents = Math.round(amount * 100);

        if (amountCents < 1) {
            return res.status(400).json({
                success: false,
                message: "Amount is too small."
            });
        }

        const createExpense = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO expenses
                (group_id, description, amount_cents, payer_id)
                VALUES (?, ?, ?, ?)
            `).run(
                groupId,
                description.trim(),
                amountCents,
                payerId
            );

            const expenseId = Number(result.lastInsertRowid);

            const baseShare = Math.floor(
                amountCents / members.length
            );

            const remainder = amountCents % members.length;

            const insertShare = db.prepare(`
                INSERT INTO expense_shares
                (expense_id, member_id, amount_cents)
                VALUES (?, ?, ?)
            `);

            members.forEach((member, index) => {
                insertShare.run(
                    expenseId,
                    member.id,
                    baseShare + (index < remainder ? 1 : 0)
                );
            });

            return expenseId;
        });

        const expenseId = createExpense();

        res.status(201).json({
            success: true,
            message: "Expense created successfully!",
            expenseId
        });

    } catch (error) {
        console.error("Create group expense error:", error);

        res.status(500).json({
            success: false,
            message: "Could not create expense."
        });
    }
});

// ==========================================
// DELETE GROUP EXPENSE
// ==========================================

router.delete("/:groupId/expenses/:expenseId", (req, res) => {
    const groupId = Number(req.params.groupId);
    const expenseId = Number(req.params.expenseId);

    if (
        !Number.isInteger(groupId) ||
        groupId <= 0 ||
        !Number.isInteger(expenseId) ||
        expenseId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid group or expense ID."
        });
    }

    try {
        if (!userOwnsGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const expense = db.prepare(`
            SELECT id
            FROM expenses
            WHERE id = ? AND group_id = ?
        `).get(expenseId, groupId);

        if (!expense) {
            return res.status(404).json({
                success: false,
                message: "Expense not found."
            });
        }

        const deleteExpense = db.transaction(() => {
            // Delete item assignments first.
            db.prepare(`
                DELETE FROM receipt_item_shares
                WHERE receipt_item_id IN (
                    SELECT id
                    FROM receipt_items
                    WHERE expense_id = ?
                )
            `).run(expenseId);

            // Delete receipt items.
            db.prepare(`
                DELETE FROM receipt_items
                WHERE expense_id = ?
            `).run(expenseId);

            // Delete normal expense shares.
            db.prepare(`
                DELETE FROM expense_shares
                WHERE expense_id = ?
            `).run(expenseId);

            // Finally delete the expense.
            db.prepare(`
                DELETE FROM expenses
                WHERE id = ? AND group_id = ?
            `).run(expenseId, groupId);
        });

        deleteExpense();

        res.json({
            success: true,
            message: "Expense deleted successfully."
        });

    } catch (error) {
        console.error("Delete group expense error:", error);

        res.status(500).json({
            success: false,
            message: "Could not delete expense."
        });
    }
});

// ==========================================
// UPDATE A NON-ITEMIZED GROUP EXPENSE
// ==========================================

router.put("/:groupId/expenses/:expenseId", (req, res) => {
    const groupId = Number(req.params.groupId);
    const expenseId = Number(req.params.expenseId);
    const { description, amount, payerId } = req.body;

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(expenseId) || expenseId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid group or expense ID."
        });
    }

    if (
        typeof description !== "string" ||
        !description.trim() ||
        description.trim().length > 120 ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > 1000000
    ) {
        return res.status(400).json({
            success: false,
            message: "Please enter valid expense details."
        });
    }

    try {
        if (!userOwnsGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const expense = db.prepare(`
            SELECT id, payer_id
            FROM expenses
            WHERE id = ? AND group_id = ?
        `).get(expenseId, groupId);

        if (!expense) {
            return res.status(404).json({
                success: false,
                message: "Expense not found."
            });
        }

        const itemized = db.prepare(`
            SELECT id FROM receipt_items WHERE expense_id = ? LIMIT 1
        `).get(expenseId);

        if (itemized) {
            return res.status(400).json({
                success: false,
                message: "This expense is itemized. Edit it from the receipt assignment panel."
            });
        }

        const members = db.prepare(`
            SELECT id
            FROM members
            WHERE group_id = ? AND is_active = 1
        `).all(groupId);

        if (members.length === 0) {
            return res.status(400).json({
                success: false,
                message: "This group has no active members."
            });
        }

        const nextPayerId = Number.isInteger(payerId)
            ? payerId
            : expense.payer_id;

        if (!members.some(member => member.id === nextPayerId)) {
            return res.status(400).json({
                success: false,
                message: "The selected payer is not an active member of this group."
            });
        }

        const amountCents = Math.round(amount * 100);

        if (amountCents < 1) {
            return res.status(400).json({
                success: false,
                message: "Amount is too small."
            });
        }

        const updateExpense = db.transaction(() => {
            db.prepare(`
                UPDATE expenses
                SET description = ?, amount_cents = ?, payer_id = ?
                WHERE id = ? AND group_id = ?
            `).run(
                description.trim(),
                amountCents,
                nextPayerId,
                expenseId,
                groupId
            );

            db.prepare(`
                DELETE FROM expense_shares WHERE expense_id = ?
            `).run(expenseId);

            const baseShare = Math.floor(amountCents / members.length);
            const remainder = amountCents % members.length;

            const insertShare = db.prepare(`
                INSERT INTO expense_shares
                (expense_id, member_id, amount_cents)
                VALUES (?, ?, ?)
            `);

            members.forEach((member, index) => {
                insertShare.run(
                    expenseId,
                    member.id,
                    baseShare + (index < remainder ? 1 : 0)
                );
            });
        });

        updateExpense();

        res.json({
            success: true,
            message: "Expense updated successfully."
        });

    } catch (error) {
        console.error("Update group expense error:", error);

        res.status(500).json({
            success: false,
            message: "Could not update expense."
        });
    }
});

module.exports = router;
