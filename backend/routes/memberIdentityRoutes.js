
const express = require("express");
const db = require("../database/db");
const { userOwnsGroup, userCanAccessGroup } = require("../services/groupAccess");
const claims = require("../services/memberClaims");

const router = express.Router();

router.get("/join-lookup", (req, res) => {
    try {
        const group = claims.lookupGroup(req.query.name, req.query.owner);

        if (!group) {
            return res.status(404).json({
                success: false,
                message: "No group matched that name and owner."
            });
        }

        res.json({
            success: true,
            group: {
                id: group.id,
                name: group.name,
                ownerUsername: group.ownerUsername,
                isOwner: group.ownerId === req.user.id,
                members: group.members
            }
        });
    } catch (error) {
        console.error("Join lookup error:", error);
        res.status(500).json({
            success: false,
            message: "Could not look up that group."
        });
    }
});

router.get("/member-claims/mine", (req, res) => {
    res.json({ success: true, claims: claims.listMine(req.user.id) });
});

router.get("/member-claims/incoming", (req, res) => {
    res.json({ success: true, claims: claims.listIncoming(req.user.id) });
});

router.post("/member-claims/:claimId/cancel", (req, res) => {
    const claimId = Number(req.params.claimId);

    if (!Number.isInteger(claimId) || claimId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid join request."
        });
    }

    try {
        const result = claims.cancelClaim(req.user.id, claimId);
        res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Cancel join request error:", error);
        res.status(500).json({
            success: false,
            message: "Could not cancel the join request."
        });
    }
});

router.post("/:groupId/member-claims", (req, res) => {
    const groupId = Number(req.params.groupId);
    const memberId = Number(req.body.memberId);

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(memberId) || memberId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Choose a group and an existing member."
        });
    }

    try {
        const result = claims.requestClaim(req.user.id, groupId, memberId);
        res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Create join request error:", error);
        res.status(500).json({
            success: false,
            message: "Could not send the join request."
        });
    }
});

router.post("/:groupId/member-claims/:claimId/approve", (req, res) => {
    respondToClaim(req, res, "approve");
});

router.post("/:groupId/member-claims/:claimId/decline", (req, res) => {
    respondToClaim(req, res, "decline");
});

function respondToClaim(req, res, decision) {
    const groupId = Number(req.params.groupId);
    const claimId = Number(req.params.claimId);

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(claimId) || claimId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid join request."
        });
    }

    try {
        const result = claims.decideClaim(req.user.id, groupId, claimId, decision);
        res.status(result.status).json(result.body);
    } catch (error) {
        console.error("Decide join request error:", error);
        res.status(500).json({
            success: false,
            message: "Could not update the join request."
        });
    }
}

// GET available members and the user's current selection.

// Store the member representing each logged-in user in each group.
// Existing group and member records remain unchanged.
db.exec(`
    CREATE TABLE IF NOT EXISTS group_member_identity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, user_id),
        UNIQUE(group_id, member_id)
    )
`);

// GET available members and the user's current selection.
router.get("/:groupId/my-member", (req, res) => {
    const groupId = Number(req.params.groupId);

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

    try {
        const members = db.prepare(`
            SELECT id, name
            FROM members
            WHERE group_id = ?
            ORDER BY name COLLATE NOCASE
        `).all(groupId);

        const selection = db.prepare(`
            SELECT member_id
            FROM group_member_identity
            WHERE group_id = ? AND user_id = ?
        `).get(groupId, req.user.id);

        res.json({
            success: true,
            members,
            myMemberId: selection
                ? selection.member_id
                : null
        });

    } catch (error) {
        console.error("Load member identity error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load your group identity."
        });
    }
});


// SAVE the member representing the logged-in user.
router.put("/:groupId/my-member", (req, res) => {
    const groupId = Number(req.params.groupId);
    const memberId = Number(req.body.memberId);

    if (
        !Number.isInteger(groupId) ||
        groupId <= 0 ||
        !Number.isInteger(memberId) ||
        memberId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Please select a valid group member."
        });
    }

    if (!userOwnsGroup(groupId, req.user.id)) {
        return res.status(404).json({
            success: false,
            message: "Group not found."
        });
    }

    const member = db.prepare(`
        SELECT id, name
        FROM members
        WHERE id = ?
          AND group_id = ?
          AND is_active = 1
    `).get(memberId, groupId);

    if (!member) {
        return res.status(400).json({
            success: false,
            message: "That member is not active in this group."
        });
    }

    try {
        db.prepare(`
            INSERT INTO group_member_identity
                (group_id, user_id, member_id)
            VALUES (?, ?, ?)
            ON CONFLICT(group_id, user_id)
            DO UPDATE SET
                member_id = excluded.member_id,
                updated_at = CURRENT_TIMESTAMP
        `).run(groupId, req.user.id, memberId);

        res.json({
            success: true,
            message: "Your group identity has been saved.",
            member
        });

    } catch (error) {
        console.error("Save member identity error:", error);

        if (
            error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
            return res.status(409).json({
                success: false,
                message: "That member is already linked to another account."
            });
        }

        res.status(500).json({
            success: false,
            message: "Could not save your group identity."
        });
    }
});

module.exports = router;
