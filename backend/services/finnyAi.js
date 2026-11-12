const db = require("../database/db");
const { getGroupLedger } = require("./ledger");

const DEFAULT_MODEL = "gemini-3.8-flash";

class FinnyAiError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "FinnyAiError";
        this.code = code;
    }
}

function geminiModel() {
    const requested = String(process.env.GEMINI_MODEL || "").trim();

    if (/^gemini-[a-z0-9][a-z0-9.-]{0,80}$/i.test(requested)) {
        return requested;
    }

    return DEFAULT_MODEL;
}

function geminiConfigured() {
    return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
}

function money(cents) {
    const amount = Number.isInteger(cents) ? cents : Math.round(Number(cents) || 0);
    const sign = amount < 0 ? "-" : "";
    const absolute = Math.abs(amount);

    return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function detectCategory(description) {
    const text = String(description || "").toLowerCase();

    if (/restaurant|food|pizza|burger|coffee|cafe|lunch|dinner|breakfast|meal|snack|drink|grocery|groceries|supermarket/.test(text)) {
        return "Food";
    }

    if (/uber|taxi|bus|train|metro|fuel|petrol|parking|transport|flight|travel/.test(text)) {
        return "Transport";
    }

    if (/movie|cinema|game|concert|party|netflix|entertainment|museum/.test(text)) {
        return "Entertainment";
    }

    if (/shirt|shoes|clothes|shopping|store|mall|jacket|dress/.test(text)) {
        return "Shopping";
    }

    if (/hotel|hostel|airbnb|accommodation|rent/.test(text)) {
        return "Accommodation";
    }

    if (/electricity|water bill|internet|wifi|gas bill|utility/.test(text)) {
        return "Utilities";
    }

    if (/medicine|pharmacy|doctor|medical|hospital/.test(text)) {
        return "Health";
    }

    return "Other";
}

function clip(value, max) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function summarizeExpenses(rows) {
    const categories = new Map();

    rows.forEach(row => {
        const category = detectCategory(row.description);
        const current = categories.get(category) || { name: category, totalCents: 0, count: 0 };
        current.totalCents += Number(row.amount_cents) || 0;
        current.count += 1;
        categories.set(category, current);
    });

    return [...categories.values()]
        .sort((a, b) => b.totalCents - a.totalCents)
        .map(category => ({
            name: category.name,
            total: money(category.totalCents),
            count: category.count
        }));
}

function recentExpenses(rows, nameField) {
    return rows.slice(0, 8).map(row => {
        const item = {
            description: clip(row.description, 80) || "Expense",
            amount: money(Number(row.amount_cents) || 0)
        };

        if (nameField) {
            item.paidBy = clip(row[nameField], 40) || "Unknown";
        }

        return item;
    });
}

function conversationText(question, history) {
    return [question, ...history.map(item => item.text)].join("\n");
}

function wantsPersonal(mode, text) {
    return mode === "personal" || /\b(i|me|my|mine|personal)\b/i.test(text);
}

function wantsGroup(mode, text) {
    return mode === "group" ||
        /\b(group|member|owe|owes|owed|settlement|settle|shared|split|who)\b/i.test(text);
}

function groupSnapshot(groupId) {
    const group = db.prepare(`
        SELECT name
        FROM groups
        WHERE id = ?
    `).get(groupId);

    const totals = db.prepare(`
        SELECT COUNT(id) AS count, COALESCE(SUM(amount_cents), 0) AS total
        FROM expenses
        WHERE group_id = ?
    `).get(groupId);

    const expenses = db.prepare(`
        SELECT description, amount_cents
        FROM expenses
        WHERE group_id = ?
        ORDER BY id DESC
        LIMIT 200
    `).all(groupId);

    const payerNames = db.prepare(`
        SELECT e.id, e.description, e.amount_cents, m.name AS payer_name
        FROM expenses e
        JOIN members m ON m.id = e.payer_id
        WHERE e.group_id = ?
        ORDER BY e.id DESC
        LIMIT 8
    `).all(groupId);

    const ledger = getGroupLedger(groupId);
    const paid = db.prepare(`
        SELECT COUNT(id) AS count, COALESCE(SUM(amount_cents), 0) AS total
        FROM ss_settlement_records
        WHERE group_id = ? AND status = 'paid'
    `).get(groupId);

    return {
        name: clip(group?.name, 80) || "Group",
        memberCount: ledger.balances.length,
        totalSpent: money(Number(totals?.total) || 0),
        expenseCount: Number(totals?.count) || 0,
        categories: summarizeExpenses(expenses),
        recentExpenses: recentExpenses(payerNames, "payer_name"),
        categoryCoverage: expenses.length < (Number(totals?.count) || 0)
            ? "Category totals cover the latest 200 expenses. totalSpent is the full group total."
            : "Category totals cover every recorded group expense.",
        balances: ledger.balances.map(member => ({
            name: clip(member.name, 40),
            paid: money(member.totalPaid),
            fairShare: money(member.totalShare),
            verifiedBalance: money(member.balance),
            position: member.balance > 0
                ? "should receive"
                : member.balance < 0
                    ? "owes"
                    : "settled"
        })),
        unpaidSuggestions: ledger.settlements.map(item => ({
            from: clip(item.from, 40),
            to: clip(item.to, 40),
            amount: money(item.amountCents),
            status: "unpaid suggestion"
        })),
        paidSettlements: {
            count: Number(paid?.count) || 0,
            total: money(Number(paid?.total) || 0),
            note: "Already included in the verified balances."
        }
    };
}

function personalSnapshot(userId) {
    const totals = db.prepare(`
        SELECT COUNT(id) AS count, COALESCE(SUM(amount_cents), 0) AS total
        FROM personal_expenses
        WHERE user_id = ?
    `).get(userId);

    const rows = db.prepare(`
        SELECT description, amount_cents
        FROM personal_expenses
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100
    `).all(userId);

    return {
        totalSpent: money(Number(totals?.total) || 0),
        expenseCount: Number(totals?.count) || 0,
        categories: summarizeExpenses(rows),
        recentExpenses: recentExpenses(rows)
    };
}

function buildFinnySnapshot({ userId, groupId, mode, question, history }) {
    const text = conversationText(question, history);
    const snapshot = {
        currency: "USD",
        source: "verified SplitSmart ledger and expense records",
        rule: "Quote these amounts exactly. Do not recalculate balances or invent records."
    };

    if (groupId > 0 && wantsGroup(mode, text)) {
        snapshot.group = groupSnapshot(groupId);
    }

    if (wantsPersonal(mode, text)) {
        snapshot.personal = personalSnapshot(userId);
    }

    return snapshot;
}

function redactSecrets(value) {
    return String(value || "")
        .replace(/AIza[0-9A-Za-z\-_]{10,}/g, "[redacted]")
        .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .slice(0, 500);
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .slice(-6)
        .map(item => {
            const role = item?.role === "assistant" ? "model" : item?.role === "user" ? "user" : "";
            const text = clip(item?.text, 800);

            if (!role || !text) {
                return null;
            }

            return { role, text };
        })
        .filter(Boolean);
}

let clientPromise = null;
let clientKey = "";

async function getClient() {
    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();

    if (!apiKey) {
        throw new FinnyAiError(
            "Gemini is not configured.",
            "GEMINI_NOT_CONFIGURED"
        );
    }

    if (!clientPromise || clientKey !== apiKey) {
        clientKey = apiKey;
        clientPromise = import("@google/genai").then(({ GoogleGenAI }) => {
            return new GoogleGenAI({
                apiKey,
                httpOptions: { timeout: 20000, maxRetries: 0 }
            });
        });
    }

    return clientPromise;
}

async function generateFinnyAnswer({ question, history, snapshot }) {
    const turns = normalizeHistory(history);
    const contents = turns.map(turn => ({
        role: turn.role,
        parts: [{ text: turn.text }]
    }));

    contents.push({
        role: "user",
        parts: [{
            text: `Verified financial snapshot:\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}`
        }]
    });

    let response;

    try {
        const ai = await getClient();
        response = await ai.models.generateContent({
            model: geminiModel(),
            contents,
            config: {
                systemInstruction: [
                    "You are Finny, SplitSmart's financial assistant.",
                    "The verified snapshot in the latest user message is the only source of truth for amounts, balances, categories, and settlements.",
                    "Quote those amounts exactly. Never recalculate, round differently, or invent people, expenses, balances, or payments.",
                    "If the snapshot does not contain the answer, say what is missing.",
                    "Budgeting ideas and ways to reduce shared spending are suggestions. Say that a suggestion does not create, approve, capture, or mark a payment as paid.",
                    "Never claim that money moved or that a balance changed.",
                    "Be warm and concise, and you may ask one short follow-up question.",
                    "Do not ask for passwords, API keys, or payment credentials."
                ].join(" "),
                temperature: 0.4,
                maxOutputTokens: 700
            }
        });
    } catch (error) {
        if (error instanceof FinnyAiError) {
            throw error;
        }

        console.error("Gemini request failed:", redactSecrets(error?.message));

        throw new FinnyAiError(
            "Gemini could not answer right now.",
            "GEMINI_UNAVAILABLE"
        );
    }

    const answer = clip(response?.text, 2500);

    if (!answer) {
        throw new FinnyAiError(
            "Gemini returned an empty answer.",
            "GEMINI_UNAVAILABLE"
        );
    }

    return {
        answer,
        model: geminiModel()
    };
}

module.exports = {
    FinnyAiError,
    geminiConfigured,
    geminiModel,
    buildFinnySnapshot,
    generateFinnyAnswer,
    getGeminiClient: getClient,
    redactSecrets
};
