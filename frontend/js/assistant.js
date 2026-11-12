
// ==========================================
// SPLITSMART AI — FINNY FINANCIAL ASSISTANT
// GROUP + PERSONAL MODE
// ==========================================

// ==========================================
// ELEMENTS
// ==========================================

const aiChatForm = document.getElementById("aiChatForm");
const aiQuestionInput = document.getElementById("aiQuestionInput");
const aiChatWindow = document.getElementById("aiChatWindow");
const aiSendButton = document.getElementById("aiSendButton");
const aiChatStatus = document.getElementById("aiChatStatus");

const assistantGroupSelect = document.getElementById("groupSelect");

function getActiveGroupId() {
    return document.getElementById("groupSelect")?.value ||
           document.getElementById("settlementGroupSelect")?.value ||
           document.getElementById("receiptGroupSelect")?.value ||
           null;
}

let assistantData = null;
let assistantMode = "group";
let finnyHistory = [];

// ==========================================
// SUGGESTED QUESTIONS
// ==========================================

const groupSuggestions = [
    "How much has our group spent in total?",
    "Who owes the most money?",
    "Explain our group balances.",
    "What are our biggest expenses?",
    "How could we reduce unnecessary shared expenses?"
];

const personalSuggestions = [
    "How much have I spent in total?",
    "What are my biggest expenses?",
    "Show my recent expenses.",
    "Give me my personal spending report."
];

// ==========================================
// FORMAT MONEY
// ==========================================

function formatMoney(cents) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format((Number(cents) || 0) / 100);
}

// ==========================================
// FORMAT DATE
// ==========================================

function formatExpenseDate(dateValue) {
    if (!dateValue) return "Date unavailable";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return date.toLocaleDateString();
}

// ==========================================
// DISPLAY CHAT MESSAGE
// ==========================================

function rememberTurn(role, text) {
    finnyHistory.push({
        role,
        text: String(text || "").slice(0, 800)
    });

    if (finnyHistory.length > 8) {
        finnyHistory.splice(0, finnyHistory.length - 8);
    }
}

function addChatMessage(message, sender = "assistant", label) {
    if (!aiChatWindow) return;

    const messageElement = document.createElement("div");

    messageElement.className =
        sender === "user"
            ? "ai-message user-message"
            : "ai-message assistant-message";

    const avatar = document.createElement("div");
    avatar.className = "ai-message-avatar";
    avatar.textContent = sender === "user" ? "You" : "SS";

    const content = document.createElement("div");
    content.className = "ai-message-content";

    const name = document.createElement("strong");

    name.textContent =
        sender === "user"
            ? "You"
            : (label || "Finny");

    const paragraph = document.createElement("p");
    paragraph.style.whiteSpace = "pre-line";
    paragraph.textContent = message;

    content.append(name, paragraph);
    messageElement.append(avatar, content);

    aiChatWindow.appendChild(messageElement);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    return messageElement;
}

function showFinnyPending() {
    return addChatMessage("Checking your records...", "assistant", "Finny");
}

function renderActionCard(action) {
    if (!aiChatWindow || !action?.id) return;

    const card = document.createElement("div");
    card.className = "finny-action-card";

    const title = document.createElement("strong");
    title.textContent = action.title || "Review this action";

    const note = document.createElement("p");
    note.textContent = "Finny prepared this. Nothing is saved until you approve.";

    card.append(title, note);

    (action.details || []).forEach(detail => {
        const line = document.createElement("p");
        line.textContent = `${detail.label}: ${detail.value}`;
        card.appendChild(line);
    });

    const controls = document.createElement("div");
    controls.className = "finny-action-actions";

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "button button-primary";
    approve.textContent = "Approve";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "button button-soft";
    cancel.textContent = "Cancel";

    approve.addEventListener("click", () => decideAction(action, card, "approve", controls));
    cancel.addEventListener("click", () => decideAction(action, card, "cancel", controls));
    controls.append(approve, cancel);
    card.appendChild(controls);
    aiChatWindow.appendChild(card);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
}

function setCardState(card, state, message) {
    card.classList.remove("is-success", "is-failed");
    card.classList.add(state === "success" ? "is-success" : "is-failed");
    const controls = card.querySelector(".finny-action-actions");

    if (controls) {
        controls.remove();
    }

    const line = document.createElement("p");
    line.textContent = message;
    card.appendChild(line);
}

async function decideAction(action, card, decision, controls) {
    controls.querySelectorAll("button").forEach(button => {
        button.disabled = true;
    });

    updateAssistantStatus(decision === "approve" ? "Finny is applying your approval..." : "Finny is cancelling that action...");

    try {
        const response = await fetch(
            `/api/groups/assistant-actions/${encodeURIComponent(action.id)}/${decision}`,
            {
                method: "POST",
                credentials: "same-origin"
            }
        );
        const data = await response.json();

        if (!response.ok || !data.success) {
            setCardState(card, "failed", data.message || "The action was not completed.");
            updateAssistantStatus(data.message || "The action was not completed.");
            return;
        }

        if (decision === "cancel") {
            setCardState(card, "failed", "Cancelled. Nothing was changed.");
            updateAssistantStatus("Action cancelled. Nothing was changed.");
            return;
        }

        const result = data.action?.result || {};

        if (result.orderId) {
            setCardState(
                card,
                "success",
                "Sandbox order ready. Approve it with PayPal. The settlement stays unpaid until capture is verified."
            );
            await renderPaypalApproval(card, result);
            return;
        }

        setCardState(card, "success", result.message || "Done.");
        updateAssistantStatus(result.message || "Action completed.");
    } catch (error) {
        setCardState(card, "failed", error.message || "The action could not be completed.");
        updateAssistantStatus(error.message || "The action could not be completed.");
    }
}

let finnyPaypalSdkPromise = null;

function loadFinnyPaypalSdk(clientId) {
    if (window.paypal?.Buttons) {
        return Promise.resolve();
    }

    if (!finnyPaypalSdkPromise) {
        finnyPaypalSdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
            script.onload = () => window.paypal?.Buttons
                ? resolve()
                : reject(new Error("PayPal Sandbox checkout did not load."));
            script.onerror = () => {
                finnyPaypalSdkPromise = null;
                reject(new Error("Could not load PayPal Sandbox."));
            };
            document.head.appendChild(script);
        });
    }

    return finnyPaypalSdkPromise;
}

function renderReceipt(card, receipt) {
    const box = document.createElement("div");
    box.className = "finny-receipt";

    [
        receipt.title || "Payment receipt",
        receipt.body || "",
        receipt.reference ? `Reference: ${receipt.reference}` : "",
        receipt.createdAt ? `Date: ${receipt.createdAt}` : "",
        "Verified by SplitSmart after PayPal capture. No email was sent."
    ].filter(Boolean).forEach(text => {
        const line = document.createElement("p");
        line.textContent = text;
        box.appendChild(line);
    });

    card.appendChild(box);
}

async function renderPaypalApproval(card, result) {
    const slot = document.createElement("div");
    slot.className = "paypal-button-slot";
    card.appendChild(slot);

    const configResponse = await fetch("/api/paypal/config", { credentials: "same-origin" });
    const config = await configResponse.json();

    if (!config.enabled || !config.clientId) {
        setCardState(card, "failed", "PayPal Sandbox is not available in this browser.");
        return;
    }

    await loadFinnyPaypalSdk(config.clientId);

    await window.paypal.Buttons({
        style: { layout: "horizontal", color: "gold", shape: "rect", label: "paypal", height: 36 },
        createOrder: () => result.orderId,
        onApprove: async (data) => {
            updateAssistantStatus("Confirming the PayPal capture...");
            const response = await fetch(
                `/api/groups/${encodeURIComponent(result.groupId)}/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
                { method: "POST", credentials: "same-origin" }
            );
            const capture = await response.json();

            if (!response.ok || !capture.success || capture.status !== "COMPLETED") {
                const line = document.createElement("p");
                line.textContent = capture.message || "PayPal did not verify this payment. The settlement is still unpaid.";
                card.appendChild(line);
                updateAssistantStatus(line.textContent);
                return;
            }

            updateAssistantStatus("PayPal capture verified. The settlement is paid.");

            if (capture.receipt) {
                renderReceipt(card, capture.receipt);
            }
        },
        onCancel: () => {
            const line = document.createElement("p");
            line.textContent = "PayPal approval was cancelled. The settlement is still unpaid.";
            card.appendChild(line);
        },
        onError: () => {
            const line = document.createElement("p");
            line.textContent = "PayPal could not open this payment. The settlement is still unpaid.";
            card.appendChild(line);
        }
    }).render(slot);
}

// ==========================================
// UPDATE SUGGESTED QUESTIONS
// ==========================================

function updateAssistantSuggestions() {
    const suggestions =
        assistantMode === "personal"
            ? personalSuggestions
            : groupSuggestions;

    const buttons = document.querySelectorAll(".ai-suggestion");

    buttons.forEach((button, index) => {
        if (!suggestions[index]) return;

        button.dataset.question = suggestions[index];
        button.textContent = suggestions[index];
    });
}

// ==========================================
// UPDATE ASSISTANT STATUS
// ==========================================

function updateAssistantStatus(message) {
    if (aiChatStatus) {
        aiChatStatus.textContent = message;
    }
}

// ==========================================
// DETECT EXPENSE MODE
// ==========================================

function setAssistantMode(mode) {
    if (mode !== "group" && mode !== "personal") {
        return;
    }

    assistantMode = mode;
    assistantData = null;
    finnyHistory = [];

    updateAssistantSuggestions();

    if (mode === "personal") {
        updateAssistantStatus(
            "Finny is ready to analyze your personal spending. 🐠"
        );
    } else {
        updateAssistantStatus(
            "Finny is ready to analyze your group finances. 🐠"
        );
    }
}

// Listen to the mode switch in expenses.js
document.addEventListener("expenseModeChanged", function (event) {
    const newMode = event.detail?.mode;

    if (newMode !== "group" && newMode !== "personal") {
        return;
    }

    assistantMode = newMode;
    assistantData = null;
    finnyHistory = [];

    updateAssistantSuggestions();

    updateAssistantStatus(
        newMode === "personal"
            ? "Finny is ready to analyze your personal spending. 🐠"
            : "Finny is ready to analyze your group finances. 🐠"
    );
});

// ==========================================
// LOAD GROUP DATA
// ==========================================

async function loadGroupAssistantData() {
    const groupId = getActiveGroupId();

    if (!groupId) {
        throw new Error("Please select a group first.");
    }

    const response = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/assistant-data`,
        {
            credentials: "same-origin"
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "Could not load group information."
        );
    }

    assistantData = data;

    return data;
}

// ==========================================
// LOAD PERSONAL EXPENSE DATA
// ==========================================

async function loadPersonalAssistantData() {
    const response = await fetch("/api/personal-expenses", {
        credentials: "same-origin"
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "Could not load your personal expenses."
        );
    }

    assistantData = data;

    return data;
}

// ==========================================
// LOAD DATA FOR ACTIVE MODE
// ==========================================

async function loadAssistantData() {
    if (assistantMode === "personal") {
        return await loadPersonalAssistantData();
    }

    return await loadGroupAssistantData();
}

// ==========================================
// SORT GROUP EXPENSES
// ==========================================

function getSortedExpenses(data) {
    return [...(data.expenses || [])].sort(
        (a, b) =>
            Number(b.amount_cents || 0) -
            Number(a.amount_cents || 0)
    );
}

// ==========================================
// SORT PERSONAL EXPENSES
// ==========================================

function getSortedPersonalExpenses(data) {
    return [...(data.expenses || [])].sort(
        (a, b) =>
            Number(b.amount_cents || 0) -
            Number(a.amount_cents || 0)
    );
}

// ==========================================
// GROUP MODE — TOTAL SPENDING
// ==========================================

function answerTotalSpending(data) {
    return (
        `Your group ${data.group.name} has spent ` +
        `${formatMoney(data.totalSpentCents)} across ` +
        `${data.expenseCount} expenses. 🐠`
    );
}

// ==========================================
// GROUP MODE — WHO OWES THE MOST?
// ==========================================

function answerWhoOwesMost(data) {
    const debtors = (data.balances || [])
        .filter(member => member.balanceCents < 0)
        .sort((a, b) => a.balanceCents - b.balanceCents);

    if (!debtors.length) {
        return "Wonderful! Nobody currently owes money in this group. 🫧";
    }

    const person = debtors[0];

    return (
        `${person.name} owes the most, with a balance of ` +
        `${formatMoney(Math.abs(person.balanceCents))}.`
    );
}

// ==========================================
// GROUP MODE — WHO IS OWED THE MOST?
// ==========================================

function answerWhoIsOwedMost(data) {
    const creditors = (data.balances || [])
        .filter(member => member.balanceCents > 0)
        .sort((a, b) => b.balanceCents - a.balanceCents);

    if (!creditors.length) {
        return "Nobody is currently owed money in this group.";
    }

    const person = creditors[0];

    return (
        `${person.name} is owed the most: ` +
        `${formatMoney(person.balanceCents)}.`
    );
}

// ==========================================
// GROUP MODE — ALL BALANCES
// ==========================================

function answerBalances(data) {
    if (!data.balances?.length) {
        return "There are no member balances available yet.";
    }

    const explanations = data.balances.map(member => {
        const balance = Number(member.balanceCents || 0);

        if (balance > 0) {
            return `${member.name} should receive ${formatMoney(balance)}.`;
        }

        if (balance < 0) {
            return `${member.name} owes ${formatMoney(Math.abs(balance))}.`;
        }

        return `${member.name} is completely settled up!`;
    });

    return (
        `Here is the financial breakdown for ${data.group.name}:\n\n` +
        explanations.join("\n")
    );
}

// ==========================================
// GROUP MODE — BIGGEST EXPENSES
// ==========================================

function answerBiggestExpenses(data) {
    const expenses = getSortedExpenses(data);

    if (!expenses.length) {
        return "This group doesn't have any expenses yet.";
    }

    const list = expenses.slice(0, 5).map((expense, index) =>
        `${index + 1}. ${expense.description} — ` +
        `${formatMoney(expense.amount_cents)} ` +
        `(paid by ${expense.payer_name || "Unknown"})`
    );

    return (
        `Here are the five biggest expenses in ${data.group.name}:\n\n` +
        list.join("\n")
    );
}

// ==========================================
// GROUP MODE — RECENT EXPENSES
// ==========================================

function answerExpenseHistory(data) {
    if (!data.expenses?.length) {
        return "There are no recorded expenses in this group yet.";
    }

    const recent = [...data.expenses].sort(
        (a, b) => Number(b.id || 0) - Number(a.id || 0)
    ).slice(0, 5);

    const list = recent.map((expense, index) =>
        `${index + 1}. ${expense.description}: ` +
        `${formatMoney(expense.amount_cents)}, paid by ` +
        `${expense.payer_name || "Unknown"}`
    );

    return `Here are your recent group expenses:\n\n${list.join("\n")}`;
}

// ==========================================
// GROUP MODE — HIGHEST PAYER
// ==========================================

function answerHighestSpender(data) {
    if (!data.expenses?.length) {
        return "There are no expenses to analyze yet.";
    }

    const spending = {};

    data.expenses.forEach(expense => {
        const name = expense.payer_name || "Unknown";

        spending[name] =
            (spending[name] || 0) +
            Number(expense.amount_cents || 0);
    });

    const rankings = Object.entries(spending)
        .sort((a, b) => b[1] - a[1]);

    const highest = rankings[0];

    const breakdown = rankings.map(([name, amount], index) =>
        `${index + 1}. ${name}: ${formatMoney(amount)}`
    );

    return (
        `${highest[0]} has paid the most in recorded group expenses: ` +
        `${formatMoney(highest[1])}.\n\n` +
        `Payment breakdown:\n${breakdown.join("\n")}\n\n` +
        `This compares amounts paid, not each person's final share.`
    );
}

// ==========================================
// GROUP MODE — AVERAGE EXPENSE
// ==========================================

function answerAverageExpense(data) {
    const expenses = data.expenses || [];

    if (!expenses.length) {
        return "There are no expenses to calculate an average yet.";
    }

    const total = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    return (
        `Your group's average expense is ` +
        `${formatMoney(total / expenses.length)}.\n\n` +
        `Calculated from ${expenses.length} recorded expenses.`
    );
}

// ==========================================
// GROUP MODE — UNUSUALLY LARGE EXPENSES
// ==========================================

function answerUnusualExpenses(data) {
    const expenses = data.expenses || [];

    if (expenses.length < 3) {
        return "I need at least three expenses to compare spending patterns.";
    }

    const amounts = expenses
        .map(expense => Number(expense.amount_cents || 0))
        .sort((a, b) => a - b);

    const middle = Math.floor(amounts.length / 2);

    const median = amounts.length % 2
        ? amounts[middle]
        : (amounts[middle - 1] + amounts[middle]) / 2;

    const unusual = expenses
        .filter(expense =>
            Number(expense.amount_cents || 0) > median * 2
        )
        .sort((a, b) =>
            Number(b.amount_cents || 0) -
            Number(a.amount_cents || 0)
        );

    if (!unusual.length) {
        return (
            `I couldn't identify expenses more than twice the ` +
            `group's median expense.\n\nMedian: ${formatMoney(median)}.`
        );
    }

    const list = unusual.slice(0, 5).map(expense =>
        `• ${expense.description}: ${formatMoney(expense.amount_cents)}`
    );

    return (
        `These expenses are unusually large compared with the group median:\n\n` +
        `${list.join("\n")}\n\n` +
        `Median expense: ${formatMoney(median)}.\n` +
        `This is a size comparison, not proof of an error.`
    );
}

// ==========================================
// GROUP MODE — ONE MEMBER'S BALANCE
// ==========================================

function answerMemberBalance(question, data) {
    const matchedMember = (data.balances || []).find(member =>
        question.includes(member.name.toLowerCase())
    );

    if (!matchedMember) {
        return null;
    }

    const balance = Number(matchedMember.balanceCents || 0);

    if (balance > 0) {
        return (
            `${matchedMember.name} should receive ${formatMoney(balance)}.\n\n` +
            `Their recorded payments exceed their allocated expense shares.`
        );
    }

    if (balance < 0) {
        return (
            `${matchedMember.name} currently owes ` +
            `${formatMoney(Math.abs(balance))}.\n\n` +
            `Their allocated expense shares exceed their recorded payments.`
        );
    }

    return `${matchedMember.name} is settled up. Their balance is $0.00.`;
}

// ==========================================
// GROUP MODE — SPENDING REPORT
// ==========================================

function answerSpendingInsights(data) {
    const expenses = data.expenses || [];

    if (!expenses.length) {
        return "Add some group expenses first, and I'll analyze your spending.";
    }

    const total = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    const average = total / expenses.length;
    const biggest = getSortedExpenses(data)[0];

    const payerTotals = {};

    expenses.forEach(expense => {
        const name = expense.payer_name || "Unknown";

        payerTotals[name] =
            (payerTotals[name] || 0) +
            Number(expense.amount_cents || 0);
    });

    const highestPayer = Object.entries(payerTotals)
        .sort((a, b) => b[1] - a[1])[0];

    return (
        `🐠 FINNY'S GROUP SPENDING REPORT\n\n` +
        `Group: ${data.group.name}\n` +
        `Total spending: ${formatMoney(total)}\n` +
        `Recorded expenses: ${expenses.length}\n` +
        `Average expense: ${formatMoney(average)}\n\n` +
        `Largest expense: ${biggest.description} ` +
        `(${formatMoney(biggest.amount_cents)})\n\n` +
        `Highest amount paid by: ${highestPayer[0]} ` +
        `(${formatMoney(highestPayer[1])})\n\n` +
        `Tip: Review large expenses and check item assignments.`
    );
}

// ==========================================
// GROUP MODE — SPENDING BY PAYER
// ==========================================

function answerSpendingByPayer(data) {
    if (!data.expenses?.length) {
        return "There are no expenses to analyze yet.";
    }

    const spending = {};

    data.expenses.forEach(expense => {
        const name = expense.payer_name || "Unknown";

        spending[name] =
            (spending[name] || 0) +
            Number(expense.amount_cents || 0);
    });

    const list = Object.entries(spending)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amount]) =>
            `${name}: ${formatMoney(amount)}`
        );

    return (
        `Here is how much each member has paid:\n\n` +
        `${list.join("\n")}\n\n` +
        `These figures represent payments made, not final amounts owed.`
    );
}

// ==========================================
// PERSONAL MODE — TOTAL SPENDING
// ==========================================

function answerPersonalTotal(data) {
    const expenses = data.expenses || [];

    const total = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    return (
        `🐠 Your total personal spending is ${formatMoney(total)}.\n\n` +
        `You have recorded ${expenses.length} personal expenses.`
    );
}

// ==========================================
// PERSONAL MODE — BIGGEST EXPENSES
// ==========================================

function answerPersonalBiggest(data) {
    const expenses = getSortedPersonalExpenses(data);

    if (!expenses.length) {
        return "You don't have any personal expenses recorded yet.";
    }

    const list = expenses.slice(0, 5).map((expense, index) =>
        `${index + 1}. ${expense.description || "Unnamed expense"} — ` +
        `${formatMoney(expense.amount_cents)}`
    );

    return `Here are your five biggest personal expenses:\n\n${list.join("\n")}`;
}

// ==========================================
// PERSONAL MODE — RECENT EXPENSES
// ==========================================

function answerPersonalHistory(data) {
    const expenses = [...(data.expenses || [])].sort(
        (a, b) => Number(b.id || 0) - Number(a.id || 0)
    );

    if (!expenses.length) {
        return "You don't have any personal expenses recorded yet.";
    }

    const list = expenses.slice(0, 5).map((expense, index) =>
        `${index + 1}. ${expense.description || "Unnamed expense"} — ` +
        `${formatMoney(expense.amount_cents)}` +
        (expense.created_at
            ? ` (${formatExpenseDate(expense.created_at)})`
            : "")
    );

    return `Here are your recent personal expenses:\n\n${list.join("\n")}`;
}

// ==========================================
// PERSONAL MODE — AVERAGE EXPENSE
// ==========================================

function answerPersonalAverage(data) {
    const expenses = data.expenses || [];

    if (!expenses.length) {
        return "Add some personal expenses first so I can calculate your average.";
    }

    const total = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    return (
        `Your average personal expense is ` +
        `${formatMoney(total / expenses.length)}.\n\n` +
        `Calculated from ${expenses.length} recorded expenses.`
    );
}

// ==========================================
// PERSONAL MODE — SPENDING REPORT
// ==========================================

function answerPersonalInsights(data) {
    const expenses = data.expenses || [];

    if (!expenses.length) {
        return "Add some personal expenses first, and I'll prepare your report. 🐠";
    }

    const total = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    const average = total / expenses.length;
    const biggest = getSortedPersonalExpenses(data)[0];

    const smallest = [...expenses].sort(
        (a, b) =>
            Number(a.amount_cents || 0) -
            Number(b.amount_cents || 0)
    )[0];

    return (
        `🐠 FINNY'S PERSONAL SPENDING REPORT\n\n` +
        `Total personal spending: ${formatMoney(total)}\n` +
        `Recorded expenses: ${expenses.length}\n` +
        `Average expense: ${formatMoney(average)}\n\n` +
        `Largest expense: ${biggest.description || "Unnamed"} ` +
        `(${formatMoney(biggest.amount_cents)})\n\n` +
        `Smallest expense: ${smallest.description || "Unnamed"} ` +
        `(${formatMoney(smallest.amount_cents)})\n\n` +
        `Tip: Review your largest expenses to understand where ` +
        `most of your personal spending goes.`
    );
}

// ==========================================
// PERSONAL MODE — UNUSUALLY LARGE EXPENSES
// ==========================================

function answerPersonalUnusual(data) {
    const expenses = data.expenses || [];

    if (expenses.length < 3) {
        return "I need at least three personal expenses to compare spending patterns.";
    }

    const amounts = expenses
        .map(expense => Number(expense.amount_cents || 0))
        .sort((a, b) => a - b);

    const middle = Math.floor(amounts.length / 2);

    const median = amounts.length % 2
        ? amounts[middle]
        : (amounts[middle - 1] + amounts[middle]) / 2;

    const unusual = expenses
        .filter(expense =>
            Number(expense.amount_cents || 0) > median * 2
        )
        .sort((a, b) =>
            Number(b.amount_cents || 0) -
            Number(a.amount_cents || 0)
        );

    if (!unusual.length) {
        return (
            `I couldn't find personal expenses more than twice your median.\n\n` +
            `Your median expense is ${formatMoney(median)}.`
        );
    }

    const list = unusual.slice(0, 5).map(expense =>
        `• ${expense.description || "Unnamed expense"}: ` +
        `${formatMoney(expense.amount_cents)}`
    );

    return (
        `These personal expenses are unusually large compared with your median:\n\n` +
        `${list.join("\n")}\n\n` +
        `Your median expense is ${formatMoney(median)}.\n` +
        `This is a size comparison, not proof of an error.`
    );
}

// ==========================================
// PERSONAL MODE — QUESTION UNDERSTANDING
// ==========================================

function generatePersonalAnswer(question, data) {
    const q = question.toLowerCase().trim();

    // Do not answer group-only questions using personal data.
    if (
        q.includes("group") ||
        q.includes("member") ||
        q.includes("settlement") ||
        q.includes("who owes") ||
        q.includes("who is owed") ||
        q.includes("debtor") ||
        q.includes("creditor") ||
        q.includes("split between")
    ) {
        return (
            "That question is for Group mode. 🫧\n\n" +
            "Switch to Group mode and select a group to ask Finny " +
            "about member balances, shared expenses and settlements."
        );
    }

    if (
        q.includes("unusual") ||
        q.includes("suspicious") ||
        q.includes("abnormal") ||
        q.includes("too expensive") ||
        q.includes("overspending")
    ) {
        return answerPersonalUnusual(data);
    }

    if (
        q.includes("report") ||
        q.includes("insight") ||
        q.includes("analy") ||
        q.includes("financial health") ||
        q.includes("summary")
    ) {
        return answerPersonalInsights(data);
    }

    if (
        q.includes("average") ||
        q.includes("typical expense")
    ) {
        return answerPersonalAverage(data);
    }

    if (
        q.includes("biggest") ||
        q.includes("largest") ||
        q.includes("most expensive") ||
        q.includes("highest expense")
    ) {
        return answerPersonalBiggest(data);
    }

    if (
        q.includes("recent") ||
        q.includes("history") ||
        q.includes("receipts") ||
        q.includes("latest")
    ) {
        return answerPersonalHistory(data);
    }

    if (
        q.includes("total") ||
        q.includes("spent") ||
        q.includes("spending") ||
        q.includes("how much have i") ||
        q.includes("how much did i")
    ) {
        return answerPersonalTotal(data);
    }

    return (
        "I'm ready to help with your personal spending! 🐠\n\n" +
        "You can ask me:\n" +
        "• How much have I spent in total?\n" +
        "• What are my biggest expenses?\n" +
        "• Show my recent expenses.\n" +
        "• What is my average expense?\n" +
        "• Do I have any unusually large expenses?\n" +
        "• Give me my personal spending report."
    );
}

// ==========================================
// GROUP MODE — SETTLEMENT SUGGESTIONS
// ==========================================

function answerSettlementSuggestions(data) {
    const settlements = data.settlements || [];

    if (!settlements.length) {
        return `All balances in ${data.group.name} are settled up! No payments are currently needed.`;
    }

    const list = settlements.map((s, index) =>
        `${index + 1}. ${s.from} pays ${s.to}: ${formatMoney(s.amountCents)}`
    );

    const totalCents = settlements.reduce((sum, s) => sum + s.amountCents, 0);

    return (
        `Smart settlement suggestions for ${data.group.name}:\n\n` +
        list.join("\n") +
        `\n\nTotal pending settlement transfers: ${formatMoney(totalCents)}.\n` +
        `Tip: Use the Settlements page to review payments or record via PayPal Sandbox.`
    );
}

// ==========================================
// GROUP MODE — SPENDING CATEGORIES
// ==========================================

function answerSpendingCategories(data) {
    const categories = data.categories || [];

    if (!categories.length) {
        return `There are no categorized expenses recorded for ${data.group.name} yet.`;
    }

    const list = categories.map((cat, index) =>
        `${index + 1}. ${cat.name}: ${formatMoney(cat.totalCents)} (${cat.count} expense${cat.count === 1 ? "" : "s"})`
    );

    return `Category spending breakdown for ${data.group.name}:\n\n${list.join("\n")}`;
}

// ==========================================
// GROUP MODE — MONTHLY SPENDING
// ==========================================

function answerMonthlySpending(data) {
    const months = data.monthly || [];

    if (!months.length) {
        return `There is no monthly spending history recorded for ${data.group.name} yet.`;
    }

    const list = months.map(m =>
        `• ${m.month}: ${formatMoney(m.totalCents)} (${m.count} expense${m.count === 1 ? "" : "s"})`
    );

    return `Monthly spending trends for ${data.group.name}:\n\n${list.join("\n")}`;
}

// ==========================================
// GROUP MODE — QUESTION UNDERSTANDING
// ==========================================

function generateGroupAnswer(question, data) {
    const q = question.toLowerCase().trim();

    // Settlement suggestions & debt clearing
    if (
        q.includes("settle") ||
        q.includes("settlement") ||
        q.includes("pay back") ||
        q.includes("pay each other") ||
        q.includes("how to pay") ||
        q.includes("need to pay") ||
        q.includes("who do i pay") ||
        q.includes("who should i pay") ||
        q.includes("who do i owe") ||
        q.includes("owe money") ||
        q.includes("outstanding") ||
        q.includes("clear debt")
    ) {
        return answerSettlementSuggestions(data);
    }

    // Category breakdown
    if (
        q.includes("categor") ||
        q.includes("what do we spend on") ||
        q.includes("food") ||
        q.includes("grocer") ||
        q.includes("transport")
    ) {
        return answerSpendingCategories(data);
    }

    // Monthly trends
    if (
        q.includes("month") ||
        q.includes("trend") ||
        q.includes("over time")
    ) {
        return answerMonthlySpending(data);
    }

    // Specific member balance
    if (
        q.includes("how much does") ||
        q.includes("how much do") ||
        (q.includes("does ") && q.includes(" owe")) ||
        q.includes("balance of") ||
        (q.includes("explain ") && q.includes(" balance"))
    ) {
        const answer = answerMemberBalance(q, data);

        if (answer) return answer;
    }

    if (
        q.includes("who owes") ||
        q.includes("owes the most") ||
        q.includes("biggest debtor")
    ) {
        return answerWhoOwesMost(data);
    }

    if (
        q.includes("who is owed") ||
        q.includes("owed the most") ||
        q.includes("creditor")
    ) {
        return answerWhoIsOwedMost(data);
    }

    if (
        q.includes("unusual") ||
        q.includes("suspicious") ||
        q.includes("abnormal") ||
        q.includes("too expensive") ||
        q.includes("overspending")
    ) {
        return answerUnusualExpenses(data);
    }

    if (
        q.includes("insight") ||
        q.includes("analy") ||
        q.includes("report") ||
        q.includes("financial health")
    ) {
        return answerSpendingInsights(data);
    }

    if (
        q.includes("average") ||
        q.includes("typical expense")
    ) {
        return answerAverageExpense(data);
    }

    if (
        q.includes("highest spender") ||
        q.includes("spends the most") ||
        q.includes("paid the most") ||
        q.includes("spent the most") ||
        q.includes("who paid most")
    ) {
        return answerHighestSpender(data);
    }

    if (
        q.includes("each member") ||
        q.includes("per member") ||
        q.includes("by payer") ||
        q.includes("payment breakdown")
    ) {
        return answerSpendingByPayer(data);
    }

    if (
        q.includes("biggest expense") ||
        q.includes("most expensive") ||
        q.includes("highest expense") ||
        q.includes("largest expense")
    ) {
        return answerBiggestExpenses(data);
    }

    if (
        q.includes("balance") ||
        q.includes("settled") ||
        q.includes("who owes") ||
        q.includes("who is owed")
    ) {
        return answerBalances(data);
    }

    if (
        q.includes("total") ||
        q.includes("spent") ||
        q.includes("spending") ||
        q.includes("how much have we")
    ) {
        return answerTotalSpending(data);
    }

    if (
        q.includes("recent") ||
        q.includes("history") ||
        q.includes("expenses") ||
        q.includes("receipts")
    ) {
        return answerExpenseHistory(data);
    }

    return (
        "I'm ready to help analyze your group finances!\n\n" +
        "You can ask me:\n" +
        "• How much has our group spent?\n" +
        "• Who owes the most / who is owed the most?\n" +
        "• Explain everyone's balances.\n" +
        "• What are our suggested settlements?\n" +
        "• Show spending by category.\n" +
        "• Show monthly spending trends.\n" +
        "• What are our biggest expenses?\n" +
        "• Who has paid the most?\n" +
        "• Give me a group spending report.\n" +
        "• Search for an expense (e.g., search dinner)."
    );
}

// ==========================================
// FINNY — ELASTIC SMART SEARCH
// ==========================================

function isSmartSearchQuestion(question) {
    const q = question.toLowerCase();

    return (
        q.includes("find ") ||
        q.includes("search ") ||
        q.includes("look for ") ||
        q.includes("containing ") ||
        q.includes("expenses about ") ||
        q.includes("expense about ") ||
        q.includes("show me expenses for ")
    );
}

function extractSearchTerm(question) {
    return question
        .toLowerCase()
        .replace(/\b(find|search|look for|show me|show|please|expenses|expense|containing|about|for|where|which|are|the|that|have|we|our|group)\b/g, " ")
        .replace(/[?!.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function searchGroupExpenses(question) {
    const groupId = getActiveGroupId();

    if (!groupId) {
        throw new Error("Please select a group before searching.");
    }

    const searchTerm = extractSearchTerm(question);

    if (searchTerm.length < 2) {
        throw new Error("Please enter a more specific expense search.");
    }

    const params = new URLSearchParams({
        q: searchTerm
    });

    const response = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/assistant-search?${params}`,
        {
            credentials: "same-origin"
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "Finny could not search your expenses."
        );
    }

    return data;
}

function formatSmartSearchResults(data) {
    if (!data.results || data.results.length === 0) {
        return (
            `I couldn't find any group expenses matching "${data.query}". 🫧\n\n` +
            "Try another keyword, such as dinner, groceries or transport."
        );
    }

    const results = data.results.map((item, index) => {
        const row = item._source || item;
        const amount = Number.isInteger(row.amountCents) ? `\nAmount: ${formatMoney(row.amountCents)}` : "";
        const who = row.payerName ? `\nPaid by: ${row.payerName}` : row.merchant ? `\nMerchant: ${row.merchant}` : "";
        const group = row.groupName ? `\nGroup: ${row.groupName}` : "";
        return `${index + 1}. [${row.kind || "record"}] ${row.title || row.description || "Untitled"}${amount}${who}${group}`;
    });

    return (
        `🐠 I found ${data.count} matching record(s) for "${data.query}":\n\n` +
        results.join("\n\n")
    );
}

// ==========================================
// PROCESS A QUESTION
// ==========================================


async function askGemini(question) {
    const selectedGroupId = getActiveGroupId();
    const groupId = assistantMode === "personal"
        ? (selectedGroupId || "0")
        : selectedGroupId;

    if (assistantMode === "group" && !groupId) {
        throw new Error("Please select a group first.");
    }

    const response = await fetch(
        `/api/groups/${encodeURIComponent(groupId)}/assistant-chat`,
        {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                question,
                mode: assistantMode,
                history: finnyHistory.slice(0, -1).slice(-6)
            })
        }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success || !data.answer) {
        const error = new Error(
            data.message || "Gemini is unavailable, so Finny is using the verified ledger instead."
        );
        error.useLedgerFallback = response.status === 503 || data.success === false;
        throw error;
    }

    return data;
}

function answerFromLedger(question, data) {
    return assistantMode === "personal"
        ? generatePersonalAnswer(question, data)
        : generateGroupAnswer(question, data);
}

async function askFinny(question) {
    if (!question.trim() || !aiChatWindow) return;

    addChatMessage(question, "user");
    rememberTurn("user", question);

    if (aiQuestionInput) {
        aiQuestionInput.value = "";
    }

    if (aiSendButton) {
        aiSendButton.disabled = true;
        aiSendButton.textContent = "Thinking...";
    }

    const pending = showFinnyPending();
    if (pending) pending.classList.add("is-pending");

    updateAssistantStatus("Finny is checking your records...");

    try {
        if (
            assistantMode === "group" &&
            isSmartSearchQuestion(question)
        ) {
            pending?.remove();
            updateAssistantStatus(
                "Finny is searching your group's expenses with Elastic..."
            );

            const searchData = await searchGroupExpenses(question);
            const answer = formatSmartSearchResults(searchData);

            addChatMessage(answer, "assistant", "Finny");
            rememberTurn("assistant", answer);
            updateAssistantStatus("Smart Search complete.");
            return;
        }

        try {
            const gemini = await askGemini(question);
            pending?.remove();
            addChatMessage(gemini.answer, "assistant", "Finny · Gemini");
            rememberTurn("assistant", gemini.answer);

            if (Array.isArray(gemini.progress) && gemini.progress.length) {
                updateAssistantStatus(gemini.progress.join(" · "));
            }

            (gemini.actions || []).forEach(renderActionCard);
            updateAssistantStatus(
                gemini.actions?.length
                    ? "Review the action card. Nothing is saved until you approve."
                    : (gemini.notice || "Finny answered from verified SplitSmart tools.")
            );
            return;
        } catch (geminiError) {
            if (!geminiError.useLedgerFallback) {
                throw geminiError;
            }

            updateAssistantStatus(geminiError.message);
        }

        const data = await loadAssistantData();
        const answer = answerFromLedger(question, data);
        pending?.remove();
        addChatMessage(answer, "assistant", "Finny · verified ledger");
        rememberTurn("assistant", answer);

    } catch (error) {
        console.error("Finny error:", error);
        pending?.remove();

        addChatMessage(
            error.message || "Something went wrong. Please try again.",
            "assistant",
            "Finny"
        );

        updateAssistantStatus(
            error.message || "Could not complete analysis."
        );

    } finally {
        if (aiSendButton) {
            aiSendButton.disabled = false;
            aiSendButton.textContent = "Send";
        }
    }
}


// ==========================================
// CHAT FORM
// ==========================================

if (aiChatForm) {
    aiChatForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const question = aiQuestionInput?.value.trim();

        if (question) {
            askFinny(question);
        }
    });
}

// ==========================================
// SUGGESTED QUESTION BUTTONS
// ==========================================

document.querySelectorAll(".ai-suggestion").forEach(button => {
    button.addEventListener("click", function () {
        const question = this.dataset.question;

        if (question) {
            askFinny(question);
        }
    });
});

// ==========================================
// GROUP SELECTION CHANGE
// ==========================================

["groupSelect", "settlementGroupSelect", "receiptGroupSelect", "analyticsGroupSelect"].forEach(id => {
    const select = document.getElementById(id);
    if (!select || select.dataset.finnyBound === "true") return;

    select.dataset.finnyBound = "true";
    select.addEventListener("change", function () {
        assistantData = null;
        finnyHistory = [];
        updateAssistantStatus(
            assistantMode === "personal"
                ? "Personal spending is ready."
                : select.value
                    ? "Group data will refresh with your next question."
                    : "Select a group to ask about shared expenses."
        );
    });
});

// ==========================================
// INITIALIZE FINNY
// ==========================================

function syncFinnyMode() {
    const personalButton = document.getElementById("personalBillButton");

    const activeMode = personalButton?.classList.contains("active")
        ? "personal"
        : "group";

    setAssistantMode(activeMode);
}

syncFinnyMode();

updateAssistantSuggestions();
