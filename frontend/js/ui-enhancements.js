// ==========================================
// SPLITSMART AI - UI ENHANCEMENTS
// Collapsible Panels, Floating Finny, Chart Redraw
// ==========================================

(function initUIEnhancements() {
    function setupCollapsibles() {
        // Find all cards with collapse toggles
        document.querySelectorAll(".collapsible-card").forEach(card => {
            if (card.dataset.collapseInitialized === "true") return;

            const toggle = card.querySelector(".collapse-toggle");
            const content = card.querySelector(".collapsible-content");

            if (!toggle || !content) return;

            card.dataset.collapseInitialized = "true";

            toggle.addEventListener("click", (e) => {
                e.stopPropagation();
                const isExpanded = toggle.getAttribute("aria-expanded") === "true";
                const newExpanded = !isExpanded;

                toggle.setAttribute("aria-expanded", String(newExpanded));
                toggle.setAttribute("aria-label", newExpanded ? "Collapse section" : "Expand section");
                content.classList.toggle("is-collapsed", !newExpanded);

                // If expanding, ensure Chart.js and AG Grid instances redraw smoothly
                if (newExpanded) {
                    setTimeout(() => {
                        window.dispatchEvent(new Event("resize"));
                        if (typeof window.refreshSpendingAnalytics === "function") {
                            // If chart containers need update
                            const charts = [window.categoryChart, window.monthlyChart];
                            charts.forEach(c => {
                                if (c && typeof c.resize === "function") {
                                    c.resize();
                                }
                            });
                        }
                    }, 50);
                }
            });
        });
    }

    function setupFinnyFloating() {
        const finnyBtn = document.getElementById("finnyFloatingButton");
        const finnyPanel = document.getElementById("finnyFloatingPanel");
        const closeBtn = document.getElementById("finnyCloseButton");
        const questionInput = document.getElementById("aiQuestionInput");

        if (!finnyBtn || !finnyPanel) return;

        function openFinny() {
            finnyPanel.classList.add("is-open");
            finnyPanel.setAttribute("aria-hidden", "false");
            finnyBtn.setAttribute("aria-expanded", "true");
            finnyBtn.setAttribute("aria-label", "Close Finny Assistant");
            if (questionInput) {
                setTimeout(() => questionInput.focus(), 100);
            }
        }

        function closeFinny() {
            finnyPanel.classList.remove("is-open");
            finnyPanel.setAttribute("aria-hidden", "true");
            finnyBtn.setAttribute("aria-expanded", "false");
            finnyBtn.setAttribute("aria-label", "Open Finny Assistant");
        }

        finnyBtn.addEventListener("click", () => {
            const isOpen = finnyPanel.classList.contains("is-open");
            if (isOpen) {
                closeFinny();
            } else {
                openFinny();
            }
        });

        if (closeBtn) {
            closeBtn.addEventListener("click", closeFinny);
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && finnyPanel.classList.contains("is-open")) {
                closeFinny();
            }
        });

        // Expose helper globally
        window.openFinnyAssistant = openFinny;
        window.closeFinnyAssistant = closeFinny;
    }

    function setupMobileNav() {
        const sidebar = document.querySelector(".sidebar");
        const topbar = document.querySelector(".topbar");

        if (!sidebar || !topbar || document.getElementById("navToggle")) {
            return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.id = "navToggle";
        button.className = "nav-toggle";
        button.textContent = "Menu";
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "Open navigation");
        topbar.prepend(button);

        button.addEventListener("click", () => {
            const open = sidebar.classList.toggle("is-open");
            button.setAttribute("aria-expanded", String(open));
            button.textContent = open ? "Close" : "Menu";
        });

        sidebar.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                sidebar.classList.remove("is-open");
                button.setAttribute("aria-expanded", "false");
                button.textContent = "Menu";
            });
        });
    }

    // Run on DOM ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            setupCollapsibles();
            setupFinnyFloating();
            setupMobileNav();
        });
    } else {
        setupCollapsibles();
        setupFinnyFloating();
        setupMobileNav();
    }
})();
