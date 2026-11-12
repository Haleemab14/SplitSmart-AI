const { FinnyAiError, geminiModel, getGeminiClient, redactSecrets } = require("./finnyAi");
const tools = require("./finnyTools");

const DECLARATIONS = [
    ["get_my_groups", "List the signed-in user's groups and member names.", {}],
    ["get_group_balances", "Read verified ledger balances for one owned group.", { groupId: "number", groupName: "string" }],
    ["get_outstanding_settlements", "Read who owes whom from the ledger. Do not invent amounts.", { groupId: "number", groupName: "string" }],
    ["get_expense_history", "Read recent group expenses.", { groupId: "number", groupName: "string", limit: "number" }],
    ["get_spending_summary", "Read the group's verified spending total, count, and average.", { groupId: "number", groupName: "string" }],
    ["get_spending_by_category", "Read category totals derived from stored expense descriptions.", { groupId: "number", groupName: "string" }],
    ["search_expenses", "Find expenses in one owned group by a short description query.", { groupId: "number", groupName: "string", query: "string" }],
    ["get_payment_history", "Read settlement notes and verified PayPal captures. Do not treat unpaid notes as paid.", { groupId: "number", groupName: "string" }],
    ["get_my_payment_requests", "Read the signed-in member's pending challans, who they owe, who owes them, and verified captures.", {}],
    ["prepare_expense_creation", "Stage a new equal-split expense. It is not saved until the user approves.", { groupId: "number", groupName: "string", description: "string", amount: "string", payerName: "string" }],
    ["prepare_expense_update", "Stage an update to a non-itemized expense. It is not saved until approval.", { groupId: "number", groupName: "string", expenseId: "number", currentDescription: "string", description: "string", amount: "string", payerName: "string" }],
    ["prepare_group_creation", "Stage a new group. It is not created until approval.", { name: "string", members: "array" }],
    ["prepare_settlement", "Stage an unpaid settlement note for a ledger pair. Do not pass an amount; the ledger decides it.", { groupId: "number", groupName: "string", fromName: "string", toName: "string" }],
    ["prepare_paypal_payment", "Stage a PayPal Sandbox payment for the signed-in member's own debt. Do not pass an amount. This does not capture or mark anything paid.", { groupId: "number", groupName: "string", fromName: "string", toName: "string" }],
    ["prepare_payment_request", "Stage a pending challan for someone who owes the signed-in member. Approval does not mark it paid.", { groupId: "number", groupName: "string", fromName: "string" }],
    ["prepare_receipt_processing", "Stage opening the receipt scanner. This does not create an expense.", { groupId: "number", groupName: "string" }],
    ["prepare_notification", "Stage an in-app reminder. No email or external message is sent.", { groupId: "number", groupName: "string", title: "string", message: "string" }]
].map(([name, description, properties]) => ({
    name,
    description,
    parametersJsonSchema: {
        type: "object",
        properties: Object.fromEntries(Object.entries(properties).map(([key, type]) => [
            key,
            type === "array"
                ? { type: "array", items: { type: "string" } }
                : { type }
        ]))
    }
}));

function readArgs(call) {
    if (call?.args && typeof call.args === "object") {
        return call.args;
    }

    return {};
}

function progressLabel(name) {
    const labels = {
        get_my_groups: "Checked your groups",
        get_group_balances: "Read ledger balances",
        get_outstanding_settlements: "Read outstanding settlements",
        get_expense_history: "Read expense history",
        get_spending_summary: "Read the spending summary",
        get_spending_by_category: "Read spending by category",
        search_expenses: "Searched expenses",
        get_payment_history: "Read payment history",
        get_my_payment_requests: "Read your payment requests",
        prepare_expense_creation: "Prepared an expense",
        prepare_expense_update: "Prepared an expense update",
        prepare_group_creation: "Prepared a group",
        prepare_settlement: "Prepared a settlement note",
        prepare_paypal_payment: "Prepared a PayPal Sandbox payment",
        prepare_payment_request: "Prepared a payment request",
        prepare_receipt_processing: "Prepared receipt scanning",
        prepare_notification: "Prepared a reminder"
    };

    return labels[name] || "Checked a SplitSmart tool";
}

async function reply({ userId, groupId, mode, question, history }) {
    const contents = (Array.isArray(history) ? history : [])
        .slice(-6)
        .map(item => {
            const role = item?.role === "assistant" ? "model" : item?.role === "user" ? "user" : "";
            const text = String(item?.text || "").trim().slice(0, 800);
            return role && text ? { role, parts: [{ text }] } : null;
        })
        .filter(Boolean);

    contents.push({
        role: "user",
        parts: [{
            text: `Selected group id: ${groupId > 0 ? groupId : "none"}. Mode: ${mode}. Question: ${question}`
        }]
    });

    const progress = [];
    const actions = [];
    const ai = await getGeminiClient();

    for (let step = 0; step < 4; step += 1) {
        let response;

        try {
            const request = {
                model: geminiModel(),
                contents,
                config: {
                    systemInstruction: [
                        "You are Finny, SplitSmart's assistant. Use the provided tools for financial facts.",
                        "Never invent amounts, people, balances, or payment status. Quote tool amounts exactly.",
                        "If someone asks who they need to pay, who owes them, or about a challan, call get_my_payment_requests and quote it. Direct the debtor to the challan link. Do not mark a payment paid.",
                        "prepare tools only stage an action. Tell the user to approve the card. Never say the action already happened.",
                        "Never say a PayPal payment succeeded. Capture is confirmed only by SplitSmart after PayPal verifies it.",
                        "Do not ask for passwords, API keys, or payment credentials. Do not send email.",
                        "Suggestions about saving money are suggestions, not completed actions."
                    ].join(" "),
                    temperature: 0.3,
                    maxOutputTokens: 800,
                    thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
                    tools: [{ functionDeclarations: DECLARATIONS }]
                }
            };
            try {
                response = await ai.models.generateContent(request);
            } catch (firstError) {
                const busy = /high demand|UNAVAILABLE|503/i.test(String(firstError?.message || ""));
                if (!busy) {
                    throw firstError;
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
                response = await ai.models.generateContent(request);
            }
        } catch (error) {
            if (error instanceof FinnyAiError) {
                throw error;
            }

            console.error("Finny agent request failed:", redactSecrets(error?.message));
            throw new FinnyAiError("Gemini could not answer right now.", "GEMINI_UNAVAILABLE");
        }

        const calls = response.functionCalls || [];

        if (!calls.length) {
            const answer = String(response.text || "").trim().slice(0, 2500);

            if (!answer && !actions.length) {
                throw new FinnyAiError("Gemini returned an empty answer.", "GEMINI_UNAVAILABLE");
            }

            return {
                answer: answer || "Review the card below. Nothing changes until you approve it.",
                model: geminiModel(),
                progress,
                actions
            };
        }

        const modelContent = response.candidates?.[0]?.content;

        if (!modelContent) {
            throw new FinnyAiError("Gemini could not answer right now.", "GEMINI_UNAVAILABLE");
        }

        contents.push(modelContent);
        const responseParts = [];

        for (const call of calls) {
            const name = String(call.name || "");
            progress.push(progressLabel(name));
            const result = tools.runTool(userId, name, readArgs(call), groupId);

            if (result?.action) {
                actions.push(result.action);
            }

            const responseBody = result?.ok
                ? {
                    needsApproval: result.needsApproval === true,
                    summary: result.action
                        ? `${result.action.title}. ${result.action.details.map(item => `${item.label}: ${item.value}`).join(" ")}`
                        : "Tool completed.",
                    data: result.action ? { approvalRequired: true } : result
                }
                : { error: result?.error || "The tool could not run." };

            responseParts.push({
                functionResponse: {
                    name,
                    id: call.id,
                    response: responseBody
                }
            });
        }

        contents.push({ role: "user", parts: responseParts });
    }

    return {
        answer: actions.length
            ? "Review the card below. Nothing changes until you approve it."
            : "I need a more specific question about your groups, expenses, or settlements.",
        model: geminiModel(),
        progress,
        actions
    };
}

module.exports = { reply };
