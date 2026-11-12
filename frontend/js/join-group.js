(function initJoinGroup() {
    const form = document.getElementById("joinLookupForm");
    const result = document.getElementById("joinLookupResult");
    const lists = document.getElementById("joinRequestLists");
    if (!form || !result || !lists) return;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    async function api(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.message || "Could not update the join request.");
        }
        return data;
    }

    function showMessage(text) {
        result.replaceChildren(el("p", "join-member-note", text));
    }

    async function loadRequests() {
        const [mine, incoming] = await Promise.all([
            api("/api/groups/member-claims/mine"),
            api("/api/groups/member-claims/incoming")
        ]);

        lists.replaceChildren();

        if (incoming.claims.length) {
            const section = el("section", "join-request-list");
            section.appendChild(el("h4", "", "Join requests to approve"));
            incoming.claims.forEach(claim => {
                const row = el("div", "join-request-row");
                row.appendChild(el(
                    "p",
                    "",
                    `${claim.requesterUsername} wants to be ${claim.memberName} in ${claim.groupName}.`
                ));
                const actions = el("div", "join-request-actions");
                const approve = el("button", "button button-primary", "Approve");
                approve.type = "button";
                approve.addEventListener("click", () => decide(claim, "approve"));
                const decline = el("button", "debt-button debt-button-quiet", "Decline");
                decline.type = "button";
                decline.addEventListener("click", () => decide(claim, "decline"));
                actions.append(approve, decline);
                row.appendChild(actions);
                section.appendChild(row);
            });
            lists.appendChild(section);
        }

        const visibleMine = mine.claims.filter(claim => claim.status !== "cancelled");
        if (visibleMine.length) {
            const section = el("section", "join-request-list");
            section.appendChild(el("h4", "", "Your join requests"));
            visibleMine.forEach(claim => {
                const row = el("div", "join-request-row");
                row.appendChild(el(
                    "p",
                    "",
                    `${claim.memberName} in ${claim.groupName}: ${claim.status}.`
                ));
                if (claim.status === "pending") {
                    const cancel = el("button", "debt-button debt-button-quiet", "Cancel request");
                    cancel.type = "button";
                    cancel.addEventListener("click", async () => {
                        await api(`/api/groups/member-claims/${claim.id}/cancel`, { method: "POST" });
                        await loadRequests();
                    });
                    row.appendChild(cancel);
                }
                section.appendChild(row);
            });
            lists.appendChild(section);
        }
    }

    async function decide(claim, decision) {
        try {
            await api(
                `/api/groups/${claim.groupId}/member-claims/${claim.id}/${decision}`,
                { method: "POST" }
            );
            await loadRequests();
            if (decision === "approve" && typeof loadGroups === "function") {
                loadGroups();
            }
        } catch (error) {
            lists.prepend(el("p", "join-member-note", error.message));
        }
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const name = document.getElementById("joinGroupName").value.trim();
        const owner = document.getElementById("joinOwnerName").value.trim();
        showMessage("Looking up the group...");

        try {
            const params = new URLSearchParams({ name, owner });
            const data = await api(`/api/groups/join-lookup?${params}`);
            const group = data.group;
            result.replaceChildren();

            if (group.isOwner) {
                result.appendChild(el(
                    "p",
                    "join-member-note",
                    "You own this group. Open the group card and use Select your identity."
                ));
                return;
            }

            const picker = el("div", "join-member-picker");
            picker.appendChild(el("h4", "", `${group.name} members`));
            const select = el("select");
            select.appendChild(el("option", "", "Select your existing member name"));
            group.members.forEach(member => {
                const option = el(
                    "option",
                    "",
                    member.available ? member.name : `${member.name} (already linked or requested)`
                );
                option.value = String(member.id);
                option.disabled = !member.available;
                select.appendChild(option);
            });
            const button = el("button", "button button-primary", "Request to claim");
            button.type = "button";
            const note = el("p", "join-member-note");
            button.addEventListener("click", async () => {
                if (!select.value) {
                    note.textContent = "Select the member name that is you.";
                    return;
                }
                button.disabled = true;
                try {
                    const response = await api(`/api/groups/${group.id}/member-claims`, {
                        method: "POST",
                        body: JSON.stringify({ memberId: Number(select.value) })
                    });
                    note.textContent = response.message;
                    await loadRequests();
                } catch (error) {
                    note.textContent = error.message;
                    button.disabled = false;
                }
            });
            picker.append(select, button, note);
            result.appendChild(picker);
        } catch (error) {
            showMessage(error.message);
        }
    });

    loadRequests().catch(error => {
        lists.replaceChildren(el("p", "join-member-note", error.message));
    });
}());
