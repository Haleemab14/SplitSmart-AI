
// ==========================================
// SPLITSMART AI - PERSONAL EXPENSE ROUTES
// ==========================================

const express = require("express");
const router = express.Router();
const db = require("../database/db");

// ==========================================
// GET PERSONAL EXPENSES
// ==========================================

router.get("/", (req, res) => {
    try {
        const expenses = db.prepare(`
            SELECT *
            FROM personal_expenses
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(req.user.id);

        return res.json({
            success: true,
            expenses
        });

    } catch (error) {
        console.error("Load personal expenses error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load personal expenses."
        });
    }
});

// ==========================================
// CREATE PERSONAL EXPENSE
// ==========================================

router.post("/", (req, res) => {
    const { description, amount } = req.body;

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
            message: "Please enter valid personal expense details."
        });
    }

    const amountCents = Math.round(amount * 100);

    if (amountCents < 1) {
        return res.status(400).json({
            success: false,
            message: "Amount is too small."
        });
    }

    try {
        const result = db.prepare(`
            INSERT INTO personal_expenses
            (user_id, description, amount_cents)
            VALUES (?, ?, ?)
        `).run(
            req.user.id,
            description.trim(),
            amountCents
        );

        return res.status(201).json({
            success: true,
            message: "Personal expense saved successfully!",
            expenseId: Number(result.lastInsertRowid)
        });

    } catch (error) {
        console.error("Create personal expense error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not save personal expense."
        });
    }
});

// ==========================================
// DELETE PERSONAL EXPENSE
// ==========================================

router.delete("/:expenseId", (req, res) => {
    const expenseId = Number(req.params.expenseId);

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid expense ID."
        });
    }

    try {
        const result = db.prepare(`
            DELETE FROM personal_expenses
            WHERE id = ? AND user_id = ?
        `).run(expenseId, req.user.id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Expense not found."
            });
        }

        return res.json({
            success: true,
            message: "Personal expense deleted successfully."
        });

    } catch (error) {
        console.error("Delete personal expense error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not delete personal expense."
        });
    }
});

module.exports = router;
