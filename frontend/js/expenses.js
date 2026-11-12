// ==========================================
// SPLITSMART AI — EXPENSE MANAGEMENT
// GROUP + PERSONAL WORKSPACES
// ==========================================


// ==========================================
// ELEMENTS
// ==========================================

const groupSelect = document.getElementById("groupSelect");
const payerSelect = document.getElementById("payerSelect");
const expenseForm = document.getElementById("expenseForm");
const expensesList = document.getElementById("expensesList");
let expenseHistoryGrid = null;

function setExpenseHistoryMessage(message) {
    if (expenseHistoryGrid) {
        expenseHistoryGrid.setGridOption("overlayNoRowsTemplate", `<span style="padding:12px;">${message}</span>`);
        window.ssGrid.setRows(expenseHistoryGrid, []);
        return;
    }
    if (expensesList && !expensesList.querySelector(".ag-root-wrapper")) {
        expensesList.textContent = message;
    }
}
const expenseMessage = document.getElementById("expenseMessage");
const addExpenseBtn = document.getElementById("addExpenseBtn");

const settlementsList = document.getElementById("settlementsList");
const balancesList = document.getElementById("balancesList");

const groupBillButton = document.getElementById("groupBillButton");
const personalBillButton = document.getElementById("personalBillButton");

const personalExpenseForm = document.getElementById("personalExpenseForm");
const personalExpensesList = document.getElementById("personalExpensesList");
const personalExpenseMessage = document.getElementById("personalExpenseMessage");
const addPersonalExpenseBtn = document.getElementById("addPersonalExpenseBtn");

const groupHistory = document.getElementById("history");
const personalHistoryPanel = document.getElementById("personalHistoryPanel");
const expenseGroupFilter = document.getElementById("expenseGroupFilter");

const balancesPanel = document.getElementById("balances");
const settlementsPanel = document.getElementById("settlements");
const spendingIntelligence = document.getElementById("spendingIntelligence");

// Receipt elements

const receiptItemsPanel = document.getElementById("receiptItemsPanel");
const receiptGroupSelect = document.getElementById("receiptGroupSelect");
const receiptPayerSelect = document.getElementById("receiptPayerSelect");
const receiptItemsList = document.getElementById("receiptItemsList");
const receiptItemsTotal = document.getElementById("receiptItemsTotal");
const receiptAssignmentStatus = document.getElementById("receiptAssignmentStatus");
const saveReceiptItemsBtn = document.getElementById("saveReceiptItemsBtn");
const receiptItemsMessage = document.getElementById("receiptItemsMessage");


// ==========================================
// STATE
// ==========================================

let currentMembers = [];
let allGroupExpenses = [];
let currentReceiptMembers = [];
let currentExpenseType = "group";
let availableGroups = [];

let receiptItems = [];
let receiptDescription = "Scanned receipt";
let scannedReceiptTotalCents = null;

let editingReceiptExpenseId = null;

const originalReceiptSaveButtonText = saveReceiptItemsBtn
    ? saveReceiptItemsBtn.textContent
    : "Save itemized receipt";


// ==========================================
// MESSAGES
// ==========================================

function showMessage(message, isError = false) {

    if (!expenseMessage) return;

    expenseMessage.textContent = message;
    expenseMessage.style.color = isError ? "red" : "green";
}

function showPersonalMessage(message, isError = false) {

    if (!personalExpenseMessage) return;

    personalExpenseMessage.textContent = message;
    personalExpenseMessage.style.color = isError ? "red" : "green";
}

function showReceiptMessage(message, isError = false) {

    if (!receiptItemsMessage) return;

    receiptItemsMessage.textContent = message;
    receiptItemsMessage.style.color = isError ? "red" : "green";
}


// ==========================================
// GROUP / PERSONAL SWITCH
// ==========================================

function switchExpenseType(type) {

    currentExpenseType = type;

    const isGroup = type === "group";

    // Switch active buttons

    if (groupBillButton) {
        groupBillButton.classList.toggle("active", isGroup);
    }

    if (personalBillButton) {
        personalBillButton.classList.toggle("active", !isGroup);
    }

    // Switch forms

    if (expenseForm) {
        expenseForm.hidden = !isGroup;
    }

    if (personalExpenseForm) {
        personalExpenseForm.hidden = isGroup;
    }

    // Switch history

    if (groupHistory) {
        groupHistory.hidden = !isGroup;
    }

    if (personalHistoryPanel) {
        personalHistoryPanel.hidden = isGroup;
    }

    // Group-only features

    if (balancesPanel) {
        balancesPanel.hidden = !isGroup;
    }

    if (settlementsPanel) {
        settlementsPanel.hidden = !isGroup;
    }

    if (spendingIntelligence) {
        spendingIntelligence.hidden = !isGroup;
    }

    // Receipt scanner works in both modes

    const scannerPanel = document.querySelector(".scanner-panel");

    if (scannerPanel) {
        scannerPanel.hidden = false;
    }

    // Item assignment only works in group mode

    if (receiptItemsPanel) {
        receiptItemsPanel.hidden =
            !isGroup || receiptItems.length === 0;
    }

    if (isGroup) {

        if (expenseMessage) {
            expenseMessage.textContent = "";
        }

        if (groupSelect && groupSelect.value) {
            loadMembers();
        }

    } else {

        showPersonalMessage("");
        loadPersonalExpenses();
    }

    // Notify Finny AI about the active mode

    document.dispatchEvent(
        new CustomEvent("expenseModeChanged", {
            detail: {
                mode: currentExpenseType
            }
        })
    );
}


if (groupBillButton) {

    groupBillButton.addEventListener("click", () => {
        switchExpenseType("group");
    });

}

if (personalBillButton) {

    personalBillButton.addEventListener("click", () => {
        switchExpenseType("personal");
    });

}


// ==========================================
// LOAD GROUPS
// ==========================================

async function loadGroups() {

    try {

        const response = await fetch("/api/groups");
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not load groups.");
        }

        availableGroups = data.groups || [];
        // Populate the all-groups history filter
        if (expenseGroupFilter) {
            expenseGroupFilter.replaceChildren();

            const allOption = document.createElement("option");
            allOption.value = "";
            allOption.textContent = "All groups";
            expenseGroupFilter.appendChild(allOption);

            availableGroups.forEach(group => {
                const option = document.createElement("option");
                option.value = group.id;
                option.textContent = group.name;
                expenseGroupFilter.appendChild(option);
            });
        }
        // Normal group dropdown

        if (groupSelect) {

            groupSelect.replaceChildren();

            const normalOption = document.createElement("option");

            normalOption.value = "";
            normalOption.textContent = "Choose a group";

            groupSelect.appendChild(normalOption);

        }

        // Receipt group dropdown

        if (receiptGroupSelect) {

            receiptGroupSelect.replaceChildren();

            const receiptOption = document.createElement("option");

            receiptOption.value = "";
            receiptOption.textContent = "Choose a group";

            receiptGroupSelect.appendChild(receiptOption);

        }

        availableGroups.forEach(group => {

            if (groupSelect) {

                const option1 = document.createElement("option");

                option1.value = group.id;
                option1.textContent = group.name;

                groupSelect.appendChild(option1);

            }

            if (receiptGroupSelect) {

                const option2 = document.createElement("option");

                option2.value = group.id;
                option2.textContent = group.name;

                receiptGroupSelect.appendChild(option2);

            }

        });

        if (availableGroups.length === 0) {

            showMessage(
                "Create a group before adding group expenses.",
                true
            );

        }

        await loadExpenses();

        if (availableGroups.length > 0 && groupSelect) {
            groupSelect.value = String(availableGroups[0].id);
            groupSelect.dispatchEvent(new Event("change"));
        }

        if (availableGroups.length > 0 && receiptGroupSelect) {
            receiptGroupSelect.value = String(availableGroups[0].id);
            loadReceiptPayers();
        }

    } catch (error) {

        console.error("Load groups error:", error);

        showMessage("Could not connect to the server.", true);

    }

}


// ==========================================
// LOAD GROUP MEMBERS
// ==========================================

async function loadMembers() {

    if (!groupSelect || !payerSelect) return;

    const groupId = groupSelect.value;

    payerSelect.replaceChildren();

    const option = document.createElement("option");

    option.value = "";
    option.textContent = "Select who paid";

    payerSelect.appendChild(option);

    currentMembers = [];

    setExpenseHistoryMessage("Loading expenses...");

    if (!groupId) {

        payerSelect.disabled = true;

        if (addExpenseBtn) {
            addExpenseBtn.disabled = true;
        }

        setExpenseHistoryMessage("Select a group to see its expenses.");

        if (balancesList) {
            balancesList.textContent =
                "Select a group to calculate balances.";
        }

        if (settlementsList) {
            settlementsList.textContent =
                "Select a group to see settlements.";
        }

        return;

    }

    try {

        const selectedGroup = availableGroups.find(
            group => String(group.id) === String(groupId)
        );

        if (!selectedGroup) {
            throw new Error("Group not found.");
        }

        currentMembers = (selectedGroup.members || []).filter(
            member => Number(member.is_active) !== 0
        );

        currentMembers.forEach(member => {

            const memberOption = document.createElement("option");

            memberOption.value = member.id;
            memberOption.textContent = member.name;

            payerSelect.appendChild(memberOption);

        });

        payerSelect.disabled = currentMembers.length === 0;

        if (addExpenseBtn) {
            addExpenseBtn.disabled = currentMembers.length === 0;
        }

        updateExpenseMemberFilter();

        await refreshGroupData(groupId);

    } catch (error) {

        console.error("Load members error:", error);

        showMessage(error.message, true);

        setExpenseHistoryMessage("Could not load group information.");

    }

}


// ==========================================
// REFRESH GROUP DATA
// ==========================================

// ==========================================
// REFRESH GROUP DATA
// ==========================================

async function refreshGroupData(groupId) {

    // Always refresh the combined group history
    await loadExpenses();

    // Balances and settlements remain group-specific
    if (groupId) {
        await loadBalances(groupId);
        await loadSettlements(groupId);
    }
}


// ==========================================
// LOAD ALL GROUP EXPENSES
// ==========================================

async function loadExpenses() {

    try {

        const response = await fetch("/api/expenses");
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Could not load expenses."
            );
        }

        allGroupExpenses = data.expenses || [];

        renderGroupExpenses();

    } catch (error) {

        console.error("Error loading all group expenses:", error);

        setExpenseHistoryMessage("Could not load expense history.");

    }

}

// ==========================================
// UPDATE MEMBER FILTER
// ==========================================

// ==========================================
// UPDATE MEMBER FILTER — ALL GROUPS
// ==========================================

function updateExpenseMemberFilter() {

    if (!expenseMemberFilter) return;

    const selectedValue = expenseMemberFilter.value;

    expenseMemberFilter.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All members";

    expenseMemberFilter.appendChild(allOption);

    const uniqueMembers = new Map();

    allGroupExpenses.forEach(expense => {

        if (expense.payer_id && expense.payer_name) {
            uniqueMembers.set(
                String(expense.payer_id),
                expense.payer_name
            );
        }

    });

    uniqueMembers.forEach((name, id) => {

        const option = document.createElement("option");

        option.value = id;
        option.textContent = name;

        expenseMemberFilter.appendChild(option);

    });

    expenseMemberFilter.value = selectedValue;

}


// ==========================================
// RENDER ALL GROUP EXPENSES
// ==========================================

function renderGroupExpenses() {

    if (!expensesList) return;

    updateExpenseMemberFilter();

    const searchTerm = expenseSearch
        ? expenseSearch.value.trim().toLowerCase()
        : "";

    const selectedMember = expenseMemberFilter
        ? expenseMemberFilter.value
        : "";

    const selectedDate = expenseDateFilter
        ? expenseDateFilter.value
        : "";

    const selectedGroup = expenseGroupFilter
        ? expenseGroupFilter.value
        : "";

    const filteredExpenses = allGroupExpenses.filter(expense => {

        const description = (
            expense.description || ""
        ).toLowerCase();

        const payer = (
            expense.payer_name || ""
        ).toLowerCase();

        const groupName = (
            expense.group_name || ""
        ).toLowerCase();

        const matchesSearch =
            description.includes(searchTerm) ||
            payer.includes(searchTerm) ||
            groupName.includes(searchTerm);

        const matchesMember =
            !selectedMember ||
            String(expense.payer_id) === selectedMember;

        const matchesDate =
            !selectedDate ||
            (
                expense.created_at &&
                expense.created_at.substring(0, 10) === selectedDate
            );

        const matchesGroup =
            !selectedGroup ||
            String(expense.group_id) === selectedGroup;

        return (
            matchesSearch &&
            matchesMember &&
            matchesDate &&
            matchesGroup
        );

    });

    const rows = filteredExpenses.map(expense => ({
        id: expense.id,
        description: expense.description || "Untitled expense",
        groupName: expense.group_name || "Unknown group",
        amountCents: Number(expense.amount_cents) || 0,
        payerName: expense.payer_name || "Unknown",
        createdAt: expense.created_at || "",
        expense
    }));

    if (window.ssGrid && window.ssGrid.communityReady()) {
        if (!expenseHistoryGrid) {
            expenseHistoryGrid = window.ssGrid.createGrid(expensesList, {
                overlayNoRowsTemplate: '<span style="padding:12px;">No expenses match your filters.</span>',
                columnDefs: [
                    { field: "description", headerName: "Description", flex: 2, minWidth: 180 },
                    { field: "groupName", headerName: "Group", flex: 1, minWidth: 120 },
                    {
                        field: "amountCents",
                        headerName: "Amount",
                        flex: 1,
                        filter: "agNumberColumnFilter",
                        valueFormatter: params => window.ssGrid.money(params.value)
                    },
                    { field: "payerName", headerName: "Paid by", flex: 1, minWidth: 120 },
                    {
                        field: "createdAt",
                        headerName: "Date",
                        flex: 1,
                        valueFormatter: params => window.ssGrid.formatDate(params.value)
                    },
                    {
                        headerName: "",
                        field: "id",
                        sortable: false,
                        filter: false,
                        floatingFilter: false,
                        minWidth: 150,
                        cellRenderer: params => {
                            const wrap = document.createElement("div");
                            wrap.className = "expense-actions";
                            const edit = document.createElement("button");
                            edit.type = "button";
                            edit.className = "button button-secondary";
                            edit.textContent = "Edit";
                            edit.addEventListener("click", () => editGroupExpense(params.data.expense));
                            const remove = document.createElement("button");
                            remove.type = "button";
                            remove.className = "button button-secondary";
                            remove.textContent = "Delete";
                            remove.addEventListener("click", () => deleteGroupExpense(
                                params.data.expense.group_id,
                                params.data.expense.id
                            ));
                            wrap.append(edit, remove);
                            return wrap;
                        }
                    }
                ]
            });
        }

        window.ssGrid.setRows(expenseHistoryGrid, rows);
        return;
    }

    expensesList.replaceChildren();
    if (!rows.length) {
        expensesList.textContent = "No expenses match your filters.";
        return;
    }
    rows.forEach(row => {
        const item = document.createElement("p");
        item.textContent = `${row.description} · ${window.ssGrid ? window.ssGrid.money(row.amountCents) : row.amountCents} · ${row.payerName}`;
        expensesList.appendChild(item);
    });
}

// ==========================================
// EDIT GROUP EXPENSE
// ==========================================

async function editGroupExpense(expense) {

    const groupId = expense.group_id;

    try {

        const receiptResponse = await fetch(
            `/api/groups/${groupId}/receipt-expenses/${expense.id}`
        );

        const receiptData = await receiptResponse.json();

        if (!receiptResponse.ok || !receiptData.success) {

            throw new Error(
                receiptData.message ||
                "Could not load expense details."
            );

        }

        // ITEMIZED RECEIPT EDITING

        if (receiptData.isItemized) {

            editingReceiptExpenseId = expense.id;

            receiptDescription =
                receiptData.expense.description;

            receiptGroupSelect.value = groupId;

            loadReceiptPayers();

            receiptPayerSelect.value =
                String(receiptData.expense.payerId);

            receiptItems = receiptData.items.map(item => ({

                name: item.name,
                amount: item.amount,
                memberIds: item.memberIds.map(Number)

            }));

            scannedReceiptTotalCents = null;

            receiptItemsPanel.hidden = false;

            saveReceiptItemsBtn.textContent =
                "Update itemized receipt";

            renderReceiptItems();

            showReceiptMessage(
                "Editing receipt. Update the items and assignments, then save."
            );

            receiptItemsPanel.scrollIntoView({

                behavior: "smooth",
                block: "center"

            });

            return;

        }

    } catch (error) {

        console.error("Could not load receipt details:", error);

        alert(error.message);

        return;

    }

    // NORMAL EXPENSE EDITING

    const newDescription = prompt(
        "Enter the updated expense description:",
        expense.description
    );

    if (newDescription === null) return;

    if (!newDescription.trim()) {

        alert("Description cannot be empty.");

        return;

    }

    const newAmount = prompt(
        "Enter the updated amount:",
        (expense.amount_cents / 100).toFixed(2)
    );

    if (newAmount === null) return;

    const amount = Number(newAmount);

    if (!Number.isFinite(amount) || amount <= 0) {

        alert("Please enter a valid amount.");

        return;

    }

    try {

        const response = await fetch(
            `/api/groups/${groupId}/expenses/${expense.id}`,
            {

                method: "PUT",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    description: newDescription.trim(),
                    amount

                })

            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.message || "Could not update expense."
            );

        }

        alert("Expense updated successfully!");

        await refreshGroupData(groupId);

    } catch (error) {

        console.error("Edit expense error:", error);

        alert(error.message);

    }

}


// ==========================================
// DELETE GROUP EXPENSE
// ==========================================

async function deleteGroupExpense(groupId, expenseId) {

    const confirmed = window.confirm(
        "Are you sure you want to delete this group expense? Its receipt items and member shares will also be removed."
    );

    if (!confirmed) return;

    try {

        const response = await fetch(
            `/api/groups/${groupId}/expenses/${expenseId}`,
            {
                method: "DELETE"
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.message || "Could not delete group expense."
            );

        }

        showMessage("Group expense deleted successfully!");

        await refreshGroupData(groupId);

    } catch (error) {

        console.error(error);

        showMessage(error.message, true);

    }

}


// ==========================================
// LOAD GROUP BALANCES
// ==========================================

async function loadBalances(groupId) {

    try {

        const response = await fetch(
            `/api/groups/${groupId}/balances`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error("Could not calculate balances.");

        }

        balancesList.replaceChildren();

        if (data.balances.length === 0) {

            balancesList.textContent = "No members found.";

            return;

        }

        data.balances.forEach(member => {

            const item = document.createElement("div");
            item.className = "expense-item";

            const name = document.createElement("h3");
            name.textContent = member.name;

            const paid = document.createElement("p");

            paid.textContent =
                "Total paid: $" +
                (member.totalPaid / 100).toFixed(2);

            const share = document.createElement("p");

            share.textContent =
                "Share: $" +
                (member.totalShare / 100).toFixed(2);

            const balance = document.createElement("p");
            balance.className = "expense-amount";

            const amount = Math.abs(
                member.balance / 100
            ).toFixed(2);

            if (member.balance > 0) {

                balance.textContent =
                    "Should receive: $" + amount;

            } else if (member.balance < 0) {

                balance.textContent =
                    "Owes: $" + amount;

            } else {

                balance.textContent = "Settled: $0.00";

            }

            item.append(name, paid, share, balance);

            balancesList.appendChild(item);

        });

    } catch (error) {

        console.error(error);

        balancesList.textContent =
            "Could not load group balances.";

    }

}


// ==========================================
// LOAD SETTLEMENT SUGGESTIONS
// ==========================================

async function loadSettlements(groupId) {

    const progressDisplay = document.getElementById(
        "settlementProgress"
    );

    const storageKey = `settlements_group_${groupId}`;

    try {

        const response = await fetch(
            `/api/groups/${groupId}/settlements`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error("Could not load settlements.");

        }

        settlementsList.replaceChildren();

        const completedSettlements = JSON.parse(
            localStorage.getItem(storageKey) || "{}"
        );

        if (data.settlements.length === 0) {

            settlementsList.textContent =
                "Everyone is balanced. No settlements needed!";

            if (progressDisplay) {

                progressDisplay.textContent =
                    "Your group is completely balanced!";

            }

            return;

        }

        let completedCount = 0;

        data.settlements.forEach(settlement => {

            const settlementKey =
                `${settlement.fromId}-${settlement.toId}-${settlement.amountCents}`;

            const isCompleted =
                completedSettlements[settlementKey] === true;

            if (isCompleted) {
                completedCount++;
            }

            const item = document.createElement("div");
            item.className = "expense-item";

            const title = document.createElement("h3");

            title.textContent =
                settlement.from + " → " + settlement.to;

            const amount = document.createElement("p");
            amount.className = "expense-amount";

            amount.textContent =
                "Suggested amount: $" +
                (settlement.amountCents / 100).toFixed(2);

            const status = document.createElement("p");
            status.textContent = "Recommended settlement transfer";

            const settleButton = document.createElement("a");
            settleButton.className = "button button-primary";
            settleButton.style.display = "inline-flex";
            settleButton.style.alignItems = "center";
            settleButton.style.fontSize = "12px";
            settleButton.style.padding = "6px 12px";
            settleButton.href = `settlement.html?group=${encodeURIComponent(groupId)}`;
            settleButton.textContent = "Settle via PayPal →";

            item.append(
                title,
                amount,
                status,
                settleButton
            );

            settlementsList.appendChild(item);

        });

        if (progressDisplay) {

            progressDisplay.textContent =
                `${data.settlements.length} settlement transfer(s) suggested to clear group debt.`;

        }

    } catch (error) {

        console.error(error);

        settlementsList.textContent =
            "Could not load settlement suggestions.";

        if (progressDisplay) {

            progressDisplay.textContent =
                "Settlement progress is currently unavailable.";

        }

    }

}


// ==========================================
// SAVE NORMAL GROUP EXPENSE
// ==========================================

if (expenseForm) {

    expenseForm.addEventListener("submit", async function (event) {

        event.preventDefault();

        const groupId = groupSelect.value;

        const description = document
            .getElementById("description")
            .value.trim();

        const amount = Number(
            document.getElementById("amount").value
        );

        const payerId = Number(payerSelect.value);

        if (!groupId || !description || !amount || !payerId) {

            showMessage("Please complete all fields.", true);

            return;

        }

        if (!currentMembers.some(
            member => Number(member.id) === payerId
        )) {

            showMessage(
                "Please select a valid group member.",
                true
            );

            return;

        }

        addExpenseBtn.disabled = true;

        showMessage("Saving group expense...");

        try {

            const response = await fetch(
                `/api/groups/${groupId}/expenses`,
                {

                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({

                        description,
                        amount,
                        payerId

                    })

                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {

                throw new Error(
                    data.message || "Could not save expense."
                );

            }

            showMessage("Group expense added successfully!");

            expenseForm.reset();

            groupSelect.value = groupId;

            await loadMembers();

        } catch (error) {

            console.error(error);

            showMessage(error.message, true);

        } finally {

            addExpenseBtn.disabled =
                currentMembers.length === 0;

        }

    });

}


// ==========================================
// SAVE PERSONAL EXPENSE
// ==========================================

if (personalExpenseForm) {

    personalExpenseForm.addEventListener(
        "submit",
        async function (event) {

            event.preventDefault();

            const description = document
                .getElementById("personalDescription")
                .value.trim();

            const amount = Number(
                document.getElementById("personalAmount").value
            );

            if (
                !description ||
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                showPersonalMessage(
                    "Please enter a description and valid amount.",
                    true
                );

                return;

            }

            addPersonalExpenseBtn.disabled = true;

            showPersonalMessage(
                "Saving your personal expense..."
            );

            try {

                const response = await fetch(
                    "/api/personal-expenses",
                    {

                        method: "POST",

                        headers: {
                            "Content-Type": "application/json"
                        },

                        body: JSON.stringify({
                            description,
                            amount
                        })

                    }
                );

                const data = await response.json();

                if (!response.ok || !data.success) {

                    throw new Error(
                        data.message ||
                        "Could not save personal expense."
                    );

                }

                showPersonalMessage(
                    "Personal expense saved successfully!"
                );

                personalExpenseForm.reset();

                await loadPersonalExpenses();

            } catch (error) {

                console.error(error);

                showPersonalMessage(error.message, true);

            } finally {

                addPersonalExpenseBtn.disabled = false;

            }

        }
    );

}


// ==========================================
// PERSONAL SPENDING INSIGHTS
// ==========================================

function renderPersonalInsights(expenses) {

    let insightsPanel = document.getElementById(
        "personalSpendingInsights"
    );

    if (!insightsPanel && personalHistoryPanel) {

        insightsPanel = document.createElement("div");

        insightsPanel.id = "personalSpendingInsights";
        insightsPanel.className = "spending-intelligence";

        personalHistoryPanel.insertBefore(
            insightsPanel,
            personalExpensesList
        );

    }

    if (!insightsPanel) return;

    const totalSpent = expenses.reduce(
        (sum, expense) =>
            sum + Number(expense.amount_cents || 0),
        0
    );

    const expenseCount = expenses.length;

    const averageExpense = expenseCount > 0
        ? totalSpent / expenseCount
        : 0;

    const largestExpense = expenses.reduce(
        (largest, expense) => {

            return Number(expense.amount_cents || 0) >
                Number(largest?.amount_cents || 0)
                ? expense
                : largest;

        },
        null
    );

    insightsPanel.replaceChildren();

    const heading = document.createElement("h2");

    heading.textContent =
        "Your Personal Spending Insights";

    const description = document.createElement("p");

    description.textContent =
        "A quick overview of your personal expenses.";

    const stats = document.createElement("div");

    stats.className = "insight-stats";

    function createStat(title, value) {

        const card = document.createElement("div");

        card.className = "insight-card";

        const label = document.createElement("p");

        label.textContent = title;

        const amount = document.createElement("h3");

        amount.textContent = value;

        card.append(label, amount);

        return card;

    }

    stats.append(

        createStat(
            "Total Personal Spending",
            "$" + (totalSpent / 100).toFixed(2)
        ),

        createStat(
            "Number of Expenses",
            String(expenseCount)
        ),

        createStat(
            "Average Expense",
            "$" + (averageExpense / 100).toFixed(2)
        ),

        createStat(
            "Largest Expense",
            largestExpense
                ? "$" + (
                    Number(largestExpense.amount_cents) / 100
                ).toFixed(2)
                : "$0.00"
        )

    );

    const largestDescription = document.createElement("p");

    largestDescription.textContent = largestExpense
        ? "Largest expense: " + largestExpense.description
        : "Add your first expense to start seeing insights.";

    insightsPanel.append(
        heading,
        description,
        stats,
        largestDescription
    );

}


// ==========================================
// LOAD PERSONAL EXPENSE HISTORY
// ==========================================

async function loadPersonalExpenses() {

    if (!personalExpensesList) return;

    try {

        personalExpensesList.textContent =
            "Loading personal expenses...";

        const response = await fetch(
            "/api/personal-expenses"
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.message || "Could not load personal expenses."
            );

        }

        const expenses = data.expenses || [];

        // Update personal insights

        renderPersonalInsights(expenses);

        personalExpensesList.replaceChildren();

        if (expenses.length === 0) {

            personalExpensesList.textContent =
                "No personal expenses yet. Add your first one!";

            return;

        }

        expenses.forEach(expense => {

            const item = document.createElement("div");

            item.className = "expense-item";

            const title = document.createElement("h3");

            title.textContent = expense.description;

            const amount = document.createElement("p");

            amount.className = "expense-amount";

            amount.textContent =
                "$" + (
                    Number(expense.amount_cents) / 100
                ).toFixed(2);

            const date = document.createElement("p");

            date.textContent = expense.created_at
                ? "Date: " + expense.created_at.substring(0, 10)
                : "";

            const deleteButton = document.createElement("button");

            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.className = "button button-secondary";

            deleteButton.addEventListener("click", () => {

                deletePersonalExpense(expense.id);

            });

            item.append(
                title,
                amount,
                date,
                deleteButton
            );

            personalExpensesList.appendChild(item);

        });

    } catch (error) {

        console.error("Personal expense loading error:", error);

        personalExpensesList.textContent =
            "Could not load personal expenses.";

    }

}


// ==========================================
// DELETE PERSONAL EXPENSE
// ==========================================

async function deletePersonalExpense(expenseId) {

    const confirmed = window.confirm(
        "Are you sure you want to delete this personal expense?"
    );

    if (!confirmed) return;

    try {

        const response = await fetch(
            `/api/personal-expenses/${expenseId}`,
            {
                method: "DELETE"
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {

            throw new Error(
                data.message || "Could not delete expense."
            );

        }

        showPersonalMessage(
            "Personal expense deleted successfully!"
        );

        await loadPersonalExpenses();

    } catch (error) {

        console.error(error);

        showPersonalMessage(error.message, true);

    }

}


// ==========================================
// RECEIPT GROUP AND PAYER SELECTION
// ==========================================

function loadReceiptPayers() {

    if (!receiptGroupSelect || !receiptPayerSelect) return;

    const groupId = receiptGroupSelect.value;

    receiptPayerSelect.replaceChildren();

    const firstOption = document.createElement("option");

    firstOption.value = "";
    firstOption.textContent = "Choose who paid";

    receiptPayerSelect.appendChild(firstOption);

    const selectedGroup = availableGroups.find(
        group => String(group.id) === String(groupId)
    );

    currentReceiptMembers = selectedGroup
        ? (selectedGroup.members || []).filter(
            member => Number(member.is_active) !== 0
        )
        : [];

    currentReceiptMembers.forEach(member => {

        const option = document.createElement("option");

        option.value = member.id;
        option.textContent = member.name;

        receiptPayerSelect.appendChild(option);

    });

    receiptPayerSelect.disabled =
        currentReceiptMembers.length === 0;

    renderReceiptItems();

}

if (receiptGroupSelect) {

    receiptGroupSelect.addEventListener(
        "change",
        loadReceiptPayers
    );

}


// ==========================================
// ADD MANUAL RECEIPT ITEM BUTTON
// ==========================================

if (receiptItemsPanel && receiptItemsList) {

    const addItemButton = document.createElement("button");

    addItemButton.type = "button";
    addItemButton.textContent = "+ Add another item";
    addItemButton.className = "button button-secondary";

    addItemButton.addEventListener("click", () => {

        receiptItems.push({

            name: "",
            amount: "",
            memberIds: []

        });

        renderReceiptItems();

    });

    receiptItemsList.insertAdjacentElement(
        "afterend",
        addItemButton
    );

}


// ==========================================
// RECEIVE ITEMS FROM RECEIPT SCANNER
// ==========================================

window.setScannedReceiptItems = function (items, details = {}) {

    // Store detected receipt total

    const detectedTotal = Number(
        String(details.total ?? "").replace(/[^0-9.-]/g, "")
    );

    scannedReceiptTotalCents =
        Number.isFinite(detectedTotal) && detectedTotal > 0
            ? Math.round(detectedTotal * 100)
            : null;

    // Store extracted items

    receiptItems = (items || []).map(item => ({

        name: String(item.name || ""),
        amount: Number(item.amount) || "",
        memberIds: []

    }));

    receiptDescription =
        details.merchant &&
            details.merchant !== "Not identified"
            ? details.merchant
            : "Scanned receipt";

    // Only show assignment panel in group mode

    if (receiptItemsPanel) {

        receiptItemsPanel.hidden =
            currentExpenseType !== "group" ||
            receiptItems.length === 0;

    }

    if (details.total !== undefined && details.total !== null) {

        showReceiptMessage(
            "Items extracted. Check their prices and assignments before saving."
        );

    }

    renderReceiptItems();

};


// ==========================================
// RENDER RECEIPT ITEMS
// ==========================================


function renderReceiptItems() {
    if (!receiptItemsList) return;

    receiptItemsList.replaceChildren();

    if (receiptItems.length === 0) {
        receiptItemsList.textContent =
            "No receipt items found. You can add items manually.";
        updateReceiptSummary();
        return;
    }

    receiptItems.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = "receipt-item-card";

        // ITEM HEADER
        const header = document.createElement("div");
        header.className = "receipt-item-header";

        const heading = document.createElement("div");
        heading.className = "receipt-item-heading";

        const itemNumber = document.createElement("span");
        itemNumber.className = "receipt-item-index";
        itemNumber.textContent = String(index + 1);

        const itemTitle = document.createElement("strong");
        itemTitle.className = "receipt-item-name";
        itemTitle.textContent = item.name.trim() || `Item ${index + 1}`;

        heading.append(itemNumber, itemTitle);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "Remove";
        removeButton.className = "button button-danger receipt-item-remove";

        removeButton.addEventListener("click", () => {
            receiptItems.splice(index, 1);
            renderReceiptItems();
        });

        header.append(heading, removeButton);

        // NAME AND PRICE
        const fields = document.createElement("div");
        fields.className = "receipt-item-fields";

        const nameWrapper = document.createElement("div");
        nameWrapper.className = "field";
        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Item name";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.maxLength = 120;
        nameInput.placeholder = "e.g. Burger";
        nameInput.value = item.name;

        nameInput.addEventListener("input", () => {
            receiptItems[index].name = nameInput.value;
            itemTitle.textContent =
                item.name.trim() || `Item ${index + 1}`;
            updateReceiptSummary();
        });

        nameWrapper.append(nameLabel, nameInput);

        const amountWrapper = document.createElement("div");
        amountWrapper.className = "field";
        const amountLabel = document.createElement("label");
        amountLabel.textContent = "Price ($)";

        const amountInput = document.createElement("input");
        amountInput.type = "number";
        amountInput.min = "0.01";
        amountInput.step = "0.01";
        amountInput.placeholder = "0.00";
        amountInput.value = item.amount;

        amountInput.addEventListener("input", () => {
            receiptItems[index].amount = amountInput.value;
            updateReceiptSummary();
            updateSharePreview();
        });

        amountWrapper.append(amountLabel, amountInput);
        fields.append(nameWrapper, amountWrapper);

        // MEMBER ASSIGNMENT
        const assignmentBar = document.createElement("div");
        assignmentBar.className = "receipt-assign-bar";

        const assignmentHeading = document.createElement("p");
        assignmentHeading.textContent = "Who ordered this?";

        const controls = document.createElement("div");
        controls.className = "receipt-assign-actions";

        const selectAll = document.createElement("button");
        selectAll.type = "button";
        selectAll.textContent = "Select everyone";

        const clearAll = document.createElement("button");
        clearAll.type = "button";
        clearAll.textContent = "Clear selection";

        controls.append(selectAll, clearAll);
        assignmentBar.append(assignmentHeading, controls);

        const memberList = document.createElement("div");
        memberList.className = "ss-receipt-members";

        // Normalize IDs to numbers so checkbox matching is reliable.
        item.memberIds = (item.memberIds || []).map(Number);

        const preview = document.createElement("div");
        preview.className = "ss-item-share-preview";

        function updateSharePreview() {
            preview.replaceChildren();

            const amount = Number(item.amount);
            const selectedMembers = item.memberIds.length;

            if (
                !Number.isFinite(amount) ||
                amount <= 0 ||
                selectedMembers === 0
            ) {
                preview.textContent =
                    "Select members to preview their shares.";
                return;
            }

            const cents = Math.round(amount * 100);
            const base = Math.floor(cents / selectedMembers);
            const remainder = cents % selectedMembers;

            const heading = document.createElement("strong");
            heading.textContent = "Share preview";

            preview.appendChild(heading);

            item.memberIds.forEach((memberId, memberIndex) => {
                const member = currentReceiptMembers.find(
                    person => Number(person.id) === memberId
                );

                if (!member) return;

                const share =
                    base + (memberIndex < remainder ? 1 : 0);

                const row = document.createElement("div");
                row.className = "ss-share-preview-row";

                const memberName = document.createElement("span");
                memberName.textContent = member.name;

                const memberShare = document.createElement("strong");
                memberShare.textContent =
                    "$" + (share / 100).toFixed(2);

                row.append(memberName, memberShare);
                preview.appendChild(row);
            });

            const note = document.createElement("small");
            note.textContent =
                `Split equally between ${selectedMembers} selected member(s).`;

            preview.appendChild(note);
        }

        function renderMemberCheckboxes() {
            memberList.replaceChildren();

            currentReceiptMembers.forEach(member => {
                const label = document.createElement("label");
                label.className = "ss-receipt-member";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";

                checkbox.checked = item.memberIds.includes(
                    Number(member.id)
                );

                checkbox.addEventListener("change", () => {
                    const id = Number(member.id);

                    if (checkbox.checked) {
                        if (!item.memberIds.includes(id)) {
                            item.memberIds.push(id);
                        }
                    } else {
                        item.memberIds =
                            item.memberIds.filter(value => value !== id);
                    }

                    label.classList.toggle("is-selected", checkbox.checked);
                    updateSharePreview();
                    updateReceiptSummary();
                });

                const name = document.createElement("span");
                name.textContent = member.name;

                if (checkbox.checked) {
                    label.classList.add("is-selected");
                }

                label.append(checkbox, name);
                memberList.appendChild(label);
            });
        }

        selectAll.addEventListener("click", () => {
            item.memberIds = currentReceiptMembers.map(
                member => Number(member.id)
            );

            renderMemberCheckboxes();
            updateSharePreview();
            updateReceiptSummary();
        });

        clearAll.addEventListener("click", () => {
            item.memberIds = [];

            renderMemberCheckboxes();
            updateSharePreview();
            updateReceiptSummary();
        });

        if (currentReceiptMembers.length === 0) {
            const hint = document.createElement("p");
            hint.textContent =
                "Choose a group above to assign members.";
            memberList.appendChild(hint);

            selectAll.disabled = true;
            clearAll.disabled = true;
        } else {
            renderMemberCheckboxes();
        }

        updateSharePreview();

        card.append(
            header,
            fields,
            assignmentBar,
            memberList,
            preview
        );

        receiptItemsList.appendChild(card);
    });

    updateReceiptSummary();
}

// ==========================================
// RECEIPT TOTAL AND ASSIGNMENT STATUS
// ==========================================

function updateReceiptSummary() {

    const total = receiptItems.reduce((sum, item) => {

        const amount = Number(item.amount);

        return sum + (

            Number.isFinite(amount) && amount > 0
                ? Math.round(amount * 100)
                : 0

        );

    }, 0);

    // Display item total

    if (receiptItemsTotal) {

        receiptItemsTotal.textContent =
            "$" + (total / 100).toFixed(2);

    }

    // Count assigned items

    const assignedCount = receiptItems.filter(item =>

        item.name.trim() &&
        Number(item.amount) > 0 &&
        item.memberIds.length > 0

    ).length;

    // Assignment status

    if (receiptAssignmentStatus) {

        let status =
            `${assignedCount} of ${receiptItems.length} items assigned`;

        if (scannedReceiptTotalCents !== null) {

            const difference =
                total - scannedReceiptTotalCents;

            const absoluteDifference =
                Math.abs(difference);

            if (absoluteDifference <= 1) {

                status += " • Receipt total verified ✓";

            } else {

                status +=
                    ` • Receipt mismatch: items $${(total / 100).toFixed(2)}` +
                    ` vs receipt $${(scannedReceiptTotalCents / 100).toFixed(2)}` +
                    ` • Difference: $${(absoluteDifference / 100).toFixed(2)}`;

            }

        }

        receiptAssignmentStatus.textContent = status;

    }

    // Save button requirements

    if (saveReceiptItemsBtn) {

        saveReceiptItemsBtn.disabled =

            !receiptGroupSelect ||
            !receiptGroupSelect.value ||
            !receiptPayerSelect ||
            !receiptPayerSelect.value ||
            receiptItems.length === 0 ||
            assignedCount !== receiptItems.length;

    }

}


// ==========================================
// SAVE ITEMIZED RECEIPT WITH DUPLICATE CHECK
// ==========================================

if (saveReceiptItemsBtn) {

    saveReceiptItemsBtn.addEventListener(
        "click",
        async () => {

            const groupId = receiptGroupSelect.value;

            const payerId = Number(
                receiptPayerSelect.value
            );

            if (!groupId || !payerId) {

                showReceiptMessage(
                    "Choose a group and payer first.",
                    true
                );

                return;

            }

            if (receiptItems.length === 0) {

                showReceiptMessage(
                    "Add at least one receipt item.",
                    true
                );

                return;

            }

            const validItems = receiptItems.every(item =>

                item.name.trim() &&
                Number.isFinite(Number(item.amount)) &&
                Number(item.amount) > 0 &&
                item.memberIds.length > 0

            );

            if (!validItems) {

                showReceiptMessage(
                    "Check every item's name, price and member assignment.",
                    true
                );

                return;

            }

            saveReceiptItemsBtn.disabled = true;

            try {

                // Duplicate check for new receipts only

                if (!editingReceiptExpenseId) {

                    showReceiptMessage(
                        "Checking for possible duplicate receipts..."
                    );

                    const totalCents = receiptItems.reduce(
                        (sum, item) => {

                            return sum +
                                Math.round(Number(item.amount) * 100);

                        },
                        0
                    );

                    const duplicateResponse = await fetch(
                        `/api/groups/${groupId}/check-duplicate-receipt`,
                        {

                            method: "POST",

                            headers: {
                                "Content-Type": "application/json"
                            },

                            body: JSON.stringify({

                                description: receiptDescription,
                                amount: totalCents / 100

                            })

                        }
                    );

                    const duplicateData =
                        await duplicateResponse.json();

                    if (
                        !duplicateResponse.ok ||
                        !duplicateData.success
                    ) {

                        throw new Error(
                            duplicateData.message ||
                            "Could not check for duplicate receipts."
                        );

                    }

                    if (duplicateData.duplicateFound) {

                        const matches =
                            duplicateData.possibleDuplicates || [];

                        const matchDetails = matches
                            .slice(0, 3)
                            .map(expense =>

                                `• ${expense.description} — $${(
                                    expense.amount_cents / 100
                                ).toFixed(2)}`

                            )
                            .join("\n");

                        const shouldContinue = window.confirm(

                            "⚠️ Possible duplicate receipt found!\n\n" +
                            matchDetails +
                            "\n\nDo you still want to save it?"

                        );

                        if (!shouldContinue) {

                            showReceiptMessage(
                                "Receipt saving cancelled. No expense was added."
                            );

                            return;

                        }

                    }

                }

                // CREATE OR UPDATE

                const isEditing =
                    editingReceiptExpenseId !== null;

                const url = isEditing

                    ? `/api/groups/${groupId}/receipt-expenses/${editingReceiptExpenseId}`

                    : `/api/groups/${groupId}/receipt-expenses`;

                const response = await fetch(url, {

                    method: isEditing ? "PUT" : "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({

                        description: receiptDescription,

                        payerId,

                        items: receiptItems.map(item => ({

                            name: item.name.trim(),

                            amount: Number(item.amount),

                            memberIds: item.memberIds

                        }))

                    })

                });

                const data = await response.json();

                if (!response.ok || !data.success) {

                    throw new Error(
                        data.message ||
                        "Could not save itemized receipt."
                    );

                }

                showReceiptMessage(

                    isEditing
                        ? "Itemized receipt updated successfully!"
                        : "Itemized receipt saved successfully!"

                );

                // Reset editing state

                editingReceiptExpenseId = null;

                receiptItems = [];

                receiptDescription = "Scanned receipt";

                scannedReceiptTotalCents = null;

                saveReceiptItemsBtn.textContent =
                    originalReceiptSaveButtonText;

                receiptPayerSelect.value = "";

                if (receiptItemsPanel) {
                    receiptItemsPanel.hidden = true;
                }

                renderReceiptItems();

                await refreshGroupData(groupId);

            } catch (error) {

                console.error("Receipt saving error:", error);

                showReceiptMessage(error.message, true);

            } finally {

                updateReceiptSummary();

            }

        }
    );

}


// ==========================================
// EXPENSE HISTORY FILTERS
// ==========================================

const expenseSearch = document.getElementById("expenseSearch");

const expenseMemberFilter = document.getElementById(
    "expenseMemberFilter"
);

const expenseDateFilter = document.getElementById(
    "expenseDateFilter"
);

const clearExpenseFilters = document.getElementById(
    "clearExpenseFilters"
);
if (expenseGroupFilter) {

    expenseGroupFilter.addEventListener(
        "change",
        renderGroupExpenses
    );

}

if (expenseSearch) {

    expenseSearch.addEventListener(
        "input",
        renderGroupExpenses
    );

}

if (expenseMemberFilter) {

    expenseMemberFilter.addEventListener(
        "change",
        renderGroupExpenses
    );

}

if (expenseDateFilter) {

    expenseDateFilter.addEventListener(
        "change",
        renderGroupExpenses
    );

}

if (clearExpenseFilters) {

    clearExpenseFilters.addEventListener("click", () => {

        if (expenseSearch) {
            expenseSearch.value = "";
        }

        if (expenseMemberFilter) {
            expenseMemberFilter.value = "";
        }

        if (expenseDateFilter) {
            expenseDateFilter.value = "";
        }
        if (expenseGroupFilter) {
            expenseGroupFilter.value = "";
        }

        renderGroupExpenses();

    });

}


// ==========================================
// QUICK RECEIPT SCANNER
// ==========================================

let quickReceiptFile = null;
const quickReceiptInput = document.getElementById("receiptInput");
const quickScanButton = document.getElementById("scanButton");
const quickReceiptStatus = document.getElementById("receiptStatus");
const quickReceiptResult = document.getElementById("receiptResult");

if (quickReceiptInput) {
    quickReceiptInput.addEventListener("change", () => {
        const file = quickReceiptInput.files && quickReceiptInput.files[0];

        if (!file) {
            quickReceiptFile = null;
            return;
        }

        if (!file.type.startsWith("image/")) {
            quickReceiptFile = null;
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent = "Choose an image file.";
            }
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            quickReceiptFile = null;
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent = "Images must be 5 MB or smaller.";
            }
            return;
        }

        quickReceiptFile = file;
        if (quickReceiptStatus) {
            quickReceiptStatus.textContent =
                `Selected ${file.name}. Scan when you are ready.`;
        }
    });
}

if (quickScanButton) {
    quickScanButton.addEventListener("click", async () => {
        if (!quickReceiptFile) {
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent = "Choose a receipt image first.";
            }
            return;
        }

        if (typeof Tesseract === "undefined" || !window.SplitSmartOCR) {
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent =
                    "The receipt scanner could not load. Check your connection and refresh.";
            }
            return;
        }

        quickScanButton.disabled = true;

        try {
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent = "Reading the receipt...";
            }

            const result = await Tesseract.recognize(
                quickReceiptFile,
                "eng",
                {
                    logger: info => {
                        if (
                            quickReceiptStatus &&
                            info.status === "recognizing text"
                        ) {
                            const progress = Math.round((info.progress || 0) * 100);
                            quickReceiptStatus.textContent =
                                `Reading the receipt... ${progress}%`;
                        }
                    }
                }
            );

            const text = result.data.text || "";
            if (quickReceiptResult) {
                quickReceiptResult.textContent = text || "No text recognized.";
            }

            const details = window.SplitSmartOCR.extractReceiptDetails(text);
            let items = window.SplitSmartOCR.extractReceiptItems(text);

            if (items.length === 0 && details.total !== null) {
                items = [{
                    name: details.merchant || "Receipt total",
                    amount: Number(details.total).toFixed(2),
                    memberIds: []
                }];
            }

            if (typeof window.setScannedReceiptItems === "function") {
                window.setScannedReceiptItems(items, details);
            }

            if (receiptItemsPanel) {
                receiptItemsPanel.hidden = false;
            }

            if (quickReceiptStatus) {
                const totalText = details.total === null
                    ? "Total was not detected. Enter it with the items."
                    : `Detected total ${Number(details.total).toFixed(2)}.`;
                quickReceiptStatus.textContent =
                    `Scan finished. ${totalText} Correct the items before saving.`;
            }

        } catch (error) {
            console.error("Quick receipt scan error:", error);
            if (quickReceiptStatus) {
                quickReceiptStatus.textContent =
                    "The scan failed. You can still add the items by hand.";
            }
        } finally {
            quickScanButton.disabled = false;
        }
    });
}


// ==========================================
// INITIALIZE
// ==========================================

if (groupSelect) {

    groupSelect.addEventListener(
        "change",
        loadMembers
    );

}

switchExpenseType("group");

loadGroups();

