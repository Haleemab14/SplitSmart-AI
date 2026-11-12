
const express = require("express");
const router = express.Router();
const db = require("../database/db");

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

        return res.json({
            success: true,
            message: "Expense deleted successfully."
        });

    } catch (error) {
        console.error("Delete expense error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not delete expense."
        });
    }
});

module.exports = router;
