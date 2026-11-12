const db = require("../database/db");

function userOwnsGroup(groupId, userId) {
    return Boolean(
        db.prepare(`
            SELECT id
            FROM groups
            WHERE id = ? AND owner_id = ?
        `).get(groupId, userId)
    );
}

function userCanAccessGroup(groupId, userId) {
    return Boolean(
        db.prepare(`
            SELECT g.id
            FROM groups g
            WHERE g.id = ?
              AND (
                  g.owner_id = ?
                  OR EXISTS (
                      SELECT 1
                      FROM group_member_identity i
                      WHERE i.group_id = g.id
                        AND i.user_id = ?
                  )
              )
        `).get(groupId, userId, userId)
    );
}

module.exports = {
    userOwnsGroup,
    userCanAccessGroup
};
