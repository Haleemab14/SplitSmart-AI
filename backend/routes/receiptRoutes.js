
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

function saveItemizedReceipt({
    groupId,
    expenseId,
    description,
    payerId,
    preparedItems,
    totalCents
}) {
    const isUpdate = Boolean(expenseId);

    if (isUpdate) {
        db.prepare(`
            UPDATE expenses
            SET description = ?,
                amount_cents = ?,
                payer_id = ?
            WHERE id = ? AND group_id = ?
        `).run(
            description,
            totalCents,
            payerId,
            expenseId,
            groupId
        );

        db.prepare(`
            DELETE FROM receipt_item_shares
            WHERE receipt_item_id IN (
                SELECT id FROM receipt_items WHERE expense_id = ?
            )
        `).run(expenseId);

        db.prepare(`
            DELETE FROM receipt_items WHERE expense_id = ?
        `).run(expenseId);

        db.prepare(`
            DELETE FROM expense_shares WHERE expense_id = ?
        `).run(expenseId);
    } else {
        const created = db.prepare(`
            INSERT INTO expenses
            (group_id, description, amount_cents, payer_id)
            VALUES (?, ?, ?, ?)
        `).run(groupId, description, totalCents, payerId);

        expenseId = Number(created.lastInsertRowid);
    }

    const insertItem = db.prepare(`
        INSERT INTO receipt_items
        (expense_id, name, amount_cents)
        VALUES (?, ?, ?)
    `);

    const insertItemShare = db.prepare(`
        INSERT INTO receipt_item_shares
        (receipt_item_id, member_id, amount_cents)
        VALUES (?, ?, ?)
    `);

    const memberTotals = new Map();

    for (const item of preparedItems) {
        const result = insertItem.run(
            expenseId,
            item.name,
            item.amountCents
        );

        const receiptItemId = Number(result.lastInsertRowid);
        const baseShare = Math.floor(
            item.amountCents / item.memberIds.length
        );
        const remainder = item.amountCents % item.memberIds.length;

        item.memberIds.forEach((memberId, index) => {
            const share = baseShare + (index < remainder ? 1 : 0);

            insertItemShare.run(receiptItemId, memberId, share);

            memberTotals.set(
                memberId,
                (memberTotals.get(memberId) || 0) + share
            );
        });
    }

    const insertExpenseShare = db.prepare(`
        INSERT INTO expense_shares
        (expense_id, member_id, amount_cents)
        VALUES (?, ?, ?)
    `);

    for (const [memberId, amountCents] of memberTotals) {
        insertExpenseShare.run(expenseId, memberId, amountCents);
    }

    return expenseId;
}

function prepareReceiptPayload(req, groupId) {
    const { description, payerId, items } = req.body;

    if (
        typeof description !== "string" ||
        !description.trim() ||
        description.trim().length > 120 ||
        !Number.isInteger(Number(payerId)) ||
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > 100
    ) {
        return {
            error: {
                status: 400,
                message: "Please provide a description, payer and receipt items."
            }
        };
    }

    const members = db.prepare(`
        SELECT id
        FROM members
        WHERE group_id = ? AND is_active = 1
    `).all(groupId);

    const validMemberIds = new Set(members.map(member => member.id));
    const numericPayerId = Number(payerId);

    if (!validMemberIds.has(numericPayerId)) {
        return {
            error: {
                status: 400,
                message: "The selected payer is not an active member of this group."
            }
        };
    }

    const preparedItems = [];
    let totalCents = 0;

    for (const item of items) {
        const name = typeof item.name === "string"
            ? item.name.trim()
            : "";

        const amount = Number(item.amount);
        const amountCents = Math.round(amount * 100);

        const memberIds = Array.isArray(item.memberIds)
            ? [...new Set(item.memberIds.map(Number))]
            : [];

        if (
            !name ||
            name.length > 120 ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !Number.isSafeInteger(amountCents) ||
            amountCents <= 0 ||
            amountCents > 100000000 ||
            memberIds.length === 0 ||
            !memberIds.every(id =>
                Number.isInteger(id) && validMemberIds.has(id)
            )
        ) {
            return {
                error: {
                    status: 400,
                    message: `Please check the name, amount and member assignments for "${name || "an item"}".`
                }
            };
        }

        preparedItems.push({ name, amountCents, memberIds });
        totalCents += amountCents;
    }

    if (
        !Number.isSafeInteger(totalCents) ||
        totalCents <= 0 ||
        totalCents > 100000000
    ) {
        return {
            error: {
                status: 400,
                message: "The receipt total is invalid or too large."
            }
        };
    }

    return {
        description: description.trim(),
        payerId: numericPayerId,
        preparedItems,
        totalCents
    };
}

// ==========================================
// GET ITEMIZED RECEIPT FOR EDITING
// ==========================================

router.get("/:groupId/receipt-expenses/:expenseId", (req, res) => {
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

    if (!userCanAccessGroup(groupId, req.user.id)) {
        return res.status(403).json({
            success: false,
            message: "You do not have access to this group."
        });
    }

    const expense = db.prepare(`
        SELECT id, description, payer_id
        FROM expenses
        WHERE id = ? AND group_id = ?
    `).get(expenseId, groupId);

    if (!expense) {
        return res.status(404).json({
            success: false,
            message: "Expense not found."
        });
    }

    const items = db.prepare(`
        SELECT id, name, amount_cents
        FROM receipt_items
        WHERE expense_id = ?
        ORDER BY id ASC
    `).all(expenseId);

    const formattedItems = items.map(item => {
        const shares = db.prepare(`
            SELECT member_id
            FROM receipt_item_shares
            WHERE receipt_item_id = ?
        `).all(item.id);

        return {
            name: item.name,
            amount: item.amount_cents / 100,
            memberIds: shares.map(share => Number(share.member_id))
        };
    });

    return res.json({
        success: true,
        isItemized: formattedItems.length > 0,
        expense: {
            description: expense.description,
            payerId: expense.payer_id
        },
        items: formattedItems
    });
});

// ==========================================
// CREATE ITEMIZED RECEIPT EXPENSE
// ==========================================

router.post("/:groupId/receipt-expenses", (req, res) => {
    const groupId = Number(req.params.groupId);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid group ID."
        });
    }

    try {
        if (!userOwnsGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const payload = prepareReceiptPayload(req, groupId);

        if (payload.error) {
            return res.status(payload.error.status).json({
                success: false,
                message: payload.error.message
            });
        }

        const createReceipt = db.transaction(() =>
            saveItemizedReceipt({
                groupId,
                expenseId: null,
                description: payload.description,
                payerId: payload.payerId,
                preparedItems: payload.preparedItems,
                totalCents: payload.totalCents
            })
        );

        const expenseId = createReceipt();

        return res.status(201).json({
            success: true,
            message: "Itemized receipt saved successfully!",
            expenseId,
            amountCents: payload.totalCents,
            itemCount: payload.preparedItems.length
        });

    } catch (error) {
        console.error("Create receipt error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not save the itemized receipt."
        });
    }
});

// ==========================================
// EDIT ITEMIZED RECEIPT EXPENSE
// ==========================================

router.put("/:groupId/receipt-expenses/:expenseId", (req, res) => {
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

        const payload = prepareReceiptPayload(req, groupId);

        if (payload.error) {
            return res.status(payload.error.status).json({
                success: false,
                message: payload.error.message
            });
        }

        const updateReceipt = db.transaction(() =>
            saveItemizedReceipt({
                groupId,
                expenseId,
                description: payload.description,
                payerId: payload.payerId,
                preparedItems: payload.preparedItems,
                totalCents: payload.totalCents
            })
        );

        updateReceipt();

        return res.json({
            success: true,
            message: "Itemized receipt updated successfully!",
            expenseId,
            amountCents: payload.totalCents,
            itemCount: payload.preparedItems.length
        });

    } catch (error) {
        console.error("Edit receipt error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not update the itemized receipt."
        });
    }
});

module.exports = router;
