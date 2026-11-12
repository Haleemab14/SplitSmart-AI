
const express = require("express");
const db = require("../database/db");

const router = express.Router();

// Check whether the logged-in user owns this group.
function userOwnsGroup(groupId, userId) {
    return Boolean(
        db.prepare(`
            SELECT id
            FROM groups
            WHERE id = ? AND owner_id = ?
        `).get(groupId, userId)
    );
}

// ==========================================
// ADD MEMBER TO EXISTING GROUP
// ==========================================

router.post("/groups/:groupId/members", (req, res) => {
    const groupId = Number(req.params.groupId);
    const { name } = req.body;

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    if (!userOwnsGroup(groupId, req.user.id)) {
        return res.status(404).json({
            success: false,
            message: "Group not found."
        });
    }

    if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 60
    ) {
        return res.status(400).json({
            success: false,
            message: "Enter a member name (maximum 60 characters)."
        });
    }

    const cleanName = name.trim();

    const existingMember = db.prepare(`
        SELECT id
        FROM members
        WHERE group_id = ?
        AND LOWER(name) = LOWER(?)
        AND is_active = 1
    `).get(groupId, cleanName);

    if (existingMember) {
        return res.status(409).json({
            success: false,
            message: "This member is already in the group."
        });
    }

    const result = db.prepare(`
        INSERT INTO members (group_id, name)
        VALUES (?, ?)
    `).run(groupId, cleanName);

    res.status(201).json({
        success: true,
        message: "Member added successfully!",
        member: {
            id: result.lastInsertRowid,
            name: cleanName
        }
    });
});

// ==========================================
// REMOVE MEMBER FROM ACTIVE GROUP
// ==========================================

router.delete("/groups/:groupId/members/:memberId", (req, res) => {
    const groupId = Number(req.params.groupId);
    const memberId = Number(req.params.memberId);

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(memberId) || memberId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid group or member ID."
        });
    }

    if (!userOwnsGroup(groupId, req.user.id)) {
        return res.status(404).json({
            success: false,
            message: "Group not found."
        });
    }

    const member = db.prepare(`
        SELECT id
        FROM members
        WHERE id = ? AND group_id = ? AND is_active = 1
    `).get(memberId, groupId);

    if (!member) {
        return res.status(404).json({
            success: false,
            message: "Active member not found."
        });
    }

    db.prepare(`
        UPDATE members
        SET is_active = 0
        WHERE id = ? AND group_id = ?
    `).run(memberId, groupId);

    res.json({
        success: true,
        message: "Member removed successfully."
    });
});

// ==========================================
// DELETE ENTIRE GROUP
// ==========================================

router.delete("/groups/:groupId", (req, res) => {
    const groupId = Number(req.params.groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    if (!userOwnsGroup(groupId, req.user.id)) {
        return res.status(404).json({
            success: false,
            message: "Group not found."
        });
    }

    try {
        const deleteGroup = db.transaction(() => {
            db.prepare(`
                DELETE FROM receipt_item_shares
                WHERE receipt_item_id IN (
                    SELECT ri.id
                    FROM receipt_items ri
                    JOIN expenses e ON e.id = ri.expense_id
                    WHERE e.group_id = ?
                )
            `).run(groupId);

            db.prepare(`
                DELETE FROM receipt_items
                WHERE expense_id IN (
                    SELECT id FROM expenses WHERE group_id = ?
                )
            `).run(groupId);

            db.prepare(`
                DELETE FROM expense_shares
                WHERE expense_id IN (
                    SELECT id FROM expenses WHERE group_id = ?
                )
            `).run(groupId);

            db.prepare("DELETE FROM expenses WHERE group_id = ?")
                .run(groupId);

            db.prepare("DELETE FROM payments WHERE group_id = ?")
                .run(groupId);

            db.prepare("DELETE FROM members WHERE group_id = ?")
                .run(groupId);

            db.prepare(`
                DELETE FROM groups
                WHERE id = ? AND owner_id = ?
            `).run(groupId, req.user.id);
        });

        deleteGroup();

        res.json({
            success: true,
            message: "Group deleted successfully."
        });

    } catch (error) {
        console.error("Delete group error:", error);

        res.status(500).json({
            success: false,
            message: "Could not delete group."
        });
    }
});

// ==========================================
// CHECK FOR POSSIBLE DUPLICATE RECEIPTS
// ==========================================

router.post("/groups/:groupId/check-duplicate-receipt", (req, res) => {
    const groupId = Number(req.params.groupId);
    const { description, amount } = req.body;

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    if (
        typeof description !== "string" ||
        !description.trim() ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Please provide a valid receipt description and amount."
        });
    }

    try {
        if (!userOwnsGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const amountCents = Math.round(amount * 100);

        const candidates = db.prepare(`
            SELECT id, description, amount_cents, created_at
            FROM expenses
            WHERE group_id = ?
            AND amount_cents = ?
            ORDER BY id DESC
            LIMIT 20
        `).all(groupId, amountCents);

        function normalizeDescription(value) {
            return String(value || "")
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");
        }

        const scannedMerchant = normalizeDescription(description);

        if (!scannedMerchant) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid merchant name."
            });
        }

        const possibleDuplicates = candidates.filter(expense => {
            const existingMerchant =
                normalizeDescription(expense.description);

            return (
                existingMerchant === scannedMerchant ||
                existingMerchant.includes(scannedMerchant) ||
                scannedMerchant.includes(existingMerchant)
            );
        });

        return res.json({
            success: true,
            duplicateFound: possibleDuplicates.length > 0,
            possibleDuplicates
        });

    } catch (error) {
        console.error("Duplicate receipt check error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not check for duplicate receipts."
        });
    }
});

// ==========================================
// GET ALL GROUP EXPENSES ACROSS USER'S GROUPS
// ==========================================

router.get("/expenses", (req, res) => {
    try {
        const expenses = db.prepare(`
            SELECT
                e.*,
                m.name AS payer_name,
                g.name AS group_name
            FROM expenses e
            INNER JOIN groups g
                ON g.id = e.group_id
            INNER JOIN members m
                ON m.id = e.payer_id
            WHERE g.owner_id = ?
               OR EXISTS (
                   SELECT 1
                   FROM group_member_identity i
                   WHERE i.group_id = g.id
                     AND i.user_id = ?
               )
            ORDER BY e.id DESC
        `).all(req.user.id, req.user.id);

        res.json({
            success: true,
            expenses
        });

    } catch (error) {
        console.error("All-groups expense history error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load all group expenses."
        });
    }
});

module.exports = router;
