// ==========================================================================
// SPLITSMART AI — RECEIPT SCANNER & ITEM ASSIGNMENT ENGINE
// Complete 12-Step OCR, Correction, Math Verification & Saving Workflow
// ==========================================================================

(function initReceiptEngine() {
    // The expenses page has its own scanner. This engine belongs to receipt.html.
    if (!document.getElementById("receiptMerchant")) {
        return;
    }

    if (!window.SplitSmartOCR) {
        console.error("Receipt OCR helpers did not load.");
        return;
    }

    // Elements
    const receiptInput = document.getElementById("receiptInput");
    const uploadZone = document.getElementById("uploadZone");
    const uploadPrompt = document.getElementById("uploadPrompt");
    const receiptPreviewContainer = document.getElementById("receiptPreviewContainer");
    const receiptPreviewImage = document.getElementById("receiptPreviewImage");
    const scanButton = document.getElementById("scanButton");
    const manualEntryBtn = document.getElementById("manualEntryBtn");
    const ocrProgressBar = document.getElementById("ocrProgressBar");
    const ocrProgressFill = document.getElementById("ocrProgressFill");
    const receiptStatus = document.getElementById("receiptStatus");
    const receiptResult = document.getElementById("receiptResult");

    const receiptMerchant = document.getElementById("receiptMerchant");
    const receiptDate = document.getElementById("receiptDate");
    const receiptTotalInput = document.getElementById("receiptTotalInput");

    const receiptTypeGroup = document.getElementById("receiptTypeGroup");
    const receiptTypePersonal = document.getElementById("receiptTypePersonal");
    const receiptGroupSection = document.getElementById("receiptGroupSection");
    const receiptPersonalSection = document.getElementById("receiptPersonalSection");
    const savePersonalReceiptBtn = document.getElementById("savePersonalReceiptBtn");

    const receiptGroupSelect = document.getElementById("receiptGroupSelect");
    const receiptPayerSelect = document.getElementById("receiptPayerSelect");
    const splitByItems = document.getElementById("splitByItems");
    const splitEqually = document.getElementById("splitEqually");
    const itemizedAssignmentContainer = document.getElementById("itemizedAssignmentContainer");
    const equalSplitContainer = document.getElementById("equalSplitContainer");

    const receiptItemsList = document.getElementById("receiptItemsList");
    const receiptItemsTotal = document.getElementById("receiptItemsTotal");
    const receiptAssignmentStatus = document.getElementById("receiptAssignmentStatus");
    const addReceiptItemBtn = document.getElementById("addReceiptItemBtn");
    const duplicateWarningBox = document.getElementById("duplicateWarningBox");
    const duplicateWarningText = document.getElementById("duplicateWarningText");
    const saveReceiptItemsBtn = document.getElementById("saveReceiptItemsBtn");
    const receiptItemsMessage = document.getElementById("receiptItemsMessage");

    // State
    let availableGroups = [];
    let currentReceiptMembers = [];
    let receiptItems = [];
    let activeExpenseType = "group"; // "group" or "personal"
    let activeSplitMethod = "items"; // "items" or "equal"
    let selectedImageFile = null;

    // Format Money
    function formatMoney(cents) {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD"
        }).format((Number(cents) || 0) / 100);
    }

    function showStatus(message, isError = false) {
        if (!receiptStatus) return;
        receiptStatus.textContent = message;
        receiptStatus.style.color = isError ? "var(--danger, #ef4444)" : "var(--primary, #0284c7)";
    }

    function showItemMessage(message, isError = false) {
        if (!receiptItemsMessage) return;
        receiptItemsMessage.textContent = message;
        receiptItemsMessage.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #10b981)";
    }

    // ==========================================
    // 1. PRICE & OCR TEXT EXTRACTION
    // ==========================================

    const extractReceiptDetails = window.SplitSmartOCR.extractReceiptDetails;
    const extractReceiptItems = window.SplitSmartOCR.extractReceiptItems;

    // ==========================================
    // 2. IMAGE PREVIEW & DRAG-AND-DROP
    // ==========================================

    function handleFileSelection(file) {
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            showStatus("Please select a valid image file (PNG, JPG, WEBP).", true);
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            showStatus("Image file exceeds the 5 MB limit.", true);
            return;
        }

        selectedImageFile = file;
        if (uploadPrompt) {
            uploadPrompt.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        }

        // Show image preview
        const reader = new FileReader();
        reader.onload = (e) => {
            if (receiptPreviewImage && receiptPreviewContainer) {
                receiptPreviewImage.src = e.target.result;
                receiptPreviewContainer.style.display = "block";
            }
        };
        reader.readAsDataURL(file);

        showStatus("Image ready to scan. Click 'Scan Receipt with OCR'.");
    }

    if (receiptInput) {
        receiptInput.addEventListener("change", (e) => {
            handleFileSelection(e.target.files[0]);
        });
    }

    if (uploadZone) {
        uploadZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = "var(--primary)";
            uploadZone.style.backgroundColor = "var(--accent-light)";
        });

        uploadZone.addEventListener("dragleave", () => {
            uploadZone.style.borderColor = "#cbd5e1";
            uploadZone.style.backgroundColor = "var(--bg-subtle)";
        });

        uploadZone.addEventListener("drop", (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = "#cbd5e1";
            uploadZone.style.backgroundColor = "var(--bg-subtle)";
            if (e.dataTransfer?.files?.[0]) {
                handleFileSelection(e.dataTransfer.files[0]);
            }
        });
    }

    // ==========================================
    // 3. TESSERACT OCR SCANNING
    // ==========================================

    if (scanButton) {
        scanButton.addEventListener("click", async () => {
            if (!selectedImageFile) {
                showStatus("Please select or drop a receipt image first.", true);
                return;
            }

            if (typeof Tesseract === "undefined") {
                showStatus("Tesseract.js OCR engine could not be loaded. Please check your network.", true);
                return;
            }

            scanButton.disabled = true;
            if (ocrProgressBar) ocrProgressBar.style.display = "block";
            if (ocrProgressFill) ocrProgressFill.style.width = "5%";
            showStatus("Initializing optical character recognition...");

            try {
                const result = await Tesseract.recognize(
                    selectedImageFile,
                    "eng",
                    {
                        logger: (info) => {
                            if (info.status === "recognizing text") {
                                const progress = Math.round(info.progress * 100);
                                if (ocrProgressFill) ocrProgressFill.style.width = `${progress}%`;
                                showStatus(`Recognizing receipt text: ${progress}%...`);
                            }
                        }
                    }
                );

                const text = result.data.text || "";
                if (ocrProgressFill) ocrProgressFill.style.width = "100%";
                if (receiptResult) receiptResult.textContent = text || "No text recognized.";

                const details = extractReceiptDetails(text);
                const items = extractReceiptItems(text);

                // Populate editable metadata fields
                if (receiptMerchant && details.merchant) {
                    receiptMerchant.value = details.merchant;
                }
                if (receiptDate && details.date) {
                    receiptDate.value = details.date;
                }
                if (receiptTotalInput && details.total !== null) {
                    receiptTotalInput.value = details.total.toFixed(2);
                }

                // If items were extracted, load them into state
                receiptItems = items;
                if (receiptItems.length === 0 && details.total !== null) {
                    receiptItems = [{
                        name: details.merchant || "General Receipt Total",
                        amount: details.total.toFixed(2),
                        memberIds: []
                    }];
                }

                renderReceiptItems();
                updateReceiptSummary();

                const conf = Number(result.data.confidence) || 0;
                showStatus(`OCR scan completed with ${conf}% confidence. Review and correct items below.`);

                // Smooth scroll to the assignment panel
                const panel = document.getElementById("receiptItemsPanel");
                if (panel) {
                    panel.scrollIntoView({ behavior: "smooth", block: "start" });
                }

            } catch (error) {
                console.error("OCR scan error:", error);
                showStatus(`OCR failed: ${error.message}. You can still enter details manually.`, true);
            } finally {
                scanButton.disabled = false;
                setTimeout(() => {
                    if (ocrProgressBar) ocrProgressBar.style.display = "none";
                }, 1000);
            }
        });
    }

    // Manual entry button
    if (manualEntryBtn) {
        manualEntryBtn.addEventListener("click", () => {
            if (receiptMerchant && !receiptMerchant.value) {
                receiptMerchant.value = "New Receipt";
            }
            if (receiptItems.length === 0) {
                receiptItems = [{ name: "Item 1", amount: "0.00", memberIds: [] }];
            }
            renderReceiptItems();
            updateReceiptSummary();
            showStatus("Ready for manual entry. Fill in the details below.");

            const panel = document.getElementById("receiptItemsPanel");
            if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    // ==========================================
    // 4. EXPENSE TYPE & SPLIT METHOD TOGGLES
    // ==========================================

    function setExpenseType(type) {
        activeExpenseType = type;
        if (receiptTypeGroup) receiptTypeGroup.classList.toggle("active", type === "group");
        if (receiptTypePersonal) receiptTypePersonal.classList.toggle("active", type === "personal");

        if (receiptGroupSection) receiptGroupSection.style.display = type === "group" ? "block" : "none";
        if (receiptPersonalSection) receiptPersonalSection.style.display = type === "personal" ? "block" : "none";

        updateReceiptSummary();
    }

    if (receiptTypeGroup) receiptTypeGroup.addEventListener("click", () => setExpenseType("group"));
    if (receiptTypePersonal) receiptTypePersonal.addEventListener("click", () => setExpenseType("personal"));

    function setSplitMethod(method) {
        activeSplitMethod = method;
        if (itemizedAssignmentContainer) {
            itemizedAssignmentContainer.style.display = method === "items" ? "block" : "none";
        }
        if (equalSplitContainer) {
            equalSplitContainer.style.display = method === "equal" ? "block" : "none";
        }
        updateReceiptSummary();
    }

    if (splitByItems) splitByItems.addEventListener("change", () => setSplitMethod("items"));
    if (splitEqually) splitEqually.addEventListener("change", () => setSplitMethod("equal"));

    // ==========================================
    // 5. LOAD GROUPS & ACTIVE MEMBERS
    // ==========================================

    async function loadGroups() {
        if (!receiptGroupSelect) return;

        try {
            const response = await fetch("/api/groups", { credentials: "same-origin" });
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Could not load groups.");
            }

            availableGroups = data.groups || [];
            receiptGroupSelect.innerHTML = '<option value="">Select a group</option>';

            availableGroups.forEach(group => {
                const opt = document.createElement("option");
                opt.value = group.id;
                opt.textContent = group.name;
                receiptGroupSelect.appendChild(opt);
            });

            // Also populate floating assistant group select if present
            const assistantGroupSelect = document.getElementById("groupSelect");
            if (assistantGroupSelect) {
                assistantGroupSelect.innerHTML = '<option value="">Select a group</option>';
                availableGroups.forEach(group => {
                    const opt = document.createElement("option");
                    opt.value = group.id;
                    opt.textContent = group.name;
                    assistantGroupSelect.appendChild(opt);
                });
            }

            if (availableGroups.length > 0) {
                receiptGroupSelect.value = String(availableGroups[0].id);
                loadPayerMembers();
                if (assistantGroupSelect) assistantGroupSelect.value = String(availableGroups[0].id);
            }

        } catch (error) {
            console.error("Load groups error:", error);
            showItemMessage("Could not load your groups.", true);
        }
    }

    function loadPayerMembers() {
        if (!receiptGroupSelect || !receiptPayerSelect) return;

        const groupId = receiptGroupSelect.value;
        receiptPayerSelect.innerHTML = '<option value="">Select payer</option>';
        currentReceiptMembers = [];

        if (!groupId) {
            receiptPayerSelect.disabled = true;
            return;
        }

        const selectedGroup = availableGroups.find(g => String(g.id) === String(groupId));
        if (selectedGroup && Array.isArray(selectedGroup.members)) {
            currentReceiptMembers = selectedGroup.members.filter(m => m.is_active !== 0);

            currentReceiptMembers.forEach(member => {
                const opt = document.createElement("option");
                opt.value = member.id;
                opt.textContent = member.name;
                receiptPayerSelect.appendChild(opt);
            });

            receiptPayerSelect.disabled = currentReceiptMembers.length === 0;
            if (currentReceiptMembers.length > 0) {
                receiptPayerSelect.value = String(currentReceiptMembers[0].id);
            }
        }

        // Re-render items so member checkboxes match this group
        renderReceiptItems();
        updateReceiptSummary();
    }

    if (receiptGroupSelect) {
        receiptGroupSelect.addEventListener("change", loadPayerMembers);
    }

    // ==========================================
    // 6. RENDER ITEMIZED LINE ITEMS & ASSIGNMENTS
    // ==========================================

    function renderReceiptItems() {
        if (!receiptItemsList) return;
        receiptItemsList.replaceChildren();

        if (receiptItems.length === 0) {
            receiptItemsList.innerHTML = `
                <p class="empty-state">
                    No items yet. Upload a receipt or click "+ Add Line Item".
                </p>
            `;
            updateReceiptSummary();
            return;
        }

        receiptItems.forEach((item, index) => {
            const card = document.createElement("div");
            card.className = "receipt-item-card";

            // Header with Item Title and Remove button
            const header = document.createElement("div");
            header.className = "receipt-item-header";

            const title = document.createElement("strong");
            title.textContent = item.name.trim() || `Item ${index + 1}`;
            title.style.fontSize = "13.5px";

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button button-danger";
            removeBtn.style.padding = "4px 8px";
            removeBtn.style.fontSize = "11px";
            removeBtn.textContent = "Remove";

            removeBtn.addEventListener("click", () => {
                receiptItems.splice(index, 1);
                renderReceiptItems();
                updateReceiptSummary();
            });

            header.append(title, removeBtn);

            // Name and Amount Inputs
            const inputsGrid = document.createElement("div");
            inputsGrid.style.display = "grid";
            inputsGrid.style.gridTemplateColumns = "2fr 1fr";
            inputsGrid.style.gap = "10px";
            inputsGrid.style.marginBottom = "10px";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.placeholder = "Item description";
            nameInput.value = item.name;
            nameInput.addEventListener("input", () => {
                receiptItems[index].name = nameInput.value;
                title.textContent = nameInput.value.trim() || `Item ${index + 1}`;
                updateReceiptSummary();
            });

            const amountInput = document.createElement("input");
            amountInput.type = "number";
            amountInput.min = "0.01";
            amountInput.step = "0.01";
            amountInput.placeholder = "0.00";
            amountInput.value = item.amount;
            amountInput.addEventListener("input", () => {
                receiptItems[index].amount = amountInput.value;
                updateReceiptSummary();
            });

            inputsGrid.append(nameInput, amountInput);

            // Member Chips
            const chipsLabel = document.createElement("div");
            chipsLabel.style.display = "flex";
            chipsLabel.style.alignItems = "center";
            chipsLabel.style.justifyContent = "space-between";
            chipsLabel.style.marginBottom = "6px";

            const labelText = document.createElement("small");
            labelText.textContent = "Assign to Member(s):";
            labelText.style.fontWeight = "700";
            labelText.style.color = "var(--text-muted)";

            const quickControls = document.createElement("div");
            quickControls.style.display = "flex";
            quickControls.style.gap = "8px";

            const selectAllBtn = document.createElement("button");
            selectAllBtn.type = "button";
            selectAllBtn.style.fontSize = "11px";
            selectAllBtn.style.color = "var(--primary)";
            selectAllBtn.style.fontWeight = "600";
            selectAllBtn.textContent = "All";

            const clearBtn = document.createElement("button");
            clearBtn.type = "button";
            clearBtn.style.fontSize = "11px";
            clearBtn.style.color = "var(--text-muted)";
            clearBtn.style.fontWeight = "600";
            clearBtn.textContent = "Clear";

            quickControls.append(selectAllBtn, clearBtn);
            chipsLabel.append(labelText, quickControls);

            const chipsContainer = document.createElement("div");
            chipsContainer.className = "receipt-member-chips";

            // Normalize member IDs
            item.memberIds = (item.memberIds || []).map(Number);

            function updateChipsUI() {
                chipsContainer.replaceChildren();

                if (currentReceiptMembers.length === 0) {
                    const empty = document.createElement("small");
                    empty.textContent = "Select a group with members to assign items.";
                    empty.style.color = "var(--text-muted)";
                    chipsContainer.appendChild(empty);
                    return;
                }

                currentReceiptMembers.forEach(member => {
                    const chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "receipt-member-chip";
                    const isSelected = item.memberIds.includes(Number(member.id));
                    if (isSelected) chip.classList.add("selected");

                    chip.textContent = `${isSelected ? "✓ " : "+ "}${member.name}`;

                    chip.addEventListener("click", () => {
                        const mid = Number(member.id);
                        if (item.memberIds.includes(mid)) {
                            item.memberIds = item.memberIds.filter(id => id !== mid);
                        } else {
                            item.memberIds.push(mid);
                        }
                        updateChipsUI();
                        updateReceiptSummary();
                    });

                    chipsContainer.appendChild(chip);
                });
            }

            selectAllBtn.addEventListener("click", () => {
                item.memberIds = currentReceiptMembers.map(m => Number(m.id));
                updateChipsUI();
                updateReceiptSummary();
            });

            clearBtn.addEventListener("click", () => {
                item.memberIds = [];
                updateChipsUI();
                updateReceiptSummary();
            });

            updateChipsUI();

            card.append(header, inputsGrid, chipsLabel, chipsContainer);
            receiptItemsList.appendChild(card);
        });

        updateReceiptSummary();
    }

    if (addReceiptItemBtn) {
        addReceiptItemBtn.addEventListener("click", () => {
            receiptItems.push({
                name: `Item ${receiptItems.length + 1}`,
                amount: "0.00",
                memberIds: currentReceiptMembers.map(m => Number(m.id)) // Default to all members
            });
            renderReceiptItems();
            updateReceiptSummary();
        });
    }

    // ==========================================
    // 7. REAL-TIME MATH VERIFICATION & SUMMARY
    // ==========================================

    function updateReceiptSummary() {
        const itemTotalCents = receiptItems.reduce((sum, item) => {
            const amt = Number(item.amount);
            return sum + (Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) : 0);
        }, 0);

        if (receiptItemsTotal) {
            receiptItemsTotal.textContent = formatMoney(itemTotalCents);
        }

        const detectedTotal = Number(receiptTotalInput?.value || 0);
        const detectedTotalCents = Number.isFinite(detectedTotal) && detectedTotal > 0
            ? Math.round(detectedTotal * 100)
            : null;

        const assignedItemsCount = receiptItems.filter(item =>
            item.name.trim().length > 0 &&
            Number(item.amount) > 0 &&
            item.memberIds.length > 0
        ).length;

        if (receiptAssignmentStatus) {
            if (activeExpenseType === "personal") {
                receiptAssignmentStatus.textContent = "Personal Expense: Ready to save to personal ledger.";
                receiptAssignmentStatus.style.color = "var(--primary)";
            } else if (activeSplitMethod === "equal") {
                receiptAssignmentStatus.textContent = `Equal Split: Will divide ${formatMoney(detectedTotalCents || itemTotalCents)} equally among ${currentReceiptMembers.length} member(s).`;
                receiptAssignmentStatus.style.color = "var(--primary)";
            } else {
                let status = `${assignedItemsCount} of ${receiptItems.length} item(s) allocated`;

                if (detectedTotalCents !== null) {
                    const diff = itemTotalCents - detectedTotalCents;
                    if (Math.abs(diff) === 0) {
                        status += " • Verified: Items match receipt total ✓";
                        receiptAssignmentStatus.style.color = "var(--success)";
                    } else {
                        status += ` • Warning: Items (${formatMoney(itemTotalCents)}) vs Total (${formatMoney(detectedTotalCents)}) differ by ${formatMoney(Math.abs(diff))}`;
                        receiptAssignmentStatus.style.color = "var(--warning)";
                    }
                }
                receiptAssignmentStatus.textContent = status;
            }
        }

        // Enable or disable save button
        if (saveReceiptItemsBtn) {
            const hasGroup = Boolean(receiptGroupSelect && receiptGroupSelect.value);
            const hasPayer = Boolean(receiptPayerSelect && receiptPayerSelect.value);

            if (activeSplitMethod === "equal") {
                saveReceiptItemsBtn.disabled = !hasGroup || !hasPayer || (!detectedTotalCents && !itemTotalCents);
            } else {
                saveReceiptItemsBtn.disabled = !hasGroup || !hasPayer ||
                    receiptItems.length === 0 ||
                    assignedItemsCount !== receiptItems.length;
            }
        }
    }

    if (receiptTotalInput) {
        receiptTotalInput.addEventListener("input", updateReceiptSummary);
    }

    // ==========================================
    // 8. DUPLICATE RECEIPT CHECK
    // ==========================================

    async function checkForDuplicateReceipt(groupId, description, amount) {
        try {
            const response = await fetch(`/api/groups/${groupId}/check-duplicate-receipt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ description, amount })
            });

            const data = await response.json();
            if (response.ok && data.success && data.duplicateFound) {
                const dupes = data.possibleDuplicates || [];
                if (duplicateWarningBox && duplicateWarningText) {
                    duplicateWarningText.textContent = ` An expense of ${formatMoney(dupes[0].amount_cents)} for "${dupes[0].description}" already exists in this group.`;
                    duplicateWarningBox.style.display = "block";
                }
                return confirm(`A similar expense of ${formatMoney(dupes[0].amount_cents)} ("${dupes[0].description}") already exists in this group.\n\nDo you want to save this receipt anyway?`);
            } else if (duplicateWarningBox) {
                duplicateWarningBox.style.display = "none";
            }
            return true;
        } catch (error) {
            console.warn("Duplicate check error:", error);
            return true;
        }
    }

    // ==========================================
    // 9. SAVE RECEIPT EXPENSE (GROUP & PERSONAL)
    // ==========================================

    // Personal Save
    if (savePersonalReceiptBtn) {
        savePersonalReceiptBtn.addEventListener("click", async () => {
            const desc = (receiptMerchant?.value || "").trim() || "Personal Scanned Receipt";
            const amt = Number(receiptTotalInput?.value || 0);

            if (!Number.isFinite(amt) || amt <= 0) {
                showItemMessage("Please specify a valid receipt amount.", true);
                return;
            }

            savePersonalReceiptBtn.disabled = true;
            showItemMessage("Saving personal expense...");

            try {
                const response = await fetch("/api/personal-expenses", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({ description: desc, amount: amt })
                });

                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || "Could not save personal expense.");
                }

                showItemMessage("Personal receipt expense saved successfully! Redirecting to expenses...", false);
                setTimeout(() => window.location.href = "expenses.html", 1200);

            } catch (error) {
                showItemMessage(error.message, true);
                savePersonalReceiptBtn.disabled = false;
            }
        });
    }

    // Group Save
    if (saveReceiptItemsBtn) {
        saveReceiptItemsBtn.addEventListener("click", async () => {
            const groupId = receiptGroupSelect?.value;
            const payerId = Number(receiptPayerSelect?.value);
            const desc = (receiptMerchant?.value || "").trim() || "Scanned Receipt";

            if (!groupId || !payerId) {
                showItemMessage("Please select a group and payer.", true);
                return;
            }

            // EQUAL SPLIT PATH
            if (activeSplitMethod === "equal") {
                const amt = Number(receiptTotalInput?.value || 0);
                if (!Number.isFinite(amt) || amt <= 0) {
                    showItemMessage("Please enter a valid receipt total.", true);
                    return;
                }

                const proceed = await checkForDuplicateReceipt(groupId, desc, amt);
                if (!proceed) return;

                saveReceiptItemsBtn.disabled = true;
                showItemMessage("Saving group expense...");

                try {
                    const response = await fetch(`/api/groups/${groupId}/expenses`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "same-origin",
                        body: JSON.stringify({ description: desc, amount: amt, payerId })
                    });

                    const data = await response.json();
                    if (!response.ok || !data.success) {
                        throw new Error(data.message || "Could not save expense.");
                    }

                    showItemMessage("Group expense saved successfully! Redirecting...", false);
                    setTimeout(() => window.location.href = "expenses.html", 1200);
                } catch (error) {
                    showItemMessage(error.message, true);
                    saveReceiptItemsBtn.disabled = false;
                }
                return;
            }

            // ITEMIZED SPLIT PATH
            if (receiptItems.length === 0) {
                showItemMessage("Please add at least one line item.", true);
                return;
            }

            const invalidItem = receiptItems.find(item =>
                !item.name.trim() ||
                !Number.isFinite(Number(item.amount)) ||
                Number(item.amount) <= 0 ||
                item.memberIds.length === 0
            );

            if (invalidItem) {
                showItemMessage(`Item "${invalidItem.name || "unnamed"}" is missing an amount or assigned members.`, true);
                return;
            }

            const totalAmount = receiptItems.reduce((sum, item) => sum + Number(item.amount), 0);
            const proceed = await checkForDuplicateReceipt(groupId, desc, totalAmount);
            if (!proceed) return;

            saveReceiptItemsBtn.disabled = true;
            showItemMessage("Saving itemized receipt...");

            const payload = {
                description: desc,
                payerId,
                items: receiptItems.map(item => ({
                    name: item.name.trim(),
                    amount: Number(item.amount),
                    memberIds: item.memberIds.map(Number)
                }))
            };

            try {
                const response = await fetch(`/api/groups/${groupId}/receipt-expenses`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || "Could not save itemized receipt.");
                }

                showItemMessage(`Itemized receipt saved successfully! (${data.itemCount} items, ${formatMoney(data.amountCents)}). Redirecting...`, false);
                setTimeout(() => window.location.href = "expenses.html", 1400);

            } catch (error) {
                showItemMessage(error.message, true);
                saveReceiptItemsBtn.disabled = false;
            }
        });
    }

    // Expose scanned items receiver for any external script
    window.setScannedReceiptItems = function (items, details = {}) {
        if (details.merchant && receiptMerchant) receiptMerchant.value = details.merchant;
        if (details.date && receiptDate) receiptDate.value = details.date;
        if (details.total !== null && details.total !== undefined && receiptTotalInput) {
            receiptTotalInput.value = Number(details.total).toFixed(2);
        }

        receiptItems = (items || []).map(item => ({
            name: String(item.name || ""),
            amount: Number(item.amount) || "0.00",
            memberIds: currentReceiptMembers.map(m => Number(m.id))
        }));

        renderReceiptItems();
        updateReceiptSummary();
    };

    // Initialize
    loadGroups();
})();
