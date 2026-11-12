const db = require("../database/db");
const { userOwnsGroup } = require("./groupAccess");

db.exec(`
    CREATE TABLE IF NOT EXISTS member_claim_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (member_id) REFERENCES members(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS member_claims_one_pending_member
    ON member_claim_requests(group_id, member_id)
    WHERE status = 'pending';

    CREATE UNIQUE INDEX IF NOT EXISTS member_claims_one_pending_user
    ON member_claim_requests(group_id, user_id)
    WHERE status = 'pending';
`);

function cleanName(value, max) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > max) return "";
    return text;
}

function lookupGroup(name, ownerUsername) {
    const groupName = cleanName(name, 100);
    const ownerName = cleanName(ownerUsername, 25);

    if (!groupName || !ownerName) return null;

    const group = db.prepare(`
        SELECT g.id, g.name, g.owner_id AS ownerId, u.username AS ownerUsername
        FROM groups g
        JOIN users u ON u.id = g.owner_id
        WHERE g.name = ? COLLATE NOCASE
          AND u.username = ? COLLATE NOCASE
    `).get(groupName, ownerName);

    if (!group) return null;

    const members = db.prepare(`
        SELECT
            m.id,
            m.name,
            EXISTS (
                SELECT 1
                FROM group_member_identity i
                WHERE i.group_id = m.group_id
                  AND i.member_id = m.id
            ) AS linked,
            EXISTS (
                SELECT 1
                FROM member_claim_requests c
                WHERE c.group_id = m.group_id
                  AND c.member_id = m.id
                  AND c.status = 'pending'
            ) AS pending
        FROM members m
        WHERE m.group_id = ?
          AND m.is_active = 1
        ORDER BY m.name COLLATE NOCASE
    `).all(group.id);

    return {
        id: group.id,
        name: group.name,
        ownerUsername: group.ownerUsername,
        ownerId: group.ownerId,
        members: members.map(member => ({
            id: member.id,
            name: member.name,
            available: !member.linked && !member.pending
        }))
    };
}

function requestClaim(userId, groupId, memberId) {
    if (userOwnsGroup(groupId, userId)) {
        return {
            status: 400,
            body: {
                success: false,
                message: "You own this group. Choose your name from the group card instead."
            }
        };
    }

    const group = db.prepare(`
        SELECT id, name
        FROM groups
        WHERE id = ?
    `).get(groupId);

    if (!group) {
        return { status: 404, body: { success: false, message: "Group not found." } };
    }

    const member = db.prepare(`
        SELECT id, name
        FROM members
        WHERE id = ? AND group_id = ? AND is_active = 1
    `).get(memberId, groupId);

    if (!member) {
        return {
            status: 400,
            body: { success: false, message: "Choose an existing member in that group." }
        };
    }

    const linkedUser = db.prepare(`
        SELECT member_id
        FROM group_member_identity
        WHERE group_id = ? AND user_id = ?
    `).get(groupId, userId);

    if (linkedUser) {
        return {
            status: 409,
            body: {
                success: false,
                message: "Your account is already linked to a member in this group."
            }
        };
    }

    const linkedMember = db.prepare(`
        SELECT user_id
        FROM group_member_identity
        WHERE group_id = ? AND member_id = ?
    `).get(groupId, memberId);

    if (linkedMember) {
        return {
            status: 409,
            body: {
                success: false,
                message: "That member is already linked to an account."
            }
        };
    }

    try {
        const result = db.prepare(`
            INSERT INTO member_claim_requests (
                group_id, user_id, member_id, status, updated_at
            )
            VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
        `).run(groupId, userId, memberId);

        return {
            status: 201,
            body: {
                success: true,
                message: "Request sent. The group owner must approve it before the member is linked.",
                claim: {
                    id: Number(result.lastInsertRowid),
                    groupId,
                    groupName: group.name,
                    memberId: member.id,
                    memberName: member.name,
                    status: "pending"
                }
            }
        };
    } catch (error) {
        if (String(error.message).includes("UNIQUE") || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return {
                status: 409,
                body: {
                    success: false,
                    message: "A request for that member is already waiting for the owner."
                }
            };
        }

        throw error;
    }
}

function listMine(userId) {
    return db.prepare(`
        SELECT
            c.id,
            c.group_id AS groupId,
            g.name AS groupName,
            c.member_id AS memberId,
            m.name AS memberName,
            u.username AS ownerUsername,
            c.status,
            c.created_at AS createdAt
        FROM member_claim_requests c
        JOIN groups g ON g.id = c.group_id
        JOIN members m ON m.id = c.member_id
        JOIN users u ON u.id = g.owner_id
        WHERE c.user_id = ?
        ORDER BY c.id DESC
    `).all(userId);
}

function listIncoming(userId) {
    return db.prepare(`
        SELECT
            c.id,
            c.group_id AS groupId,
            g.name AS groupName,
            c.member_id AS memberId,
            m.name AS memberName,
            u.username AS requesterUsername,
            c.status,
            c.created_at AS createdAt
        FROM member_claim_requests c
        JOIN groups g ON g.id = c.group_id
        JOIN members m ON m.id = c.member_id
        JOIN users u ON u.id = c.user_id
        WHERE g.owner_id = ?
          AND c.status = 'pending'
        ORDER BY c.id DESC
    `).all(userId);
}

function decideClaim(ownerId, groupId, claimId, decision) {
    if (!userOwnsGroup(groupId, ownerId)) {
        return { status: 404, body: { success: false, message: "Group not found." } };
    }

    const claim = db.prepare(`
        SELECT *
        FROM member_claim_requests
        WHERE id = ? AND group_id = ?
    `).get(claimId, groupId);

    if (!claim) {
        return { status: 404, body: { success: false, message: "Join request not found." } };
    }

    if (claim.status !== "pending") {
        return {
            status: 409,
            body: { success: false, message: "This request has already been handled." }
        };
    }

    if (decision === "decline") {
        const updated = db.prepare(`
            UPDATE member_claim_requests
            SET status = 'declined', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
        `).run(claim.id);

        if (updated.changes !== 1) {
            return {
                status: 409,
                body: { success: false, message: "This request has already been handled." }
            };
        }

        return {
            status: 200,
            body: { success: true, message: "Join request declined. No member was linked." }
        };
    }

    try {
        const approved = db.transaction(() => {
            const current = db.prepare(`
                SELECT status, user_id, member_id
                FROM member_claim_requests
                WHERE id = ? AND group_id = ?
            `).get(claim.id, groupId);

            if (!current || current.status !== "pending") {
                return { ok: false, code: 409, message: "This request has already been handled." };
            }

            const member = db.prepare(`
                SELECT id
                FROM members
                WHERE id = ? AND group_id = ? AND is_active = 1
            `).get(current.member_id, groupId);

            if (!member) {
                return { ok: false, code: 409, message: "That member is no longer active." };
            }

            db.prepare(`
                INSERT INTO group_member_identity (group_id, user_id, member_id)
                VALUES (?, ?, ?)
            `).run(groupId, current.user_id, current.member_id);

            const updated = db.prepare(`
                UPDATE member_claim_requests
                SET status = 'approved', updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
            `).run(claim.id);

            if (updated.changes !== 1) {
                throw new Error("Claim was handled by another approval.");
            }

            return { ok: true };
        })();

        if (!approved.ok) {
            return {
                status: approved.code,
                body: { success: false, message: approved.message }
            };
        }

        return {
            status: 200,
            body: {
                success: true,
                message: "The account is now linked to the existing member."
            }
        };
    } catch (error) {
        if (String(error.message).includes("UNIQUE") || error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return {
                status: 409,
                body: {
                    success: false,
                    message: "That member or account is already linked in this group."
                }
            };
        }

        throw error;
    }
}

function cancelClaim(userId, claimId) {
    const claim = db.prepare(`
        SELECT id, status
        FROM member_claim_requests
        WHERE id = ? AND user_id = ?
    `).get(claimId, userId);

    if (!claim) {
        return { status: 404, body: { success: false, message: "Join request not found." } };
    }

    if (claim.status === "cancelled") {
        return {
            status: 200,
            body: { success: true, already: true, message: "This request is already cancelled." }
        };
    }

    if (claim.status !== "pending") {
        return {
            status: 409,
            body: { success: false, message: "This request can no longer be cancelled." }
        };
    }

    db.prepare(`
        UPDATE member_claim_requests
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'pending'
    `).run(claim.id, userId);

    return {
        status: 200,
        body: { success: true, message: "Join request cancelled. No member was linked." }
    };
}

module.exports = {
    lookupGroup,
    requestClaim,
    listMine,
    listIncoming,
    decideClaim,
    cancelClaim
};
