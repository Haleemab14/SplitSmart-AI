
// ==========================================
// SPLITSMART — GROUP SPENDING INTELLIGENCE
// ==========================================

const analyticsGroupSelect =
    document.getElementById("analyticsGroupSelect");

const finnyGroupSelect =
    document.getElementById("groupSelect");

const insightTotalSpent =
    document.getElementById("insightTotalSpent");

const insightExpenseCount =
    document.getElementById("insightExpenseCount");

const insightTopCategory =
    document.getElementById("insightTopCategory");

const categoryBreakdown =
    document.getElementById("categoryBreakdown");

const monthlySpending =
    document.getElementById("monthlySpending");

const smartInsights =
    document.getElementById("smartInsights");

const insightStatus =
    document.getElementById("insightStatus");

let analyticsData = null;
let expenseGridApi = null;

let categoryChart = null;
let monthlyChart = null;

let analyticsRequestNumber = 0;


// ==========================================
// FORMAT MONEY
// ==========================================

function analyticsMoney(cents) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format((Number(cents) || 0) / 100);
}


// ==========================================
// CHART CLEANUP
// ==========================================

function destroyCharts() {
    if (categoryChart) {
        categoryChart.destroy();
        categoryChart = null;
    }

    if (monthlyChart) {
        monthlyChart.destroy();
        monthlyChart = null;
    }
}


// ==========================================
// AG GRID — EXPENSE EXPLORER
// ==========================================

function initializeExpenseGrid(expenses = []) {

    const gridElement =
        document.getElementById("expenseGrid");

    const searchInput =
        document.getElementById("expenseGridSearch");

    const gridStatus =
        document.getElementById("expenseGridStatus");

    if (!gridElement) return;

    if (
        !window.agGrid ||
        typeof window.agGrid.createGrid !== "function"
    ) {
        if (gridStatus) {
            gridStatus.textContent =
                "AG Grid could not load. Check your internet connection.";
        }

        return;
    }

    const rowData = (expenses || []).map(expense => ({
        id: expense.id,
        description: expense.description || "Unnamed expense",
        amount_cents: Number(expense.amount_cents || 0),
        created_at: expense.created_at || ""
    }));

    const columnDefs = [
        {
            field: "id",
            headerName: "ID",
            maxWidth: 100,
            filter: "agNumberColumnFilter"
        },
        {
            field: "description",
            headerName: "Description",
            flex: 2,
            minWidth: 180,
            filter: "agTextColumnFilter"
        },
        {
            field: "amount_cents",
            headerName: "Amount",
            flex: 1,
            minWidth: 130,
            filter: "agNumberColumnFilter",
            valueFormatter: params =>
                analyticsMoney(params.value)
        },
        {
            field: "created_at",
            headerName: "Date",
            flex: 1,
            minWidth: 150,

            valueFormatter: params => {
                if (!params.value) {
                    return "Date unavailable";
                }

                const date = new Date(params.value);

                return Number.isNaN(date.getTime())
                    ? String(params.value)
                    : date.toLocaleDateString();
            }
        }
    ];

    if (!expenseGridApi) {

        expenseGridApi = window.ssGrid && window.ssGrid.createGrid
            ? window.ssGrid.createGrid(gridElement, {
                columnDefs,
                rowData,
                overlayNoRowsTemplate:
                    '<span style="padding: 12px;">No expenses recorded for this group yet.</span>'
            })
            : window.agGrid.createGrid(gridElement, {
                columnDefs,
                rowData,
                theme: "legacy",
                defaultColDef: {
                    sortable: true,
                    filter: true,
                    resizable: true,
                    floatingFilter: true
                },
                pagination: true,
                paginationPageSize: 10,
                paginationPageSizeSelector: [10, 20, 50],
                overlayNoRowsTemplate:
                    '<span style="padding: 12px;">No expenses recorded for this group yet.</span>'
            });

        if (searchInput) {
            searchInput.addEventListener("input", () => {

                if (expenseGridApi) {
                    expenseGridApi.setGridOption(
                        "quickFilterText",
                        searchInput.value
                    );
                }

            });
        }

    } else {

        expenseGridApi.setGridOption(
            "rowData",
            rowData
        );

    }

    if (gridStatus) {
        gridStatus.textContent =
            `${rowData.length} expense(s) loaded`;
    }
}


// ==========================================
// LOAD ANALYTICS
// ==========================================

async function loadSpendingAnalytics() {
    const groupId =
        analyticsGroupSelect?.value ||
        finnyGroupSelect?.value ||
        "";

    if (!groupId) {
        analyticsData = null;

        showEmptyAnalytics(
            "Please select a group to see its analytics."
        );

        return;
    }

    const requestNumber = ++analyticsRequestNumber;

    if (insightStatus) {
        insightStatus.textContent =
            "Loading spending analytics...";
    }

    try {

        const response = await fetch(
            `/api/groups/${encodeURIComponent(groupId)}/analytics`
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "Could not load analytics."
            );
        }

        // Ignore an older response if the user switched groups.
        if (
            requestNumber !== analyticsRequestNumber ||
            (analyticsGroupSelect?.value || finnyGroupSelect?.value) !== groupId
        ) {
            return;
        }

        analyticsData = data;

        renderAnalytics(data);

        if (insightStatus) {
            insightStatus.textContent = "";
        }

    } catch (error) {

        if (requestNumber !== analyticsRequestNumber) {
            return;
        }

        console.error("Analytics error:", error);

        if (insightStatus) {
            insightStatus.textContent = error.message;
        }

        showEmptyAnalytics(
            "Analytics could not be loaded. Please try again."
        );
    }
}


// ==========================================
// EMPTY STATE
// ==========================================

function showEmptyAnalytics(message) {

    destroyCharts();

    if (insightTotalSpent) {
        insightTotalSpent.textContent = analyticsMoney(0);
    }

    if (insightExpenseCount) {
        insightExpenseCount.textContent = "0";
    }

    if (insightTopCategory) {
        insightTopCategory.textContent = "--";
    }

    if (categoryBreakdown) {
        categoryBreakdown.replaceChildren();

        const messageElement =
            document.createElement("p");

        messageElement.textContent = message;

        categoryBreakdown.appendChild(messageElement);
    }

    if (monthlySpending) {
        monthlySpending.replaceChildren();

        const messageElement =
            document.createElement("p");

        messageElement.textContent =
            "No monthly data available yet.";

        monthlySpending.appendChild(messageElement);
    }

    if (smartInsights) {
        smartInsights.replaceChildren();

        const messageElement =
            document.createElement("p");

        messageElement.textContent =
            "Add expenses to discover spending patterns.";

        smartInsights.appendChild(messageElement);
    }

    initializeExpenseGrid([]);
}


// ==========================================
// RENDER ALL ANALYTICS
// ==========================================

function renderAnalytics(data) {

    const categories = Array.isArray(data.categories)
        ? data.categories
        : [];

    const months = Array.isArray(data.monthly)
        ? data.monthly
        : [];

    if (insightTotalSpent) {
        insightTotalSpent.textContent =
            analyticsMoney(data.totalSpentCents);
    }

    if (insightExpenseCount) {
        insightExpenseCount.textContent =
            data.expenseCount || 0;
    }

    const topCategory = categories[0];

    if (insightTopCategory) {
        insightTopCategory.textContent =
            topCategory ? topCategory.name : "--";
    }

    renderCategoryChart(categories);

    renderMonthlyChart(months);

    renderSmartInsights(data);

    initializeExpenseGrid(data.expenses || []);
}


// ==========================================
// CATEGORY DOUGHNUT CHART
// ==========================================

function renderCategoryChart(categories) {

    if (!categoryBreakdown) return;

    if (categoryChart) {
        categoryChart.destroy();
        categoryChart = null;
    }

    categoryBreakdown.replaceChildren();

    if (!categories.length) {

        const message = document.createElement("p");

        message.textContent =
            "No category data available yet.";

        categoryBreakdown.appendChild(message);

        return;
    }

    if (!window.Chart) {

        const message = document.createElement("p");

        message.textContent =
            "Chart.js could not load. Check your internet connection.";

        categoryBreakdown.appendChild(message);

        return;
    }

    const canvas = document.createElement("canvas");

    canvas.setAttribute(
        "aria-label",
        "Group spending by category"
    );

    categoryBreakdown.style.height = "280px";
    categoryBreakdown.appendChild(canvas);

    const chartColors = [
        "#2583d8",
        "#42b8d5",
        "#68d6d0",
        "#8b9de8",
        "#67a7ed",
        "#a3dce9",
        "#6b8fc7",
        "#b2c9e8"
    ];

    categoryChart = new Chart(canvas, {

        type: "doughnut",

        data: {
            labels: categories.map(item => item.name),

            datasets: [{
                data: categories.map(
                    item => Number(item.totalCents) || 0
                ),

                backgroundColor: chartColors,

                borderColor: "#ffffff",

                borderWidth: 3,

                hoverOffset: 8
            }]
        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            cutout: "68%",

            plugins: {

                legend: {
                    position: "bottom",

                    labels: {
                        usePointStyle: true,
                        pointStyle: "circle",
                        padding: 16
                    }
                },

                tooltip: {
                    callbacks: {
                        label: context => {
                            const value =
                                context.parsed || 0;

                            return `${context.label}: ${analyticsMoney(value)}`;
                        }
                    }
                }
            }
        }
    });

    window.categoryChart = categoryChart;
}


// ==========================================
// MONTHLY SPENDING BAR CHART
// ==========================================

function renderMonthlyChart(months) {

    if (!monthlySpending) return;

    if (monthlyChart) {
        monthlyChart.destroy();
        monthlyChart = null;
    }

    monthlySpending.replaceChildren();

    if (!months.length) {

        const message = document.createElement("p");

        message.textContent =
            "No monthly data available yet.";

        monthlySpending.appendChild(message);

        return;
    }

    if (!window.Chart) {

        const message = document.createElement("p");

        message.textContent =
            "Chart.js could not load. Check your internet connection.";

        monthlySpending.appendChild(message);

        return;
    }

    const canvas = document.createElement("canvas");

    canvas.setAttribute(
        "aria-label",
        "Monthly group spending"
    );

    monthlySpending.style.height = "280px";

    monthlySpending.appendChild(canvas);

    monthlyChart = new Chart(canvas, {

        type: "bar",

        data: {

            labels: months.map(month => month.label),

            datasets: [{

                label: "Monthly spending",

                data: months.map(
                    month => Number(month.totalCents) || 0
                ),

                backgroundColor: "#42b8d5",

                hoverBackgroundColor: "#2583d8",

                borderRadius: 7,

                maxBarThickness: 48
            }]
        },

        options: {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {

                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label: context =>
                            analyticsMoney(context.parsed.y)
                    }
                }
            },

            scales: {

                x: {
                    grid: {
                        display: false
                    }
                },

                y: {

                    beginAtZero: true,

                    ticks: {
                        callback: value =>
                            analyticsMoney(value)
                    }
                }
            }
        }
    });

    window.monthlyChart = monthlyChart;
}


// ==========================================
// FINNY'S SMART INSIGHTS
// ==========================================

function renderSmartInsights(data) {

    if (!smartInsights) return;

    smartInsights.replaceChildren();

    const insights = [];

    const categories = Array.isArray(data.categories)
        ? data.categories
        : [];

    const months = Array.isArray(data.monthly)
        ? data.monthly
        : [];

    if (!data.expenseCount) {

        insights.push(
            "Your group is ready for its first expense."
        );

    } else {

        const topCategory = categories[0];

        if (topCategory) {

            const percentage = data.totalSpentCents > 0
                ? topCategory.totalCents /
                    data.totalSpentCents * 100
                : 0;

            insights.push(
                `${topCategory.name} is your biggest spending category, accounting for ${percentage.toFixed(1)}% of group spending.`
            );
        }

        if (data.biggestExpense) {

            insights.push(
                `Your biggest recorded expense is "${data.biggestExpense.description}" at ${analyticsMoney(data.biggestExpense.amount_cents)}.`
            );
        }

        if (months.length >= 2) {

            const current = months[months.length - 1];

            const previous = months[months.length - 2];

            const difference =
                current.totalCents - previous.totalCents;

            if (difference > 0) {

                insights.push(
                    `Spending increased by ${analyticsMoney(difference)} compared with ${previous.label}.`
                );

            } else if (difference < 0) {

                insights.push(
                    `Spending decreased by ${analyticsMoney(Math.abs(difference))} compared with ${previous.label}.`
                );

            } else {

                insights.push(
                    `Spending stayed the same compared with ${previous.label}.`
                );
            }
        }
    }

    insights.forEach(message => {

        const card = document.createElement("div");

        card.className = "smart-insight-item";

        const icon = document.createElement("span");

        icon.textContent = "✦";

        const text = document.createElement("p");

        text.textContent = message;

        card.append(icon, text);

        smartInsights.appendChild(card);
    });
}


// ==========================================
// GROUP SELECTION
// ==========================================

// Both dropdowns can refresh analytics.
// app.js synchronizes their selected values.

if (analyticsGroupSelect) {

    analyticsGroupSelect.addEventListener(
        "change",
        loadSpendingAnalytics
    );
}

if (finnyGroupSelect) {

    finnyGroupSelect.addEventListener(
        "change",
        loadSpendingAnalytics
    );
}


// ==========================================
// INITIAL LOAD
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    if (analyticsGroupSelect?.value) {
        loadSpendingAnalytics();
    }
});


// ==========================================
// ALLOW OTHER SCRIPTS TO REFRESH ANALYTICS
// ==========================================

window.refreshSpendingAnalytics =
    loadSpendingAnalytics;
