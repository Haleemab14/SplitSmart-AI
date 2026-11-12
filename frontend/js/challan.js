(function initChallan() {
    const host = document.getElementById("challanHost");
    const heading = document.getElementById("challanHeading");
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("ref") || "";
    let paypalSdkPromise = null;

    function money(cents) {
        return (Number(cents) / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD"
        });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function formatDate(value) {
        if (!value) return "Not available";
        const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function detailRow(label, value) {
        const row = el("tr");
        row.append(el("th", "", label), el("td", "", value));
        return row;
    }

    function showMessage(text) {
        host.replaceChildren(el("p", "debt-empty", text));
    }

    async function api(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            const error = new Error(data.message || "Could not open this payment request.");
            error.needsApproval = Boolean(data.needsApproval);
            throw error;
        }
        return data;
    }

    function loadPaypalSdk(clientId) {
        if (window.paypal?.Buttons) return Promise.resolve();
        if (!paypalSdkPromise) {
            paypalSdkPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
                script.onload = () => window.paypal?.Buttons
                    ? resolve()
                    : reject(new Error("PayPal Sandbox checkout did not load."));
                script.onerror = () => {
                    paypalSdkPromise = null;
                    reject(new Error("Could not load PayPal Sandbox."));
                };
                document.head.appendChild(script);
            });
        }
        return paypalSdkPromise;
    }

    async function renderPaypal(view, slot, status) {
        const config = await api("/api/paypal/config");
        if (!config.enabled || !config.clientId) {
            status.textContent = "PayPal Sandbox is not configured. This request remains unpaid.";
            return;
        }

        await loadPaypalSdk(config.clientId);
        await window.paypal.Buttons({
            style: { layout: "horizontal", color: "gold", shape: "rect", label: "paypal", height: 36 },
            createOrder: async () => {
                status.textContent = "Creating the Sandbox order from the ledger amount...";
                const order = await api(`/api/groups/${view.group.id}/paypal/orders`, {
                    method: "POST",
                    body: JSON.stringify({
                        fromId: view.payer.memberId,
                        toId: view.recipient.memberId
                    })
                });

                if (order.next === "capture") {
                    const capture = await api(
                        `/api/groups/${view.group.id}/paypal/orders/${encodeURIComponent(order.orderId)}/capture`,
                        { method: "POST" }
                    );
                    status.textContent = capture.message || "PayPal Sandbox capture verified.";
                    await load();
                    throw new Error("CAPTURED");
                }

                status.textContent = `${order.payer} pays ${money(order.amountCents)} to ${order.payee}. Approve it in PayPal Sandbox.`;
                return order.orderId;
            },
            onApprove: async (data) => {
                status.textContent = "Checking the PayPal capture before anything is marked paid...";
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    try {
                        const capture = await api(
                            `/api/groups/${view.group.id}/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
                            { method: "POST" }
                        );
                        status.textContent = capture.message || "PayPal Sandbox capture verified.";
                        await load();
                        return;
                    } catch (error) {
                        if (error.needsApproval && attempt < 3) {
                            status.textContent = "PayPal is still confirming approval. The request stays unpaid until capture is verified.";
                            await new Promise(resolve => setTimeout(resolve, 800));
                            continue;
                        }
                        status.textContent = error.message;
                        return;
                    }
                }
            },
            onCancel: () => {
                status.textContent = "Sandbox approval was cancelled. This request is still unpaid.";
            },
            onError: (error) => {
                if (String(error?.message || error || "").includes("CAPTURED")) {
                    return;
                }
                status.textContent = "PayPal Sandbox did not complete the payment. This request is still unpaid.";
            }
        }).render(slot);
    }

    function render(view) {
        const paid = view.status === "paid";
        const cancelled = view.status === "cancelled";
        const pending = view.status === "pending" || view.status === "open";
        const amountCents = paid ? view.paidAmountCents : view.outstandingCents;
        const currency = view.currency || "USD";
        heading.textContent = paid ? "Payment receipt" : "Payment request";

        const sheet = el("article", "challan-sheet");
        const banner = el("header", "challan-banner");
        const brand = el("div", "challan-brand");
        brand.append(
            el("span", "brand-fish", "SS"),
            el("strong", "", "SplitSmart AI")
        );
        const title = el("div", "challan-title");
        title.appendChild(el("h2", "", paid ? "PAYMENT RECEIPT" : "PAYMENT REQUEST"));
        title.appendChild(el(
            "span",
            `challan-stamp ${paid ? "paid" : cancelled ? "cancelled" : "unpaid"}`,
            paid ? "PAID" : cancelled ? "CANCELLED" : "PENDING"
        ));
        banner.append(brand, title);

        const amount = el("div", "challan-amount");
        amount.append(
            el("span", "", paid ? "Amount paid" : "Amount due"),
            el("strong", "", money(amountCents)),
            el("em", "", currency)
        );

        const table = el("table", "challan-table");
        const body = el("tbody");
        body.append(
            detailRow(paid ? "Receipt number" : "Payment reference", paid ? (view.receiptNumber || view.reference) : view.reference),
            detailRow("Challan number", view.reference),
            detailRow("Date generated", formatDate(view.createdAt)),
            detailRow("Payer", view.payer.name),
            detailRow("Recipient", view.recipient.name),
            detailRow("Group", view.group.name),
            detailRow("Amount", `${money(amountCents)} ${currency}`),
            detailRow("Currency", currency),
            detailRow("Payment status", paid ? "PAID" : cancelled ? "CANCELLED" : "PENDING")
        );
        if (paid) {
            body.append(
                detailRow("Date paid", formatDate(view.paidAt)),
                detailRow("PayPal capture", view.captureId || "Unavailable")
            );
        }
        table.appendChild(body);

        const footer = el("footer", "challan-footer");
        if (paid) {
            footer.append(
                el("p", "", "This receipt is proof of a verified payment. It is not an unpaid payment request."),
                el("p", "", "The amount, people, and PayPal capture reference come from the verified payment record.")
            );
        } else {
            footer.append(
                el("p", "", "This is a payment request, not proof of payment."),
                el("p", "", "Open this payment request in SplitSmart AI and complete the PayPal Sandbox checkout. It stays unpaid until PayPal verifies the payment.")
            );
        }

        sheet.append(banner, amount, table, footer);

        const screen = el("div", "challan-screen");
        screen.appendChild(sheet);

        if (!paid && view.delivery === "undeliverable") {
            screen.appendChild(el(
                "p",
                "challan-screen-note",
                "This payer has no linked SplitSmart account, so the request cannot be delivered yet."
            ));
        }

        if (!paid && !cancelled && pending && view.outstandingCents === 0) {
            screen.appendChild(el(
                "p",
                "challan-screen-note",
                "This amount is no longer outstanding, so PayPal checkout is unavailable."
            ));
        }

        const actions = el("div", "challan-actions");
        const print = el("button", "debt-button", "Print");
        print.type = "button";
        print.addEventListener("click", () => window.print());
        const download = el("button", "debt-button", "Download");
        download.type = "button";
        download.addEventListener("click", () => window.print());
        actions.append(print, download);

        if (view.canPay) {
            const pay = el("div", "paypal-checkout");
            const status = el("p", "paypal-checkout-status", "PayPal Sandbox collects the amount due. Printing does not mark this request paid.");
            const slot = el("div", "paypal-button-slot");
            pay.append(status, slot);
            actions.appendChild(pay);
            renderPaypal(view, slot, status).catch(error => {
                status.textContent = error.message;
            });
        }

        screen.appendChild(actions);
        host.replaceChildren(screen);
    }

    async function load() {
        if (!reference) {
            showMessage("This payment request link is missing a reference.");
            return;
        }

        const view = await api(`/api/payment-requests/${encodeURIComponent(reference)}/read`, {
            method: "POST"
        });
        render(view);
    }

    load().catch(error => showMessage(error.message));
}());
