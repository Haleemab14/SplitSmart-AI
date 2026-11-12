const db = require("../database/db");
const { elasticClient, elasticConfigured, elasticReady } = require("../config/elastic");

const INDEX = "splitsmart-workspace";

function authorizedGroupIds(userId) {
    return db.prepare(`
        SELECT g.id
        FROM groups g
        WHERE g.owner_id = ?
           OR EXISTS (
               SELECT 1
               FROM group_member_identity i
               WHERE i.group_id = g.id
                 AND i.user_id = ?
           )
    `).all(userId, userId).map(row => row.id);
}

function scopedGroupIds(userId, groupId) {
    const allowed = authorizedGroupIds(userId);

    if (Number.isInteger(groupId) && groupId > 0) {
        return allowed.includes(groupId) ? [groupId] : [];
    }

    return allowed;
}

function likeValue(query) {
    return `%${String(query).replace(/[%_]/g, "")}%`;
}

function sqliteSearch(userId, query, groupId) {
    const ids = scopedGroupIds(userId, groupId);
    const like = likeValue(query);
    const results = [];

    if (ids.length) {
        const placeholders = ids.map(() => "?").join(", ");

        db.prepare(`
            SELECT id, name
            FROM groups
            WHERE id IN (${placeholders})
              AND name LIKE ? COLLATE NOCASE
            ORDER BY name COLLATE NOCASE
            LIMIT 10
        `).all(...ids, like).forEach(group => {
            results.push({
                kind: "group",
                groupId: group.id,
                groupName: group.name,
                title: group.name
            });
        });

        db.prepare(`
            SELECT DISTINCT m.name AS merchant, g.id AS groupId, g.name AS groupName
            FROM members m
            JOIN groups g ON g.id = m.group_id
            WHERE g.id IN (${placeholders})
              AND m.name LIKE ? COLLATE NOCASE
            ORDER BY m.name COLLATE NOCASE
            LIMIT 15
        `).all(...ids, like).forEach(row => {
            results.push({
                kind: "merchant",
                groupId: row.groupId,
                groupName: row.groupName,
                merchant: row.merchant,
                title: row.merchant
            });
        });

        db.prepare(`
            SELECT
                e.id AS expenseId,
                e.description,
                e.amount_cents AS amountCents,
                e.created_at AS createdAt,
                m.name AS payerName,
                g.id AS groupId,
                g.name AS groupName
            FROM expenses e
            JOIN members m ON m.id = e.payer_id
            JOIN groups g ON g.id = e.group_id
            WHERE e.group_id IN (${placeholders})
              AND (
                  e.description LIKE ? COLLATE NOCASE
                  OR m.name LIKE ? COLLATE NOCASE
                  OR g.name LIKE ? COLLATE NOCASE
              )
            ORDER BY e.id DESC
            LIMIT 25
        `).all(...ids, like, like, like).forEach(row => {
            results.push({
                kind: "expense",
                expenseId: row.expenseId,
                groupId: row.groupId,
                groupName: row.groupName,
                description: row.description,
                payerName: row.payerName,
                merchant: row.payerName,
                amountCents: row.amountCents,
                createdAt: row.createdAt,
                title: row.description
            });
        });

        db.prepare(`
            SELECT
                sr.id,
                sr.amount_cents AS amountCents,
                sr.status,
                sr.created_at AS createdAt,
                g.id AS groupId,
                g.name AS groupName,
                payer.name AS payerName,
                payee.name AS payeeName
            FROM ss_settlement_records sr
            JOIN groups g ON g.id = sr.group_id
            JOIN members payer ON payer.id = sr.from_member_id
            JOIN members payee ON payee.id = sr.to_member_id
            WHERE sr.group_id IN (${placeholders})
              AND (
                  payer.name LIKE ? COLLATE NOCASE
                  OR payee.name LIKE ? COLLATE NOCASE
                  OR g.name LIKE ? COLLATE NOCASE
                  OR sr.status LIKE ? COLLATE NOCASE
              )
            ORDER BY sr.id DESC
            LIMIT 15
        `).all(...ids, like, like, like, like).forEach(row => {
            results.push({
                kind: "transaction",
                groupId: row.groupId,
                groupName: row.groupName,
                payerName: row.payerName,
                payeeName: row.payeeName,
                amountCents: row.amountCents,
                status: row.status,
                createdAt: row.createdAt,
                title: `${row.payerName} to ${row.payeeName}`
            });
        });
    }

    if (!Number.isInteger(groupId) || groupId <= 0) {
        db.prepare(`
            SELECT id, description, amount_cents AS amountCents, created_at AS createdAt
            FROM personal_expenses
            WHERE user_id = ?
              AND description LIKE ? COLLATE NOCASE
            ORDER BY id DESC
            LIMIT 10
        `).all(userId, like).forEach(row => {
            results.push({
                kind: "personal",
                expenseId: row.id,
                description: row.description,
                amountCents: row.amountCents,
                createdAt: row.createdAt,
                title: row.description
            });
        });
    }

    return results;
}

async function ensureIndex() {
    const exists = await elasticClient.indices.exists({ index: INDEX });

    if (!exists) {
        await elasticClient.indices.create({
            index: INDEX,
            mappings: {
                properties: {
                    kind: { type: "keyword" },
                    groupId: { type: "integer" },
                    userId: { type: "integer" },
                    title: { type: "text" },
                    description: { type: "text" },
                    merchant: { type: "text" },
                    groupName: { type: "text" },
                    payerName: { type: "text" },
                    payeeName: { type: "text" },
                    status: { type: "keyword" }
                }
            }
        });
    }
}

function documentsForUser(userId, groupId) {
    const ids = scopedGroupIds(userId, groupId);
    const docs = [];

    ids.forEach(id => {
        const group = db.prepare(`SELECT id, name FROM groups WHERE id = ?`).get(id);
        if (!group) return;

        docs.push({
            id: `group-${group.id}`,
            body: {
                kind: "group",
                groupId: group.id,
                groupName: group.name,
                title: group.name
            }
        });

        db.prepare(`
            SELECT DISTINCT name
            FROM members
            WHERE group_id = ? AND is_active = 1
        `).all(id).forEach(member => {
            docs.push({
                id: `merchant-${id}-${member.name}`,
                body: {
                    kind: "merchant",
                    groupId: id,
                    groupName: group.name,
                    merchant: member.name,
                    title: member.name
                }
            });
        });

        db.prepare(`
            SELECT e.id, e.description, e.amount_cents, e.created_at, m.name AS payer_name
            FROM expenses e
            JOIN members m ON m.id = e.payer_id
            WHERE e.group_id = ?
        `).all(id).forEach(expense => {
            docs.push({
                id: `expense-${id}-${expense.id}`,
                body: {
                    kind: "expense",
                    expenseId: expense.id,
                    groupId: id,
                    groupName: group.name,
                    description: expense.description,
                    payerName: expense.payer_name,
                    merchant: expense.payer_name,
                    amountCents: expense.amount_cents,
                    createdAt: expense.created_at,
                    title: expense.description
                }
            });
        });

        db.prepare(`
            SELECT sr.id, sr.amount_cents, sr.status, sr.created_at,
                   payer.name AS payer_name, payee.name AS payee_name
            FROM ss_settlement_records sr
            JOIN members payer ON payer.id = sr.from_member_id
            JOIN members payee ON payee.id = sr.to_member_id
            WHERE sr.group_id = ?
        `).all(id).forEach(row => {
            docs.push({
                id: `transaction-${id}-${row.id}`,
                body: {
                    kind: "transaction",
                    groupId: id,
                    groupName: group.name,
                    payerName: row.payer_name,
                    payeeName: row.payee_name,
                    amountCents: row.amount_cents,
                    status: row.status,
                    createdAt: row.created_at,
                    title: `${row.payer_name} to ${row.payee_name}`
                }
            });
        });
    });

    if (!Number.isInteger(groupId) || groupId <= 0) {
        db.prepare(`
            SELECT id, description, amount_cents, created_at
            FROM personal_expenses
            WHERE user_id = ?
        `).all(userId).forEach(row => {
            docs.push({
                id: `personal-${userId}-${row.id}`,
                body: {
                    kind: "personal",
                    userId,
                    expenseId: row.id,
                    description: row.description,
                    amountCents: row.amount_cents,
                    createdAt: row.created_at,
                    title: row.description
                }
            });
        });
    }

    return docs;
}

async function indexAuthorized(userId, groupId) {
    const docs = documentsForUser(userId, groupId);
    if (!docs.length) return;

    const operations = [];
    docs.forEach(doc => {
        operations.push({ index: { _index: INDEX, _id: doc.id } });
        operations.push(doc.body);
    });

    const bulkResult = await elasticClient.bulk({ operations, refresh: "wait_for" });
    if (bulkResult.errors) {
        throw new Error("Elasticsearch could not index authorized records.");
    }
}

async function elasticSearch(userId, query, groupId) {
    const ids = scopedGroupIds(userId, groupId);
    await ensureIndex();
    await indexAuthorized(userId, groupId);

    const filters = [];
    if (ids.length) {
        filters.push({ terms: { groupId: ids } });
    }

    const should = [
        {
            bool: {
                must: [
                    { term: { kind: "personal" } },
                    { term: { userId } }
                ]
            }
        }
    ];

    if (filters.length) {
        should.unshift({ bool: { filter: filters } });
    }

    const result = await elasticClient.search({
        index: INDEX,
        size: 40,
        query: {
            bool: {
                must: [
                    {
                        multi_match: {
                            query,
                            fields: [
                                "title^3",
                                "description^2",
                                "merchant^2",
                                "groupName",
                                "payerName",
                                "payeeName",
                                "status"
                            ],
                            fuzziness: "AUTO"
                        }
                    }
                ],
                filter: [
                    {
                        bool: { should, minimum_should_match: 1 }
                    }
                ]
            }
        }
    });

    return (result.hits.hits || []).map(hit => ({
        ...hit._source,
        score: hit._score
    }));
}

async function searchWorkspace({ userId, query, groupId }) {
    const text = String(query || "").trim();

    if (text.length < 2 || text.length > 120) {
        return {
            status: 400,
            body: {
                success: false,
                message: "Search must contain between 2 and 120 characters."
            }
        };
    }

    if (Number.isInteger(groupId) && groupId > 0 && !scopedGroupIds(userId, groupId).length) {
        return {
            status: 404,
            body: { success: false, message: "Group not found." }
        };
    }

    if (elasticConfigured && await elasticReady()) {
        try {
            const results = await elasticSearch(userId, text, groupId);
            return {
                status: 200,
                body: {
                    success: true,
                    query: text,
                    count: results.length,
                    results,
                    source: "elasticsearch",
                    note: "SQLite remains the financial source of truth. Search does not change balances."
                }
            };
        } catch (error) {
            console.error("Elasticsearch search failed. Using SQLite.");
        }
    }

    const results = sqliteSearch(userId, text, groupId);
    return {
        status: 200,
        body: {
            success: true,
            query: text,
            count: results.length,
            results,
            source: elasticConfigured ? "sqlite-fallback" : "sqlite",
            note: "SQLite remains the financial source of truth. Search does not change balances."
        }
    };
}

module.exports = {
    searchWorkspace,
    elasticConfigured,
    elasticReady
};
