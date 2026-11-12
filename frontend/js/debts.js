(function initPersonalDebts() {
    const host = document.getElementById("personalDebtHost");
    if (!host) return;

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

    function statusLabel(status) {
        if (status === "paid") return "Paid";
        if (status === "cancelled") return "Cancelled";
        if (status === "pending" || status === "open") return "Pending";
        return "Pending";
    }

    function pill(status) {
        const kind = status === "paid" ? "paid" : status === "cancelled" ? "cancelled" : "open";
        return el("span", `debt-pill ${kind}`, statusLabel(status));
    }

    function challanLink(reference, label) {
        const link = el("a", "debt-link", label);
        link.href = `challan.html?ref=${encodeURIComponent(reference)}`;
        return link;
    }

    async function api(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            ...options
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.success === false) {
            throw new Error(data.message || "Could not update payment requests.");
        }

        return data;
    }

    function personRow(item, kind) {
        const row = el("article", "money-row");
        const request = item.request;
        const status = request ? request.status : "pending";

        const name = el("div", "money-name");
        name.appendChild(el("strong", "", item.memberName));
        if (kind === "receivable" && request && request.delivery === "undeliverable" && (status === "open" || status === "pending")) {
            name.appendChild(el("small", "", "No linked account yet"));
        }

        const actions = el("div", "money-action");
        if (request && request.status === "paid" && request.captureId) {
            actions.appendChild(challanLink(request.reference, "View receipt"));
        } else if (request && (request.status === "open" || request.status === "pending")) {
            actions.appendChild(challanLink(request.reference, "View payment request"));
        }

        if (kind === "receivable" && (!request || (request.status !== "open" && request.status !== "pending"))) {
            const create = el("button", "debt-button", "Request payment");
            create.type = "button";
            create.addEventListener("click", () => createChallan(item));
            actions.appendChild(create);
        }

        if (kind === "receivable" && request && (request.status === "open" || request.status === "pending")) {
            const cancel = el("button", "debt-button debt-button-quiet", "Cancel");
            cancel.type = "button";
            cancel.addEventListener("click", () => cancelChallan(request.reference));
            actions.appendChild(cancel);
        }

        row.append(
            name,
            el("span", "money-group", item.groupName),
            el("span", "money-amount", money(item.amountCents)),
            pill(status),
            actions
        );
        return row;
    }

    function peopleSection(title, items, kind, emptyText) {
        const section = el("section", "money-people");
        section.appendChild(el("h3", "", title));

        if (!items.length) {
            section.appendChild(el("p", "money-empty", emptyText));
            return section;
        }

        const head = el("div", "money-row money-head");
        ["Name", "Group", "Amount", "Status", ""].forEach(label => {
            head.appendChild(el("span", "", label));
        });
        section.appendChild(head);
        items.forEach(item => section.appendChild(personRow(item, kind)));
        return section;
    }

    function render(data) {
        host.replaceChildren();
        const position = el("div", "money-position");

        const summary = el("div", "money-summary");
        [
            ["Money owed to you", money(data.totalReceivableCents), "receivable"],
            ["Money you owe", money(data.totalPayableCents), "payable"]
        ].forEach(([label, value, tone]) => {
            const card = el("article", `money-summary-card ${tone}`);
            card.append(el("span", "", label), el("strong", "", value));
            summary.appendChild(card);
        });
        position.appendChild(summary);
        position.appendChild(el(
            "p",
            "money-explain",
            "A payment request asks someone to pay an outstanding amount. A receipt is proof that the payment was verified."
        ));

        if (data.identities.length) {
            const who = data.identities
                .map(item => `${item.memberName} in ${item.groupName}`)
                .join(", ");
            position.appendChild(el("p", "money-note", `Showing balances for ${who}.`));
        }

        data.unlinkedGroups.forEach(group => {
            position.appendChild(el(
                "p",
                "money-note",
                `${group.name} is hidden until your account is linked to a member in that group.`
            ));
        });

        const lists = el("div", "money-lists");
        lists.append(
            peopleSection(
                "People who owe you",
                data.receivables,
                "receivable",
                "Nobody owes you in your linked groups."
            ),
            peopleSection(
                "People you need to pay",
                data.payables,
                "payable",
                "You do not owe anyone in your linked groups."
            )
        );
        position.appendChild(lists);

        const due = data.payables.filter(item =>
            item.request && (item.request.status === "pending" || item.request.status === "open")
        );
        const requests = el("section", "money-people");
        requests.appendChild(el("h3", "", "Payment requests"));
        if (!due.length) {
            requests.appendChild(el("p", "money-empty", "You have no pending payment requests."));
        } else {
            due.forEach(item => {
                const row = el("article", "money-row");
                const name = el("div", "money-name");
                name.appendChild(el("strong", "", item.memberName));
                name.appendChild(el("small", "", "Pay this request"));
                const actions = el("div", "money-action");
                actions.appendChild(challanLink(item.request.reference, "Pay Now"));
                row.append(
                    name,
                    el("span", "money-group", item.groupName),
                    el("span", "money-amount", money(item.amountCents)),
                    pill("pending"),
                    actions
                );
                requests.appendChild(row);
            });
        }
        position.appendChild(requests);

        const receipts = (data.recentlyPaid || []).filter(item => item.reference && item.captureId);
        if (receipts.length) {
            const paid = el("section", "money-people");
            paid.appendChild(el("h3", "", "Receipts"));
            receipts.forEach(item => {
                const row = el("article", "money-row");
                const name = el("div", "money-name");
                name.appendChild(el("strong", "", item.direction === "received" ? item.payerName : item.payeeName));
                const actions = el("div", "money-action");
                actions.appendChild(challanLink(item.reference, "View receipt"));
                row.append(
                    name,
                    el("span", "money-group", item.groupName),
                    el("span", "money-amount", money(item.amountCents)),
                    pill("paid"),
                    actions
                );
                paid.appendChild(row);
            });
            position.appendChild(paid);
        }

        const alerts = (data.notifications || []).filter(item =>
            item.status === "unread" || item.status === "read" || item.status === "paid"
        );
        if (alerts.length) {
            const notes = el("section", "money-people");
            notes.appendChild(el("h3", "", "Payment updates"));
            alerts.forEach(item => {
                const row = el("article", "money-row");
                const name = el("div", "money-name");
                name.appendChild(el("strong", "", item.message || (
                    item.role === "debtor" ? item.payeeName : item.payerName
                )));
                const actions = el("div", "money-action");
                actions.appendChild(challanLink(
                    item.reference,
                    item.status === "paid"
                        ? "View receipt"
                        : item.role === "debtor"
                            ? "Pay Now"
                            : "View payment request"
                ));
                row.append(
                    name,
                    el("span", "money-group", item.groupName),
                    el("span", "money-amount", money(item.amountCents)),
                    pill(item.status === "paid" ? "paid" : "pending"),
                    actions
                );
                notes.appendChild(row);
            });
            position.appendChild(notes);
        }

        host.appendChild(position);
    }

    async function load() {
        const data = await api("/api/me/payment-requests/generate", { method: "POST" });
        render(data);
    }

    async function createChallan(item) {
        try {
            await api("/api/me/payment-requests", {
                method: "POST",
                body: JSON.stringify({
                    groupId: item.groupId,
                    fromMemberId: item.memberId
                })
            });
            await load();
        } catch (error) {
            host.prepend(el("p", "debt-empty", error.message));
        }
    }

    async function cancelChallan(reference) {
        try {
            await api(`/api/payment-requests/${encodeURIComponent(reference)}/cancel`, {
                method: "POST"
            });
            render(await api("/api/me/debts"));
        } catch (error) {
            host.prepend(el("p", "debt-empty", error.message));
        }
    }

    load().catch(error => {
        host.replaceChildren(el("p", "debt-empty", error.message));
    });
}());
