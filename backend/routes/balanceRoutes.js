// ==========================================
// SPLITSMART AI - BALANCE ROUTES
// ==========================================

const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { getGroupLedger } = require("../services/ledger");
const { userCanAccessGroup } = require("../services/groupAccess");
// ==========================================
// SAVED DEMO SETTLEMENT RECORDS
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS ss_settlement_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        from_member_id INTEGER NOT NULL,
        to_member_id INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'paid',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);
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
// GET GROUP MEMBER BALANCES
// ==========================================

router.get("/:groupId/balances", (req, res) => {
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

        const { balances } = getGroupLedger(groupId);

        return res.json({
            success: true,
            balances
        });

    } catch (error) {
        console.error("Balance calculation error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not calculate balances."
        });
    }
});

// ==========================================
// GET SETTLEMENT SUGGESTIONS
// ==========================================

router.get("/:groupId/settlements", (req, res) => {
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

        const { settlements } = getGroupLedger(groupId);
        const identity = db.prepare(`
            SELECT member_id
            FROM group_member_identity
            WHERE group_id = ? AND user_id = ?
        `).get(groupId, req.user.id);

        return res.json({
            success: true,
            myMemberId: identity ? identity.member_id : null,
            canRecordNote: Boolean(userOwnsGroup(groupId, req.user.id)),
            settlements
        });

    } catch (error) {
        console.error("Settlement calculation error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not calculate settlements."
        });
    }
});
// ==========================================
// GET SETTLEMENT HISTORY
// ==========================================

router.get("/:groupId/settlement-history", (req, res) => {
    const groupId = Number(req.params.groupId);

    try {
        if (!Number.isInteger(groupId) || groupId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid group ID."
            });
        }

        if (!userCanAccessGroup(groupId, req.user.id)) {
            return res.status(404).json({
                success: false,
                message: "Group not found."
            });
        }

        const history = db.prepare(`
            SELECT
            sr.id,
            sr.amount_cents AS amountCents,
            sr.status,
            sr.created_at AS createdAt,
            sender.name AS "from",
            receiver.name AS "to"
            FROM ss_settlement_records sr
            JOIN members sender
                ON sender.id = sr.from_member_id
            JOIN members receiver
                ON receiver.id = sr.to_member_id
            WHERE sr.group_id = ?
            ORDER BY sr.created_at DESC, sr.id DESC
        `).all(groupId);

        return res.json({
            success: true,
            history
        });

    } catch (error) {
        console.error("Settlement history error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load settlement history."
        });
    }
});
// ==========================================
// RECORD A DEMO SETTLEMENT
// ==========================================

router.post("/:groupId/settlements/record", (req, res) => {
    const groupId = Number(req.params.groupId);

    const fromId = Number(req.body.fromId);
    const toId = Number(req.body.toId);
    const amountCents = Number(req.body.amountCents);

    try {
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
            !Number.isInteger(fromId) ||
            !Number.isInteger(toId) ||
            fromId === toId ||
            !Number.isInteger(amountCents) ||
            amountCents <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid settlement details."
            });
        }

        const members = db.prepare(`
            SELECT id
            FROM members
            WHERE group_id = ?
        `).all(groupId);

        const validIds = members.map(member => member.id);

        if (!validIds.includes(fromId) || !validIds.includes(toId)) {
            return res.status(400).json({
                success: false,
                message: "Both members must belong to this group."
            });
        }

        const recordSettlement = db.transaction(() => {
            const { balances } = getGroupLedger(groupId);

            function getBalance(memberId) {
                const member = balances.find(
                    item => item.memberId === memberId
                );

                return member ? member.balance : 0;
            }

            const fromBalance = getBalance(fromId);
            const toBalance = getBalance(toId);

            if (fromBalance >= 0 || toBalance <= 0) {
                throw new Error(
                    "These members do not currently have a debt to settle."
                );
            }

            const maximum = Math.min(
                -fromBalance,
                toBalance
            );

            if (amountCents > maximum) {
                throw new Error(
                    "Settlement amount exceeds the outstanding debt."
                );
            }

            const result = db.prepare(`
                INSERT INTO ss_settlement_records (
                    group_id,
                    from_member_id,
                    to_member_id,
                    amount_cents,
                    status
                )
                VALUES (?, ?, ?, ?, 'demo-noted')
            `).run(
                groupId,
                fromId,
                toId,
                amountCents
            );

            return result.lastInsertRowid;
        });

        const settlementId = recordSettlement();

        return res.status(201).json({
            success: true,
            message: "Demo note saved. This is not a PayPal payment and does not change balances.",
            settlementId
        });

    } catch (error) {
        console.error("Record settlement error:", error);

        return res.status(400).json({
            success: false,
            message: error.message || "Could not record settlement."
        });
    }
});

module.exports = router;