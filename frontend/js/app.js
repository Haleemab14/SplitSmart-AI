
// ==========================================
// SPLITSMART AI - DASHBOARD
// ==========================================

const groupsList = document.getElementById("groupsList");
const createGroupBtn = document.getElementById("createGroupBtn");

const CURRENCY = "USD";
let recentActivities = [];


// ==========================================
// API HELPER
// ==========================================

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok || data.success === false) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}


// ==========================================
// CURRENCY FORMATTER
// ==========================================

function formatMoney(cents) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format((Number(cents) || 0) / 100);
}


// ==========================================
// SERVER STATUS
// ==========================================

async function checkServer() {
    const status = document.getElementById("serverStatus");

    if (!status) return;

    try {
        const data = await apiRequest("/api/health");

        status.textContent = data.message;
        status.style.color = "green";

    } catch (error) {
        status.textContent = "Server connection failed.";
        status.style.color = "red";

        console.error("Server check error:", error);
    }
}


// ==========================================
// HELPER: CREATE ELEMENT
// ==========================================

function createElement(tag, className, text = "") {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== "") {
        element.textContent = text;
    }

    return element;
}


// ==========================================
// HELPER: SHOW MESSAGE
// ==========================================

function showMessage(container, message, isError = false) {
    const messageElement = createElement(
        "p",
        "group-message",
        message
    );

    messageElement.style.color = isError
        ? "#d9534f"
        : "#238b70";

    container.appendChild(messageElement);

    setTimeout(() => {
        messageElement.remove();
    }, 3500);
}


// ==========================================
// LOAD GROUPS
// ==========================================


async function loadGroups() {
    if (!groupsList) return;

    groupsList.textContent = "Loading your groups...";

    try {
        // Fetch all groups belonging to the logged-in user.
        const data = await apiRequest("/api/groups");

        const groups = Array.isArray(data.groups)
            ? data.groups
            : [];

        // ==========================================
        // UPDATE GROUP LIST
        // ==========================================

        groupsList.innerHTML = "";

        const groupCountElement =
            document.getElementById("groupCount");

        if (groupCountElement) {
            groupCountElement.textContent = groups.length;
        }

        // ==========================================
        // POPULATE BOTH GROUP SELECTORS
        // ==========================================

        const analyticsGroupSelect =
            document.getElementById("analyticsGroupSelect");

        const finnyGroupSelect =
            document.getElementById("groupSelect");

        const previousGroupId =
            analyticsGroupSelect?.value ||
            finnyGroupSelect?.value ||
            "";

        [analyticsGroupSelect, finnyGroupSelect].forEach(select => {
            if (!select) return;

            select.innerHTML =
                '<option value="">Select a group</option>';

            groups.forEach(group => {
                const option = document.createElement("option");

                option.value = group.id;
                option.textContent = group.name;

                select.appendChild(option);
            });
        });

        // Restore the previous selection if possible.
        const selectedGroupExists = groups.some(
            group => String(group.id) === String(previousGroupId)
        );

        const selectedGroupId = selectedGroupExists
            ? String(previousGroupId)
            : groups.length > 0
                ? String(groups[0].id)
                : "";

        if (analyticsGroupSelect) {
            analyticsGroupSelect.value = selectedGroupId;
        }

        if (finnyGroupSelect) {
            finnyGroupSelect.value = selectedGroupId;
        }

        if (
            analyticsGroupSelect &&
            finnyGroupSelect &&
            !analyticsGroupSelect.dataset.syncBound
        ) {
            analyticsGroupSelect.dataset.syncBound = "true";

            analyticsGroupSelect.addEventListener("change", function () {
                if (finnyGroupSelect.value !== this.value) {
                    finnyGroupSelect.value = this.value;
                    finnyGroupSelect.dispatchEvent(new Event("change"));
                }
            });

            finnyGroupSelect.addEventListener("change", function () {
                if (analyticsGroupSelect.value !== this.value) {
                    analyticsGroupSelect.value = this.value;
                    analyticsGroupSelect.dispatchEvent(new Event("change"));
                }
            });
        }

        // Notify both systems of the initial group selection.
        if (selectedGroupId) {
            if (analyticsGroupSelect) {
                analyticsGroupSelect.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }

            if (finnyGroupSelect) {
                finnyGroupSelect.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }
        }

        // ==========================================
        // DISPLAY GROUP CARDS
        // ==========================================

        if (groups.length === 0) {
            groupsList.textContent =
                "No groups yet. Create your first group!";

            await loadGroupFinancialOverview([]);
            await loadMyCombinedGroupBalance([]);
            await loadSettlementTools([]);
            return;
        }

        groups.forEach(group => {
            groupsList.appendChild(createGroupCard(group));
        });

        // ==========================================
        // LOAD GROUP FINANCIAL INFORMATION
        // ==========================================

        await loadGroupFinancialOverview(groups);

        await loadMyCombinedGroupBalance(groups);

        await loadSettlementTools(groups);

    } catch (error) {
        console.error("Load groups error:", error);

        groupsList.textContent =
            error.message || "Could not load groups.";
    }
}


// ==========================================
// CREATE GROUP CARD
// ==========================================

function createGroupCard(group) {
    const card = createElement("details", "group-card");

    card.open = false;

    const summary = createElement(
        "summary",
        "group-card-summary"
    );

    const info = createElement("div", "group-card-info");

    const title = createElement(
        "h3",
        "",
        group.name
    );

    const members = Array.isArray(group.members)
        ? group.members
        : [];

    const count = createElement(
        "p",
        "",
        `${members.length} members · View group details`
    );

    info.append(title, count);

    const arrow = createElement(
        "span",
        "group-expand-icon",
        "⌄"
    );

    summary.append(info, arrow);

    const content = createElement(
        "div",
        "group-card-content"
    );

    const membersHeading = createElement(
        "p",
        "group-members-heading",
        "Group members"
    );

    const membersContainer = createElement(
        "div",
        "group-members"
    );

    members.forEach(member => {
        const memberRow = createElement(
            "div",
            "group-member-row"
        );

        const memberName = createElement(
            "span",
            "group-member-name",
            member.name
        );

        memberRow.append(memberName);

        if (group.role !== "member") {
            const removeButton = createElement(
                "button",
                "member-remove",
                "Remove"
            );

            removeButton.type = "button";

            removeButton.addEventListener("click", () => {
                removeMember(
                    group.id,
                    member.id,
                    member.name
                );
            });

            memberRow.appendChild(removeButton);
        }

        membersContainer.appendChild(memberRow);
    });


    // ADD MEMBER FORM

    const addForm = createElement(
        "form",
        "add-member-form"
    );

    const memberInput = createElement(
        "input",
        "member-input"
    );

    memberInput.type = "text";
    memberInput.placeholder = "Enter friend's name";
    memberInput.maxLength = 60;
    memberInput.required = true;

    const addButton = createElement(
        "button",
        "button button-soft",
        "+ Add member"
    );

    addButton.type = "submit";

    addForm.append(memberInput, addButton);

    addForm.addEventListener("submit", async event => {
        event.preventDefault();

        const name = memberInput.value.trim();

        if (!name) return;

        addButton.disabled = true;

        try {
            await apiRequest(
                `/api/groups/${group.id}/members`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ name })
                }
            );

            await loadGroups();

        } catch (error) {
            showMessage(content, error.message, true);
            addButton.disabled = false;
        }
    });


    // DELETE GROUP BUTTON

    const actions = createElement(
        "div",
        "group-card-actions"
    );

    const deleteButton = createElement(
        "button",
        "group-delete-button",
        "Delete group"
    );

    deleteButton.type = "button";

    deleteButton.addEventListener("click", () => {
        deleteGroup(group.id, group.name);
    });

    actions.appendChild(deleteButton);

    content.append(membersHeading, membersContainer);

    if (group.role !== "member") {
        content.append(addForm, actions);
    } else if (group.my_member_name) {
        content.appendChild(createElement(
            "p",
            "section-subtitle",
            `Linked as ${group.my_member_name}.`
        ));
    }

    card.append(summary, content);

    return card;
}


// ==========================================
// CREATE GROUP FORM
// ==========================================

function showCreateGroupForm() {
    if (!groupsList) return;

    if (document.getElementById("createGroupForm")) {
        return;
    }

    const form = createElement(
        "form",
        "create-group-form"
    );

    form.id = "createGroupForm";

    const heading = createElement(
        "h3",
        "",
        "Create a new group"
    );

    const groupNameInput = createElement(
        "input",
        "group-input"
    );

    groupNameInput.type = "text";
    groupNameInput.placeholder = "Group name";
    groupNameInput.maxLength = 100;
    groupNameInput.required = true;

    const membersInput = createElement(
        "input",
        "group-input"
    );

    membersInput.type = "text";
    membersInput.placeholder =
        "Friend names, separated by commas";

    membersInput.required = true;

    const help = createElement(
        "small",
        "",
        "Example: Alex, Sam, Jordan"
    );

    const submitButton = createElement(
        "button",
        "button button-soft",
        "Create group"
    );

    submitButton.type = "submit";

    const cancelButton = createElement(
        "button",
        "button button-soft",
        "Cancel"
    );

    cancelButton.type = "button";

    cancelButton.addEventListener("click", () => {
        form.remove();
    });

    form.append(
        heading,
        groupNameInput,
        membersInput,
        help,
        submitButton,
        cancelButton
    );

    groupsList.prepend(form);

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const name = groupNameInput.value.trim();

        const members = membersInput.value
            .split(",")
            .map(member => member.trim())
            .filter(Boolean);

        if (!name || members.length === 0) {
            showMessage(
                form,
                "Enter a group name and at least one member.",
                true
            );

            return;
        }

        if (members.length > 20) {
            showMessage(
                form,
                "A group can have up to 20 members.",
                true
            );

            return;
        }

        submitButton.disabled = true;

        try {
            await apiRequest("/api/groups", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name,
                    members
                })
            });

            await loadGroups();

        } catch (error) {
            showMessage(form, error.message, true);
            submitButton.disabled = false;
        }
    });
}


// ==========================================
// REMOVE MEMBER
// ==========================================

async function removeMember(groupId, memberId, memberName) {
    const confirmed = confirm(
        `Remove ${memberName} from this group?\n\n` +
        "Their historical expenses and balances will be preserved."
    );

    if (!confirmed) return;

    try {
        await apiRequest(
            `/api/groups/${groupId}/members/${memberId}`,
            {
                method: "DELETE"
            }
        );

        await loadGroups();

    } catch (error) {
        alert(error.message);
    }
}


// ==========================================
// FINNY SETTLEMENT INSIGHTS
// ==========================================

async function loadFinnySettlementInsight(groupId, container) {
    const card = document.createElement("div");
    card.className = "ss-finny-insight-card";

    const heading = document.createElement("h4");
    heading.textContent = "Finny Financial Insight";

    const message = document.createElement("p");
    message.textContent = "Finny is checking the group finances...";

    card.appendChild(heading);
    card.appendChild(message);
    container.appendChild(card);

    try {
        const [balanceResponse, settlementResponse] =
            await Promise.all([
                fetch(`/api/groups/${groupId}/balances`, {
                    credentials: "same-origin"
                }),
                fetch(`/api/groups/${groupId}/settlements`, {
                    credentials: "same-origin"
                })
            ]);

        const balanceData = await balanceResponse.json();
        const settlementData = await settlementResponse.json();

        if (!balanceResponse.ok || !balanceData.success ||
            !settlementResponse.ok || !settlementData.success) {
            throw new Error("Could not retrieve group finances.");
        }

        const balances = balanceData.balances || [];
        const settlements = settlementData.settlements || [];

        const totalOutstanding = settlements.reduce(
            (sum, item) => sum + item.amountCents,
            0
        );

        if (settlements.length === 0) {
            message.textContent =
                "Wonderful! This group currently has no outstanding settlements.";
            return;
        }

        const largestDebt = settlements.reduce(
            (largest, item) =>
                item.amountCents > largest.amountCents ? item : largest
        );

        message.textContent =
            `There are ${settlements.length} outstanding settlement(s) ` +
            `totalling ${formatMoney(totalOutstanding)}. ` +
            `${largestDebt.from} has the largest suggested payment: ` +
            `${formatMoney(largestDebt.amountCents)} to ${largestDebt.to}.`;

    } catch (error) {
        console.error("Finny insight error:", error);
        message.textContent =
            "I couldn't load this group's financial insights right now.";
    }
}

// ==========================================
// DELETE ENTIRE GROUP
// ==========================================

async function deleteGroup(groupId, groupName) {
    const confirmed = confirm(
        `Permanently delete "${groupName}"?\n\n` +
        "All expenses, receipts, members and group records " +
        "will be deleted. This cannot be undone."
    );

    if (!confirmed) return;

    try {
        await apiRequest(
            `/api/groups/${groupId}`,
            {
                method: "DELETE"
            }
        );

        await Promise.all([
            loadGroups(),
            loadDashboardActivity()
        ]);

    } catch (error) {
        alert(error.message);
    }
}



function renderExpenseSummary(groupExpenses, personalExpenses) {

    const groupTotal = groupExpenses.reduce(
        (sum, expense) =>
            sum + (Number(expense.amount_cents) || 0),
        0
    );

    const personalTotal = personalExpenses.reduce(
        (sum, expense) =>
            sum + (Number(expense.amount_cents) || 0),
        0
    );

    const groupAmount =
        document.getElementById("groupExpenseTotal");

    const personalAmount =
        document.getElementById("personalExpenseTotal");

    const groupMeta =
        document.getElementById("groupExpenseMeta");

    const personalMeta =
        document.getElementById("personalExpenseMeta");

    if (groupAmount) {
        groupAmount.textContent = formatMoney(groupTotal);
    }

    if (personalAmount) {
        personalAmount.textContent = formatMoney(personalTotal);
    }

    if (groupMeta) {
        groupMeta.textContent =
            `${groupExpenses.length} recorded expense(s)`;
    }

    if (personalMeta) {
        personalMeta.textContent =
            `${personalExpenses.length} recorded expense(s)`;
    }
}


async function addMyMemberSelector(groupId, balances, content, groups) {
    const box = createElement("div", "ss-identity-box");

    box.appendChild(
        createElement(
            "h4",
            "",
            "Select Your Identity"
        )
    );

    box.appendChild(
        createElement(
            "p",
            "",
            "Choose your name so SplitSmart can calculate your own group balance."
        )
    );

    try {
        const data = await apiRequest(
            `/api/groups/${groupId}/my-member`
        );

        const select = createElement("select", "ss-identity-select");
        select.setAttribute("aria-label", "Select your group member");

        const placeholder = createElement(
            "option",
            "",
            "Select your name"
        );

        placeholder.value = "";
        select.appendChild(placeholder);

        (data.members || []).forEach(member => {
            const option = createElement(
                "option",
                "",
                member.name
            );

            option.value = member.id;
            select.appendChild(option);
        });

        if (data.myMemberId) {
            select.value = String(data.myMemberId);
        }

        const saveButton = createElement(
            "button",
            "ss-identity-save",
            "Save my identity"
        );

        saveButton.type = "button";

        const result = createElement(
            "p",
            "ss-identity-result"
        );

        const ownBalance = createElement(
            "div",
            "ss-my-balance"
        );

        function showOwnBalance(memberId) {
            ownBalance.innerHTML = "";

            const member = balances.find(
                item => String(item.memberId) === String(memberId)
            );

            if (!member) return;

            const balance = Number(member.balance) || 0;

            let message;

            if (balance > 0) {
                message = `You are owed ${formatMoney(balance)}`;
            } else if (balance < 0) {
                message =
                    `You owe ${formatMoney(Math.abs(balance))}`;
            } else {
                message = "Your group balance is settled.";
            }

            ownBalance.appendChild(
                createElement("strong", "", "Your group balance")
            );

            ownBalance.appendChild(
                createElement("p", "", message)
            );
        }

        if (data.myMemberId) {
            showOwnBalance(data.myMemberId);
        }

        saveButton.addEventListener("click", async () => {
            if (!select.value) {
                result.textContent = "Please select your name first.";
                return;
            }

            saveButton.disabled = true;
            result.textContent = "Saving...";

            try {
                await apiRequest(
                    `/api/groups/${groupId}/my-member`,
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            memberId: Number(select.value)
                        })
                    }
                );

                result.textContent = "Your identity has been saved.";

                await loadGroups();

            } catch (error) {
                result.textContent = error.message;
                saveButton.disabled = false;
            }
        });

        box.append(
            select,
            saveButton,
            result,
            ownBalance
        );

    } catch (error) {
        console.error("Member identity selector error:", error);

        box.appendChild(
            createElement(
                "p",
                "",
                "Could not load the member selector."
            )
        );
    }

    content.prepend(box);
}

async function loadGroupFinancialOverview(groups) {
    const list = document.getElementById("financialGroupList");

    if (!list) return;

    list.replaceChildren();

    if (!groups.length) {
        list.appendChild(
            createElement(
                "p",
                "balance-empty",
                "Create a group to see its financial overview."
            )
        );
        return;
    }

    for (const group of groups) {
        const details = createElement(
            "details",
            "ss-financial-group"
        );

        const summary = createElement(
            "summary",
            "ss-financial-group-summary"
        );

        const summaryInfo = createElement(
            "div",
            "ss-financial-group-info"
        );

        const groupName = createElement(
            "h3",
            "",
            group.name
        );

        const meta = createElement("div", "ss-fin-meta");
        const memberStat = createElement(
            "span",
            "ss-fin-stat",
            "Loading members"
        );
        const settleStat = createElement(
            "span",
            "ss-fin-stat",
            "Loading settlements"
        );
        meta.append(memberStat, settleStat);
        summaryInfo.append(groupName, meta);

        const arrow = createElement("span", "ss-fin-toggle");
        arrow.setAttribute("aria-hidden", "true");

        summary.append(summaryInfo, arrow);

        const content = createElement(
            "div",
            "ss-financial-content"
        );

        details.append(summary, content);
        list.appendChild(details);

        try {
            const [balanceData, settlementData] =
                await Promise.all([
                    apiRequest(
                        `/api/groups/${group.id}/balances`
                    ),
                    apiRequest(
                        `/api/groups/${group.id}/settlements`
                    )
                ]);


            const balances = Array.isArray(balanceData.balances)
                ? balanceData.balances
                : [];

            const settlements = Array.isArray(
                settlementData.settlements
            )
                ? settlementData.settlements
                : [];

            // Link the logged-in user to their group member identity.
            if (group.role !== "member") {
                await addMyMemberSelector(
                    group.id,
                    balances,
                    content,
                    groups
                );
            }


            const totalOwed = balances.reduce(
                (sum, member) =>
                    sum + Math.max(
                        Number(member.balance) || 0,
                        0
                    ),
                0
            );

            const totalOwing = balances.reduce(
                (sum, member) =>
                    sum + Math.max(
                        -(Number(member.balance) || 0),
                        0
                    ),
                0
            );

            memberStat.textContent =
                `${balances.length} ${balances.length === 1 ? "member" : "members"}`;
            settleStat.textContent =
                `${settlements.length} suggested ${settlements.length === 1 ? "settlement" : "settlements"}`;

            // TWO SUMMARY CARDS

            const summaryGrid = createElement(
                "div",
                "ss-balance-summary"
            );

            function createMetric(label, amount) {
                const metric = createElement(
                    "div",
                    "ss-summary-metric"
                );

                const metricLabel = createElement(
                    "span",
                    "ss-summary-label",
                    label
                );

                const metricValue = createElement(
                    "strong",
                    "ss-summary-value",
                    formatMoney(amount)
                );

                metric.append(
                    metricLabel,
                    metricValue
                );

                return metric;
            }

            summaryGrid.append(
                createMetric(
                    "Owed to members",
                    totalOwed
                ),
                createMetric(
                    "Owed by members",
                    totalOwing
                )
            );

            content.appendChild(summaryGrid);

            const columns = createElement(
                "div",
                "ss-financial-columns"
            );
            const membersColumn = createElement(
                "div",
                "ss-financial-column"
            );
            const settlementsColumn = createElement(
                "div",
                "ss-financial-column"
            );

            // MEMBER BALANCES

            membersColumn.appendChild(
                createElement(
                    "h4",
                    "ss-section-heading",
                    "Member balances"
                )
            );

            const memberList = createElement(
                "div",
                "ss-member-list"
            );

            if (!balances.length) {
                memberList.appendChild(
                    createElement(
                        "p",
                        "",
                        "No member balances available yet."
                    )
                );
            }

            balances.forEach(member => {
                const row = createElement(
                    "div",
                    "ss-balance-row"
                );

                const name = createElement(
                    "span",
                    "ss-member-name",
                    member.name || "Group member"
                );

                const balance = Number(member.balance) || 0;

                let status;
                let statusClass;

                if (balance > 0) {
                    status = `Owed ${formatMoney(balance)}`;
                    statusClass = "ss-status-owed";
                } else if (balance < 0) {
                    status =
                        `Owes ${formatMoney(Math.abs(balance))}`;
                    statusClass = "ss-status-owing";
                } else {
                    status = "Settled";
                    statusClass = "ss-status-settled";
                }

                const badge = createElement(
                    "span",
                    `ss-balance-status ${statusClass}`,
                    status
                );

                row.append(name, badge);
                memberList.appendChild(row);
            });

            membersColumn.appendChild(memberList);

            // SUGGESTED SETTLEMENTS

            settlementsColumn.appendChild(
                createElement(
                    "h4",
                    "ss-section-heading",
                    "Who owes whom"
                )
            );

            const settlementList = createElement(
                "div",
                "ss-settlement-list"
            );

            if (!settlements.length) {
                settlementList.appendChild(
                    createElement(
                        "p",
                        "",
                        "Everyone is settled up!"
                    )
                );
            }

            settlements.forEach(settlement => {
                const row = createElement(
                    "div",
                    "ss-settlement-row"
                );

                const flow = createElement(
                    "div",
                    "ss-settlement-flow"
                );

                flow.append(
                    createElement(
                        "strong",
                        "",
                        settlement.from || "Member"
                    ),
                    createElement(
                        "span",
                        "ss-owes-label",
                        "owes"
                    ),
                    createElement(
                        "strong",
                        "",
                        settlement.to || "Member"
                    )
                );

                const amount = createElement(
                    "strong",
                    "ss-settlement-amount",
                    formatMoney(settlement.amountCents)
                );

                row.append(flow, amount);
                settlementList.appendChild(row);
            });

            settlementsColumn.appendChild(settlementList);
            settlementsColumn.appendChild(
                createElement(
                    "p",
                    "ss-settlement-note",
                    "Suggested payments only. No money has moved."
                )
            );

            columns.append(membersColumn, settlementsColumn);
            content.appendChild(columns);

        } catch (error) {
            console.error(
                `Financial overview error for ${group.name}:`,
                error
            );

            memberStat.textContent = "Unavailable";
            settleStat.textContent = "Balances not loaded";

            content.appendChild(
                createElement(
                    "p",
                    "",
                    "Could not load this group's financial information."
                )
            );
        }
    }
}

async function loadMyCombinedGroupBalance(groups) {
    const host = document.getElementById(
        "combinedBalanceHost"
    );

    if (!host) return;

    host.replaceChildren();

    const card = document.createElement("details");
    card.className = "ss-combined-balance";
    card.id = "myCombinedGroupBalance";

    const summary = document.createElement("summary");
    summary.className = "ss-combined-summary";

    const summaryText = createElement("div", "ss-combined-heading");
    summaryText.append(
        createElement("h3", "", "Combined Group Balance"),
        createElement(
            "p",
            "ss-combined-hint",
            "Groups where you have selected your identity."
        )
    );

    const value = createElement(
        "strong",
        "ss-combined-value",
        "Calculating..."
    );

    const toggle = createElement("span", "ss-fin-toggle");
    toggle.setAttribute("aria-hidden", "true");

    summary.append(summaryText, value, toggle);

    const body = createElement("div", "ss-combined-body");

    const description = createElement(
        "p",
        "ss-combined-description",
        "Select your identity inside a group to include it here."
    );

    const note = createElement(
        "small",
        "ss-combined-note",
        ""
    );

    body.append(description, note);
    card.append(summary, body);
    host.appendChild(card);

    let combinedBalance = 0;
    let selectedGroups = 0;

    for (const group of groups) {
        try {
            const [identityData, balanceData] =
                await Promise.all([
                    apiRequest(
                        `/api/groups/${group.id}/my-member`
                    ),
                    apiRequest(
                        `/api/groups/${group.id}/balances`
                    )
                ]);

            if (!identityData.myMemberId) continue;

            const member = (balanceData.balances || []).find(
                item =>
                    String(item.memberId) ===
                    String(identityData.myMemberId)
            );

            if (!member) continue;

            combinedBalance += Number(member.balance) || 0;
            selectedGroups++;

        } catch (error) {
            console.error(
                `Combined balance error for ${group.name}:`,
                error
            );
        }
    }

    value.textContent = formatMoney(
        Math.abs(combinedBalance)
    );
    value.classList.remove("is-owed", "is-owing");

    if (combinedBalance > 0) {
        description.textContent =
            "Overall, other members owe you:";
        value.classList.add("is-owed");
    } else if (combinedBalance < 0) {
        description.textContent =
            "Overall, you owe other members:";
        value.classList.add("is-owing");
    } else {
        description.textContent =
            "Your combined group balance is settled.";
    }

    note.textContent =
        `${selectedGroups} of ${groups.length} groups included. ` +
        "This is a summary, not a completed payment.";
}

// ==========================================
// LOAD DASHBOARD EXPENSE DATA
// ==========================================

async function loadDashboardActivity() {
    const activityList =
        document.getElementById("recentActivityList");

    if (!activityList) return;

    activityList.textContent = "Loading recent activity...";

    try {
        const results = await Promise.allSettled([
            apiRequest("/api/expenses"),
            apiRequest("/api/personal-expenses")
        ]);

        const groupResult = results[0];
        const personalResult = results[1];
        const groupExpenses =
            groupResult.status === "fulfilled"
                ? groupResult.value.expenses || []
                : [];

        const personalExpenses =
            personalResult.status === "fulfilled"
                ? personalResult.value.expenses || []
                : [];

        if (
            groupResult.status === "fulfilled" &&
            personalResult.status === "fulfilled"
        ) {
            renderExpenseSummary(groupExpenses, personalExpenses);
        }
        const activities = [];

        if (groupResult.status === "fulfilled") {
            const expenses = groupResult.value.expenses || [];

            expenses.forEach(expense => {
                activities.push({
                    id: expense.id,
                    type: "group",
                    description: expense.description,
                    amount: Number(expense.amount_cents) || 0,
                    groupName: expense.group_name || "Group expense",
                    payerName: expense.payer_name || "Unknown payer",
                    date: expense.created_at || null
                });
            });
        } else {
            console.error(
                "Could not load group expenses:",
                groupResult.reason
            );
        }

        if (personalResult.status === "fulfilled") {
            const expenses = personalResult.value.expenses || [];

            expenses.forEach(expense => {
                activities.push({
                    id: expense.id,
                    type: "personal",
                    description: expense.description,
                    amount: Number(expense.amount_cents) || 0,
                    groupName: "Personal expense",
                    payerName: "You",
                    date: expense.created_at || null
                });
            });
        } else {
            console.error(
                "Could not load personal expenses:",
                personalResult.reason
            );
        }

        activities.sort((a, b) => {
            const dateA = a.date
                ? new Date(a.date).getTime()
                : 0;

            const dateB = b.date
                ? new Date(b.date).getTime()
                : 0;

            return dateB - dateA;
        });

        recentActivities = activities;
        renderRecentActivity(activities);

        if (
            groupResult.status === "rejected" &&
            personalResult.status === "rejected"
        ) {
            activityList.textContent =
                "Could not load your recent expenses.";

        } else if (
            groupResult.status === "rejected" ||
            personalResult.status === "rejected"
        ) {
            showMessage(
                activityList,
                "Some expense activity could not be loaded.",
                true
            );
        }

    } catch (error) {
        console.error("Dashboard activity error:", error);

        activityList.textContent =
            "Could not load recent activity.";
    }
}



function renderRecentActivity(activities) {
    const activityList =
        document.getElementById("recentActivityList");

    if (!activityList) return;

    const query = (
        document.getElementById("dashboardSearch")?.value || ""
    ).trim().toLowerCase();

    const visibleActivities = query
        ? activities.filter(activity => {
            const haystack = [
                activity.description,
                activity.groupName,
                activity.payerName,
                activity.type
            ].join(" ").toLowerCase();
            return haystack.includes(query);
        })
        : activities;

    activityList.innerHTML = "";

    if (!visibleActivities.length) {
        activityList.textContent = query
            ? "No activity matches that search."
            : "No expenses recorded yet. Your activity will appear here.";
        return;
    }

    const timeline = createElement(
        "div",
        "ss-activity-timeline"
    );

    visibleActivities.slice(0, 12).forEach(activity => {
        const entry = createElement(
            "details",
            "ss-activity-entry"
        );

        const summary = createElement(
            "summary",
            "ss-activity-summary"
        );

        const left = createElement(
            "div",
            "ss-activity-main"
        );

        const icon = createElement(
            "span",
            "ss-activity-icon",
            activity.type === "group" ? "G" : "P"
        );

        const information = createElement(
            "div",
            "ss-activity-information"
        );

        const title = createElement(
            "strong",
            "",
            activity.description || "Expense"
        );

        const category = activity.type === "group"
            ? activity.groupName
            : "Personal expense";

        const subtitle = createElement(
            "small",
            "",
            category
        );

        information.append(title, subtitle);
        left.append(icon, information);

        const right = createElement(
            "div",
            "ss-activity-right"
        );

        const amount = createElement(
            "strong",
            "ss-activity-amount",
            formatMoney(activity.amount)
        );

        const expand = createElement(
            "span",
            "ss-activity-expand",
            "⌄"
        );

        right.append(amount, expand);
        summary.append(left, right);

        // EXPANDED TRANSACTION DETAILS

        const detailPanel = createElement(
            "div",
            "ss-activity-details"
        );

        function addDetail(label, value) {
            const row = createElement(
                "div",
                "ss-activity-detail-row"
            );

            row.append(
                createElement("span", "", label),
                createElement("strong", "", value)
            );

            detailPanel.appendChild(row);
        }

        addDetail(
            "Expense type",
            activity.type === "group"
                ? "Group expense"
                : "Personal expense"
        );

        if (activity.type === "group") {
            addDetail(
                "Group",
                activity.groupName || "Not available"
            );

            addDetail(
                "Paid by",
                activity.payerName || "Not available"
            );
        }

        if (activity.date) {
            const parsedDate = new Date(activity.date);

            const formattedDate = Number.isNaN(
                parsedDate.getTime()
            )
                ? "Date unavailable"
                : new Intl.DateTimeFormat(
                    "en-GB",
                    {
                        dateStyle: "medium",
                        timeStyle: "short"
                    }
                ).format(parsedDate);

            addDetail("Date", formattedDate);
        } else {
            addDetail("Date", "Not available");
        }

        if (activity.id !== undefined) {
            addDetail("Expense reference", `#${activity.id}`);
        }

        detailPanel.appendChild(
            createElement(
                "p",
                "ss-activity-note",
                "This is a recorded expense, not a completed PayPal payment."
            )
        );

        entry.append(summary, detailPanel);
        timeline.appendChild(entry);
    });

    activityList.appendChild(timeline);
}


// ==========================================
// SETTLEMENT HISTORY + DEMO PAYMENT UI
// ==========================================

function buildSettlementEntry({
    from,
    to,
    amountCents,
    statusLabel = "",
    statusClass = "",
    dateText = "",
    action = null
}) {
    const row = document.createElement("div");
    row.className = statusLabel
        ? "ss-settlement-history-row is-history"
        : "ss-settlement-history-row";

    const addParty = (label, name) => {
        const party = document.createElement("div");
        party.className = "ss-settle-party";

        const caption = document.createElement("small");
        caption.textContent = label;

        const strong = document.createElement("strong");
        strong.textContent = name || "Member";

        party.append(caption, strong);
        row.appendChild(party);
    };

    addParty("Pays", from);

    const arrow = document.createElement("span");
    arrow.className = "ss-settle-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    row.appendChild(arrow);

    addParty("Receives", to);

    const amount = document.createElement("strong");
    amount.className = "ss-settle-amount";
    amount.textContent = formatMoney(amountCents);
    row.appendChild(amount);

    if (statusLabel) {
        const status = document.createElement("span");
        status.className = `ss-settlement-recorded-status ${statusClass}`;
        status.textContent = statusLabel;
        row.appendChild(status);
    }

    if (dateText) {
        const date = document.createElement("small");
        date.className = "ss-settle-date";
        date.textContent = dateText;
        row.appendChild(date);
    }

    if (action) {
        row.appendChild(action);
    }

    return row;
}

async function loadSettlementTools(groups) {
    if (!groupsList) return;

    let section = document.getElementById("ssSettlementTools");

    if (!section) {
        section = document.createElement("section");
        section.id = "ssSettlementTools";
        section.className = "ss-settlement-tools";
        groupsList.insertAdjacentElement("afterend", section);
    }

    section.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = "Settlement History";
    section.appendChild(heading);

    if (!groups || groups.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "Create a group to start tracking settlements.";
        section.appendChild(empty);
        return;
    }

    for (const group of groups) {
        const groupCard = document.createElement("div");
        groupCard.className = "ss-settlement-history-card";

        const groupHeading = document.createElement("h3");
        groupHeading.textContent = group.name;
        groupCard.appendChild(groupHeading);

        const suggestionsContainer = document.createElement("div");
        suggestionsContainer.className = "ss-pending-settlements";

        const suggestionsTitle = document.createElement("h4");
        suggestionsTitle.textContent = "Outstanding settlements";
        groupCard.appendChild(suggestionsTitle);
        groupCard.appendChild(suggestionsContainer);

        const historyTitle = document.createElement("h4");
        historyTitle.textContent = "Settlement history";
        groupCard.appendChild(historyTitle);

        const historyContainer = document.createElement("div");
        historyContainer.className = "ss-settlement-history-list";
        groupCard.appendChild(historyContainer);

        section.appendChild(groupCard);

        const insightHost = document.createElement("div");
        insightHost.className = "ss-finny-insight-host";
        section.appendChild(insightHost);
        loadFinnySettlementInsight(group.id, insightHost);

        try {
            const [suggestionResponse, historyResponse] =
                await Promise.all([
                    fetch(`/api/groups/${group.id}/settlements`, {
                        credentials: "same-origin"
                    }),
                    fetch(`/api/groups/${group.id}/settlement-history`, {
                        credentials: "same-origin"
                    })
                ]);

            const suggestionData = await suggestionResponse.json();
            const historyData = await historyResponse.json();

            if (!suggestionResponse.ok || !suggestionData.success) {
                throw new Error(
                    suggestionData.message || "Could not load suggestions."
                );
            }

            if (!historyResponse.ok || !historyData.success) {
                throw new Error(
                    historyData.message || "Could not load history."
                );
            }

            const suggestions = suggestionData.settlements || [];
            const history = historyData.history || [];

            if (suggestions.length === 0) {
                const empty = document.createElement("p");
                empty.textContent = "No outstanding settlements.";
                suggestionsContainer.appendChild(empty);
            }

            suggestions.forEach(settlement => {
                const paidButton = document.createElement("button");
                paidButton.type = "button";
                paidButton.className = "ss-demo-paid-button";
                paidButton.textContent = "Save unpaid note";

                paidButton.addEventListener("click", async () => {
                    const confirmed = window.confirm(
                        `Save an unpaid note for ${formatMoney(settlement.amountCents)} ` +
                        `from ${settlement.from} to ${settlement.to}?\n\n` +
                        "This does not move money and does not change balances."
                    );

                    if (!confirmed) return;

                    paidButton.disabled = true;
                    paidButton.textContent = "Recording...";

                    try {
                        const response = await fetch(
                            `/api/groups/${group.id}/settlements/record`,
                            {
                                method: "POST",
                                credentials: "same-origin",
                                headers: {
                                    "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                    fromId: settlement.fromId,
                                    toId: settlement.toId,
                                    amountCents: settlement.amountCents
                                })
                            }
                        );

                        const result = await response.json();

                        if (!response.ok || !result.success) {
                            throw new Error(
                                result.message || "Could not record settlement."
                            );
                        }

                        await loadGroups();

                    } catch (error) {
                        console.error("Settlement recording error:", error);
                        alert(error.message);

                        paidButton.disabled = false;
                        paidButton.textContent = "Save unpaid note";
                    }
                });

                suggestionsContainer.appendChild(buildSettlementEntry({
                    from: settlement.from,
                    to: settlement.to,
                    amountCents: settlement.amountCents,
                    action: paidButton
                }));
            });

            if (history.length === 0) {
                const empty = document.createElement("p");
                empty.textContent = "No settlement notes recorded yet.";
                historyContainer.appendChild(empty);
            }

            history.forEach(record => {
                const recordedStatus = String(record.status || "").toLowerCase();
                const isPaid = recordedStatus === "paid";

                historyContainer.appendChild(buildSettlementEntry({
                    from: record.from,
                    to: record.to,
                    amountCents: record.amountCents,
                    statusLabel: isPaid ? "PayPal verified" : "Unpaid note",
                    statusClass: isPaid ? "is-verified" : "is-note",
                    dateText: record.createdAt
                        ? new Date(record.createdAt + " UTC").toLocaleString()
                        : ""
                }));
            });

        } catch (error) {
            console.error(
                `Settlement tools error for group ${group.id}:`,
                error
            );

            const message = document.createElement("p");
            message.textContent = error.message;
            message.className = "ss-settlement-error";
            groupCard.appendChild(message);
        }
    }
}

// ==========================================
// BUTTON EVENTS
// ==========================================

if (createGroupBtn) {
    createGroupBtn.addEventListener(
        "click",
        showCreateGroupForm
    );
}


// ==========================================
// START DASHBOARD
// ==========================================

async function startDashboard() {
    const dashboardSearch = document.getElementById("dashboardSearch");

    if (dashboardSearch) {
        let searchTimer = null;
        dashboardSearch.addEventListener("input", () => {
            renderRecentActivity(recentActivities);
            filterDashboardGroups(dashboardSearch.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => searchWorkspace(dashboardSearch.value), 250);
        });
    }

    await Promise.all([
        checkServer(),
        loadGroups(),
        loadDashboardActivity()
    ]);
}

function filterDashboardGroups(query) {
    const term = String(query || "").trim().toLowerCase();
    document.querySelectorAll("#groupsList .group-card").forEach(card => {
        const name = card.querySelector("h3")?.textContent || "";
        card.hidden = Boolean(term) && !name.toLowerCase().includes(term);
    });
}

async function searchWorkspace(query) {
    const host = document.getElementById("workspaceSearchResults");
    if (!host) return;

    const term = String(query || "").trim();
    if (term.length < 2) {
        host.hidden = true;
        host.replaceChildren();
        return;
    }

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
            credentials: "same-origin"
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            host.hidden = true;
            return;
        }

        host.hidden = false;
        host.replaceChildren();
        const heading = document.createElement("p");
        heading.textContent = `${data.count} matching record(s) · ${data.source}`;
        host.appendChild(heading);

        (data.results || []).slice(0, 12).forEach(item => {
            const row = document.createElement("p");
            const amount = Number.isInteger(item.amountCents)
                ? ` ${((item.amountCents) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`
                : "";
            row.textContent = `${item.kind}: ${item.title || item.description || item.groupName || ""}${amount}${item.groupName ? ` · ${item.groupName}` : ""}`;
            host.appendChild(row);
        });
    } catch (error) {
        host.hidden = true;
    }
}

startDashboard();

