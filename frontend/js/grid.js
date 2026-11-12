(function initSplitSmartGrid() {
    function money(cents) {
        return (Number(cents) / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD"
        });
    }

    function formatDate(value) {
        if (!value) return "";
        const text = String(value);
        const date = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
        if (Number.isNaN(date.getTime())) return text.slice(0, 10);
        return date.toLocaleDateString("en-US");
    }

    function communityReady() {
        return Boolean(window.agGrid && typeof window.agGrid.createGrid === "function");
    }

    function createGrid(element, options) {
        if (!element || !communityReady()) return null;
        element.classList.add("ag-theme-quartz", "ss-grid");
        return window.agGrid.createGrid(element, {
            theme: "legacy",
            defaultColDef: {
                sortable: true,
                filter: true,
                resizable: true,
                floatingFilter: true,
                minWidth: 110
            },
            pagination: true,
            paginationPageSize: 10,
            paginationPageSizeSelector: [10, 20, 50],
            animateRows: true,
            suppressCellFocus: true,
            ...options
        });
    }

    function setRows(api, rows) {
        if (api) api.setGridOption("rowData", rows || []);
    }

    window.ssGrid = { money, formatDate, communityReady, createGrid, setRows };
}());
