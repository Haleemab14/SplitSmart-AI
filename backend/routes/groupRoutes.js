
const express = require("express");
const db = require("../database/db");
const router = express.Router();
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
// GET GROUPS BELONGING TO CURRENT USER
// ==========================================

router.get("/", (req, res) => {
    try {
        const owned = db.prepare(`
            SELECT g.*, i.member_id AS my_member_id, m.name AS my_member_name
            FROM groups g
            LEFT JOIN group_member_identity i
                ON i.group_id = g.id AND i.user_id = ?
            LEFT JOIN members m ON m.id = i.member_id
            WHERE g.owner_id = ?
            ORDER BY g.id DESC
        `).all(req.user.id, req.user.id);

        const joined = db.prepare(`
            SELECT g.*, i.member_id AS my_member_id, m.name AS my_member_name
            FROM groups g
            JOIN group_member_identity i
                ON i.group_id = g.id AND i.user_id = ?
            JOIN members m ON m.id = i.member_id
            WHERE g.owner_id != ?
            ORDER BY g.id DESC
        `).all(req.user.id, req.user.id);

        const getMembers = db.prepare(`
            SELECT id, name, is_active
            FROM members
            WHERE group_id = ?
            ORDER BY name COLLATE NOCASE
        `);

        const result = [
            ...owned.map(group => ({ ...group, role: "owner" })),
            ...joined.map(group => ({ ...group, role: "member" }))
        ].map(group => ({
            ...group,
            members: getMembers.all(group.id)
        }));

        res.json({
            success: true,
            groups: result
        });

    } catch (error) {
        console.error("Load groups error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load groups."
        });
    }
});

// ==========================================
// CREATE GROUP
// ==========================================

router.post("/", (req, res) => {
    const { name, members } = req.body;

    if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100 ||
        !Array.isArray(members) ||
        members.length < 1 ||
        members.length > 20 ||
        !members.every(member =>
            typeof member === "string" &&
            member.trim().length > 0 &&
            member.trim().length <= 60
        )
    ) {
        return res.status(400).json({
            success: false,
            message: "Enter a group name and valid member names."
        });
    }

    try {
        const createGroup = db.transaction(() => {
            const group = db.prepare(`
                INSERT INTO groups (name, owner_id)
                VALUES (?, ?)
            `).run(name.trim(), req.user.id);

            const groupId = Number(group.lastInsertRowid);

            const addMember = db.prepare(`
                INSERT INTO members (group_id, name)
                VALUES (?, ?)
            `);

            members.forEach(member => {
                addMember.run(groupId, member.trim());
            });

            return groupId;
        });

        const groupId = createGroup();

        res.status(201).json({
            success: true,
            message: "Group created successfully!",
            groupId
        });

    } catch (error) {
        console.error("Create group error:", error);

        res.status(500).json({
            success: false,
            message: "Could not create group."
        });
    }
});

module.exports = router;
