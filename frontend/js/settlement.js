// ==========================================
// SPLITSMART AI - SETTLEMENT & PAYPAL SANDBOX
// ==========================================

const groupSelect = document.getElementById("settlementGroupSelect");
const statusElement = document.getElementById("settlementStatus");
const refreshBtn = document.getElementById("refreshSettlementsBtn");

const balancesList = document.getElementById("balancesList");
const suggestionsList = document.getElementById("suggestionsList");
const historyList = document.getElementById("historyList");

const memberCount = document.getElementById("memberCount");
const outstandingTotal = document.getElementById("outstandingTotal");
const suggestionCount = document.getElementById("suggestionCount");
const paypalGatewayStatus = document.getElementById("paypalGatewayStatus");

let paypalConfig = {
    enabled: false,
    clientId: null,
    mode: "sandbox",
    currency: "USD"
};

// ==========================================
// FORMATTING HELPERS
// ==========================================

function formatMoney(cents) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format((Number(cents) || 0) / 100);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ==========================================
// API HELPER
// ==========================================

async function settlementRequest(url, options = {}) {
    const defaultHeaders = {
        "Accept": "application/json"
    };

    if (options.body && typeof options.body === "string") {
        defaultHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers: {
            ...defaultHeaders,
            ...options.headers
        },
        body: options.body
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
        const error = new Error(data.message || "Request failed.");
        error.code = data.code || "";
        error.needsApproval = data.needsApproval === true;
        throw error;
    }

    return data;
}

// ==========================================
// PAYPAL CONFIGURATION CHECK
// ==========================================

async function checkPaypalConfig() {
    try {
        const data = await settlementRequest("/api/paypal/config");
        paypalConfig = data;

        if (paypalGatewayStatus) {
            if (data.enabled) {
                paypalGatewayStatus.textContent = "Sandbox Ready (Client ID Configured)";
                paypalGatewayStatus.style.borderColor = "#86efac";
                paypalGatewayStatus.style.color = "#15803d";
                paypalGatewayStatus.style.background = "#f0fdf4";
            } else {
                paypalGatewayStatus.textContent = "Sandbox Mode (Keys Pending in .env)";
                paypalGatewayStatus.style.borderColor = "#bfdbfe";
                paypalGatewayStatus.style.color = "#2563eb";
                paypalGatewayStatus.style.background = "#ffffff";
            }
        }
    } catch (error) {
        console.warn("PayPal config check error:", error);
        if (paypalGatewayStatus) {
            paypalGatewayStatus.textContent = "Gateway Offline";
        }
    }
}

// ==========================================
// LOAD GROUPS
// ==========================================

async function loadSettlementGroups() {
    try {
        if (statusElement) statusElement.textContent = "Loading groups...";

        const data = await settlementRequest("/api/groups");

        if (!Array.isArray(data.groups)) {
            throw new Error("Invalid group list received.");
        }

        groupSelect.innerHTML = "";

        if (data.groups.length === 0) {
            groupSelect.innerHTML = '<option value="">No groups found</option>';
            showEmptyState();
            if (statusElement) statusElement.textContent = "Create an expense group first.";
            return;
        }

        data.groups.forEach(group => {
            const option = document.createElement("option");
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        });

        // Check if group ID passed in URL
        const urlParams = new URLSearchParams(window.location.search);
        const queryGroupId = urlParams.get("group");

        if (queryGroupId && data.groups.some(g => String(g.id) === String(queryGroupId))) {
            groupSelect.value = queryGroupId;
        } else {
            groupSelect.value = String(data.groups[0].id);
        }

        await loadSettlementData(groupSelect.value);

    } catch (error) {
        console.error("Settlement group loading error:", error);
        if (statusElement) {
            statusElement.textContent = error.message || "Could not load groups.";
        }
        showEmptyState();
    }
}

// ==========================================
// EMPTY STATES
// ==========================================

function showEmptyState() {
    if (balancesList) {
        balancesList.innerHTML = '<div class="empty-state">No group balances available.</div>';
    }
    if (suggestionsList) {
        suggestionsList.innerHTML = '<div class="empty-state">No settlement suggestions available.</div>';
    }
    renderHistory([]);

    if (memberCount) memberCount.textContent = "0";
    if (outstandingTotal) outstandingTotal.textContent = formatMoney(0);
    if (suggestionCount) suggestionCount.textContent = "0";
}

// ==========================================
// LOAD SELECTED GROUP DATA
// ==========================================

async function loadSettlementData(groupId) {
    if (!groupId) {
        showEmptyState();
        if (statusElement) statusElement.textContent = "Select a group.";
        return;
    }

    try {
        if (statusElement) statusElement.textContent = "Calculating balances & settlements...";

        balancesList.innerHTML = '<div class="empty-state">Loading balances...</div>';
        suggestionsList.innerHTML = '<div class="empty-state">Calculating optimal settlements...</div>';
        if (settlementHistoryGrid) {
            window.ssGrid.setRows(settlementHistoryGrid, []);
        }

        const [balanceData, settlementData, historyData] = await Promise.all([
            settlementRequest(`/api/groups/${groupId}/balances`),
            settlementRequest(`/api/groups/${groupId}/settlements`),
            settlementRequest(`/api/groups/${groupId}/settlement-history`)
        ]);

        renderBalances(balanceData.balances || []);
        renderSuggestions(
            settlementData.settlements || [],
            settlementData.myMemberId,
            settlementData.canRecordNote === true
        );
        renderHistory(historyData.history || []);

        if (statusElement) {
            statusElement.textContent = "Balances & settlements synchronized";
        }

    } catch (error) {
        console.error("Settlement data loading error:", error);
        if (statusElement) {
            statusElement.textContent = error.message || "Failed to load settlement data.";
        }
        showEmptyState();
    }
}

// ==========================================
// RENDER BALANCES
// ==========================================

function renderBalances(balances) {
    if (memberCount) memberCount.textContent = balances.length;

    const totalOwed = balances
        .filter(member => Number(member.balance) < 0)
        .reduce((sum, member) => sum + Math.abs(Number(member.balance)), 0);

    if (outstandingTotal) outstandingTotal.textContent = formatMoney(totalOwed);

    if (balances.length === 0) {
        balancesList.innerHTML = '<div class="empty-state">This group has no members.</div>';
        return;
    }

    balancesList.innerHTML = balances.map(member => {
        const balance = Number(member.balance) || 0;
        const totalPaid = Number(member.totalPaid) || 0;
        const totalShare = Number(member.totalShare) || 0;

        let statusBadge = "";
        let amountColor = "var(--text-main)";

        if (balance > 0) {
            statusBadge = '<span class="settlement-status" style="background: #ecfdf5; color: #047857;">Should Receive</span>';
            amountColor = "#059669";
        } else if (balance < 0) {
            statusBadge = '<span class="settlement-status" style="background: #fef2f2; color: #b91c1c;">Needs to Pay</span>';
            amountColor = "#dc2626";
        } else {
            statusBadge = '<span class="settlement-status" style="background: #f1f5f9; color: #475569;">Settled</span>';
            amountColor = "#64748b";
        }

        return `
            <div class="settlement-item">
                <div style="flex: 1; min-width: 180px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <strong>${escapeHTML(member.name)}</strong>
                        ${statusBadge}
                    </div>
                    <p style="margin-top: 4px; font-size: 11.5px; color: var(--text-muted);">
                        Paid: <strong>${formatMoney(totalPaid)}</strong> &bull; Fair share: <strong>${formatMoney(totalShare)}</strong>
                    </p>
                </div>

                <div style="text-align: right;">
                    <span class="settlement-amount" style="color: ${amountColor};">
                        ${balance > 0 ? "+" : ""}${formatMoney(balance)}
                    </span>
                    <small style="display: block; font-size: 11px; color: var(--text-muted);">Net Position</small>
                </div>
            </div>
        `;
    }).join("");
}

// ==========================================
// RENDER SETTLEMENT SUGGESTIONS
// ==========================================

function renderSuggestions(settlements, myMemberId, canRecordNote) {
    if (suggestionCount) suggestionCount.textContent = settlements.length;

    if (settlements.length === 0) {
        suggestionsList.innerHTML = `
            <div class="empty-state" style="padding: 24px; text-align: center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" style="margin-bottom: 8px;">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <strong style="display: block; color: var(--text-main); font-size: 14px;">Group is completely balanced!</strong>
                <span style="color: var(--text-muted); font-size: 12px;">All member expenses and shares are settled. No transfers required.</span>
            </div>
        `;
        return;
    }

    suggestionsList.innerHTML = settlements.map(settlement => {
        const canPay = Number(myMemberId) === Number(settlement.fromId);
        const payControl = canPay
            ? `<button type="button" class="button button-primary btn-paypal-pay"
                        data-from-id="${settlement.fromId}"
                        data-to-id="${settlement.toId}"
                        data-from-name="${escapeHTML(settlement.from)}"
                        data-to-name="${escapeHTML(settlement.to)}"
                        data-amount-cents="${settlement.amountCents}">
                        PayPal Sandbox
                    </button>`
            : `<span class="section-subtitle">Waiting for ${escapeHTML(settlement.from)} to pay</span>`;
        const noteControl = canRecordNote
            ? `<button type="button" class="button button-soft btn-record-note"
                        data-from-id="${settlement.fromId}"
                        data-to-id="${settlement.toId}"
                        data-from-name="${escapeHTML(settlement.from)}"
                        data-to-name="${escapeHTML(settlement.to)}"
                        data-amount-cents="${settlement.amountCents}"
                        title="Record an unpaid note. This does not move money.">
                        Record Note
                    </button>`
            : "";

        return `
            <div class="settlement-item settlement-transfer">
                <div class="settlement-party">
                    <small>Pays</small>
                    <strong>${escapeHTML(settlement.from)}</strong>
                </div>
                <span class="settlement-arrow" aria-hidden="true">→</span>
                <div class="settlement-party">
                    <small>Receives</small>
                    <strong>${escapeHTML(settlement.to)}</strong>
                </div>
                <strong class="settlement-amount">${formatMoney(settlement.amountCents)}</strong>
                <div class="settlement-actions">
                    ${payControl}
                    ${noteControl}
                </div>
            </div>
        `;
    }).join("");

    attachSuggestionListeners();
}

// ==========================================
// SETTLEMENT ACTION HANDLERS
// ==========================================

let paypalSdkPromise = null;

function loadPaypalSdk(clientId) {
    if (window.paypal?.Buttons) {
        return Promise.resolve();
    }

    if (!clientId) {
        return Promise.reject(new Error("PayPal Sandbox is not configured."));
    }

    if (paypalSdkPromise) {
        return paypalSdkPromise;
    }

    paypalSdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
        script.onload = () => {
            if (window.paypal?.Buttons) {
                resolve();
                return;
            }

            reject(new Error("PayPal Sandbox checkout did not load."));
        };
        script.onerror = () => {
            paypalSdkPromise = null;
            reject(new Error("Could not load the PayPal Sandbox checkout."));
        };
        document.head.appendChild(script);
    });

    return paypalSdkPromise;
}

function setCheckoutStatus(statusElement, message, state) {
    statusElement.textContent = message;
    statusElement.className = `paypal-checkout-status is-${state}`;
}

async function openPaypalCheckout(button) {
    const fromId = Number(button.dataset.fromId);
    const toId = Number(button.dataset.toId);
    const fromName = button.dataset.fromName;
    const toName = button.dataset.toName;
    const groupId = Number(groupSelect.value);
    const card = button.closest(".settlement-item");

    if (!card) return;

    let checkout = card.querySelector(".paypal-checkout");

    if (!checkout) {
        checkout = document.createElement("div");
        checkout.className = "paypal-checkout";
        checkout.innerHTML = `
            <p class="paypal-checkout-summary"></p>
            <p class="paypal-checkout-status" role="status"></p>
            <div class="paypal-button-slot"></div>
        `;
        card.appendChild(checkout);
    }

    const summary = checkout.querySelector(".paypal-checkout-summary");
    const statusElement = checkout.querySelector(".paypal-checkout-status");
    const slot = checkout.querySelector(".paypal-button-slot");

    summary.textContent =
        `${fromName} pays ${formatMoney(Number(button.dataset.amountCents))} to ${toName}. ` +
        "The settlement stays unpaid until PayPal Sandbox confirms the capture.";
    setCheckoutStatus(statusElement, "Waiting for Sandbox approval.", "pending");
    checkout.hidden = false;

    if (slot.dataset.ready === "true") {
        return;
    }

    slot.dataset.ready = "true";
    button.disabled = true;

    try {
        await loadPaypalSdk(paypalConfig.clientId);

        await window.paypal.Buttons({
            style: {
                layout: "horizontal",
                color: "gold",
                shape: "rect",
                label: "paypal",
                height: 36
            },
            createOrder: async () => {
                setCheckoutStatus(statusElement, "Creating the Sandbox order...", "pending");

                const orderData = await settlementRequest(
                    `/api/groups/${groupId}/paypal/orders`,
                    {
                        method: "POST",
                        body: JSON.stringify({ fromId, toId })
                    }
                );

                summary.textContent =
                    `${orderData.payer || fromName} pays ${formatMoney(orderData.amountCents)} ` +
                    `to ${orderData.payee || toName}. Approve it in the PayPal Sandbox window.`;

                if (orderData.next === "capture") {
                    const captureData = await settlementRequest(
                        `/api/groups/${groupId}/paypal/orders/${encodeURIComponent(orderData.orderId)}/capture`,
                        { method: "POST" }
                    );
                    setCheckoutStatus(
                        statusElement,
                        captureData.message || "PayPal Sandbox capture verified.",
                        "success"
                    );
                    await loadSettlementData(groupId);
                    throw new Error("CAPTURED");
                }

                setCheckoutStatus(
                    statusElement,
                    "Sandbox order created. Approve the payment to continue.",
                    "pending"
                );

                return orderData.orderId;
            },
            onApprove: async (data, actions) => {
                setCheckoutStatus(
                    statusElement,
                    "Approval received. Confirming the capture with SplitSmart...",
                    "pending"
                );

                try {
                    const captureData = await settlementRequest(
                        `/api/groups/${groupId}/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
                        { method: "POST" }
                    );

                    setCheckoutStatus(
                        statusElement,
                        captureData.message || "PayPal Sandbox capture verified.",
                        "success"
                    );
                    await loadSettlementData(groupId);
                } catch (error) {
                    const message = error.message ||
                        "Capture failed. The settlement is still unpaid.";

                    if (error.needsApproval) {
                        setCheckoutStatus(statusElement, message, "pending");

                        if (typeof actions?.restart === "function") {
                            return actions.restart();
                        }

                        slot.dataset.ready = "false";
                        slot.replaceChildren();
                        button.disabled = false;
                        return;
                    }

                    setCheckoutStatus(statusElement, message, "failed");
                }
            },
            onCancel: () => {
                setCheckoutStatus(
                    statusElement,
                    "Sandbox approval was cancelled. This settlement is still unpaid.",
                    "failed"
                );
            },
            onError: (error) => {
                if (String(error?.message || error || "").includes("CAPTURED")) {
                    return;
                }

                setCheckoutStatus(
                    statusElement,
                    "PayPal Sandbox could not complete this payment. The settlement is still unpaid.",
                    "failed"
                );
            }
        }).render(slot);
    } catch (error) {
        slot.dataset.ready = "false";
        button.disabled = false;
        setCheckoutStatus(
            statusElement,
            error.message || "Could not open PayPal Sandbox.",
            "failed"
        );
    }
}

function attachSuggestionListeners() {
    document.querySelectorAll(".btn-paypal-pay").forEach(button => {
        button.addEventListener("click", async () => {
            const fromId = Number(button.dataset.fromId);
            const toId = Number(button.dataset.toId);
            const fromName = button.dataset.fromName;
            const toName = button.dataset.toName;
            const amountCents = Number(button.dataset.amountCents);
            const groupId = Number(groupSelect.value);

            if (!paypalConfig.enabled) {
                const proceed = confirm(
                    `PayPal Sandbox is not configured.\n\n` +
                    `Would you like to record this payment (${formatMoney(amountCents)} from ${fromName} to ${toName}) as an offline settlement note instead?`
                );

                if (proceed) {
                    await recordOfflineNote(groupId, fromId, toId, amountCents, fromName, toName);
                }
                return;
            }

            try {
                await openPaypalCheckout(button);
            } catch (error) {
                console.error("PayPal checkout error:", error);
                if (statusElement) {
                    statusElement.textContent = error.message || "Could not open PayPal Sandbox.";
                }
            }
        });
    });

    // Record Offline Note Button
    document.querySelectorAll(".btn-record-note").forEach(button => {
        button.addEventListener("click", async () => {
            const fromId = Number(button.dataset.fromId);
            const toId = Number(button.dataset.toId);
            const fromName = button.dataset.fromName;
            const toName = button.dataset.toName;
            const amountCents = Number(button.dataset.amountCents);
            const groupId = Number(groupSelect.value);

            const confirmNote = confirm(
                `Record an offline payment note?\n\n` +
                `Payer: ${fromName}\n` +
                `Payee: ${toName}\n` +
                `Amount: ${formatMoney(amountCents)}\n\n` +
                `Note: This will be recorded in the audit trail without processing PayPal.`
            );

            if (!confirmNote) return;

            await recordOfflineNote(groupId, fromId, toId, amountCents, fromName, toName);
        });
    });
}

async function recordOfflineNote(groupId, fromId, toId, amountCents, fromName, toName) {
    try {
        if (statusElement) statusElement.textContent = "Recording settlement note...";

        const data = await settlementRequest(`/api/groups/${groupId}/settlements/record`, {
            method: "POST",
            body: JSON.stringify({ fromId, toId, amountCents })
        });

        alert(data.message || `Unpaid note saved for ${fromName} and ${toName}. Balances are unchanged.`);
        await loadSettlementData(groupId);

    } catch (error) {
        console.error("Record settlement error:", error);
        alert(`Could not record settlement note: ${error.message}`);
        if (statusElement) statusElement.textContent = "Failed to record note.";
    }
}

// ==========================================
// RENDER SETTLEMENT HISTORY
// ==========================================

let settlementHistoryGrid = null;

function renderHistory(history) {
    const rows = (history || []).map(record => ({
        from: record.from,
        to: record.to,
        amountCents: Number(record.amountCents) || 0,
        status: String(record.status || "").toLowerCase() === "paid" ? "PayPal verified" : "Unpaid note",
        createdAt: record.createdAt || ""
    }));

    if (window.ssGrid && window.ssGrid.communityReady() && historyList) {
        if (!settlementHistoryGrid) {
            settlementHistoryGrid = window.ssGrid.createGrid(historyList, {
                overlayNoRowsTemplate: '<span style="padding:12px;">No settlement transactions recorded for this group yet.</span>',
                columnDefs: [
                    { field: "from", headerName: "Pays", flex: 1 },
                    { field: "to", headerName: "Receives", flex: 1 },
                    {
                        field: "amountCents",
                        headerName: "Amount",
                        flex: 1,
                        filter: "agNumberColumnFilter",
                        valueFormatter: params => formatMoney(params.value)
                    },
                    { field: "status", headerName: "Status", flex: 1 },
                    {
                        field: "createdAt",
                        headerName: "Date",
                        flex: 1,
                        valueFormatter: params => window.ssGrid.formatDate(params.value)
                    }
                ]
            });
        }
        window.ssGrid.setRows(settlementHistoryGrid, rows);
        return;
    }

    if (!historyList) return;
    historyList.textContent = rows.length
        ? `${rows.length} settlement record(s)`
        : "No settlement transactions recorded for this group yet.";
}

// ==========================================
// EVENT LISTENERS & INITIALIZATION
// ==========================================

groupSelect.addEventListener("change", () => {
    loadSettlementData(groupSelect.value);
});

if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
        loadSettlementData(groupSelect.value);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await checkPaypalConfig();
    await loadSettlementGroups();
});
