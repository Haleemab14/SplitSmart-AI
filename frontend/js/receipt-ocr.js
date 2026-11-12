// Shared receipt text parsing used by the scanner pages.
// Tesseract.js still performs the OCR. This module only reads the text.

(function attachReceiptOcr(root) {
    function normalizeReceiptPrice(value) {
        let price = String(value || "")
            .replace(/[$€£\s]/g, "")
            .trim();

        if (!price) return null;

        if (price.includes(",") && price.includes(".")) {
            price = price.replace(/,/g, "");
        } else if (price.includes(",")) {
            const parts = price.split(",");
            if (parts.length === 2 && parts[1].length <= 2) {
                price = parts[0] + "." + parts[1];
            } else {
                price = price.replace(/,/g, "");
            }
        }

        if (/^\d{3,8}$/.test(price)) {
            price = price.slice(0, -2) + "." + price.slice(-2);
        }

        const number = Number(price);
        return Number.isFinite(number) && number > 0
            ? Number(number.toFixed(2))
            : null;
    }

    function toIsoDate(raw) {
        const text = String(raw || "").trim();
        const yearFirst = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
        const monthFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
        let year;
        let month;
        let day;

        if (yearFirst) {
            year = Number(yearFirst[1]);
            month = Number(yearFirst[2]);
            day = Number(yearFirst[3]);
        } else if (monthFirst) {
            month = Number(monthFirst[1]);
            day = Number(monthFirst[2]);
            year = Number(monthFirst[3]);
            if (year < 100) year += 2000;
        } else {
            return "";
        }

        if (month < 1 || month > 12 || day < 1 || day > 31) {
            return "";
        }

        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function extractReceiptDetails(text) {
        const lines = String(text || "")
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const merchant = lines.find(line =>
            /[a-zA-Z]/.test(line) &&
            !/receipt|invoice|cashier|welcome|thank\s*you|customer|terminal|merchant|store|order/i.test(line) &&
            line.length >= 3 &&
            line.length <= 40
        ) || (lines[0] && lines[0].length <= 40 ? lines[0] : "Scanned Receipt");

        const datePattern = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/;
        const dateLine = lines.find(line => datePattern.test(line));
        let date = "";

        if (dateLine) {
            const match = dateLine.match(datePattern);
            if (match) {
                date = toIsoDate(match[0]);
            }
        }

        const totalLines = lines.filter(line =>
            /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total)\b/i.test(line) &&
            !/subtotal|sub-total/i.test(line)
        );

        const moneyPattern = /(?:[$€£]\s*)?\d[\d,]*(?:[.,]\d{1,2})?/g;
        let total = null;

        for (const line of totalLines.reverse()) {
            const matches = line.match(moneyPattern);
            if (!matches || matches.length === 0) continue;
            const value = normalizeReceiptPrice(matches[matches.length - 1]);
            if (value !== null) {
                total = value;
                break;
            }
        }

        if (total === null) {
            const allAmounts = [];
            lines.slice(-10).forEach(line => {
                const matches = line.match(moneyPattern);
                if (!matches) return;
                matches.forEach(match => {
                    const value = normalizeReceiptPrice(match);
                    if (value !== null && value < 50000) {
                        allAmounts.push(value);
                    }
                });
            });
            if (allAmounts.length > 0) {
                total = Math.max(...allAmounts);
            }
        }

        return { merchant, date, total };
    }

    function extractReceiptItems(text) {
        const lines = String(text || "")
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

        const items = [];
        const ignoredWords = /\b(subtotal|sub-total|grand total|total due|amount due|tax|vat|change|cash|card|payment|discount|balance|thank you|invoice|receipt|tip|auth|date|time|visa|mastercard|amex)\b/i;

        for (const line of lines) {
            if (ignoredWords.test(line) || /^\s*total\b/i.test(line)) continue;

            const priceMatch = line.match(
                /^(.+?)\s+(?:[$€£]\s*)?(\d[\d,]*(?:[.,]\d{1,2})?)\s*$/
            );
            if (!priceMatch) continue;

            const name = priceMatch[1]
                .replace(/^[\d\s.#-]+/, "")
                .replace(/[-:|]+$/, "")
                .trim();

            const amount = normalizeReceiptPrice(priceMatch[2]);
            if (!name || !/[a-zA-Z]/.test(name) || amount === null || amount <= 0) {
                continue;
            }

            items.push({
                name,
                amount: amount.toFixed(2),
                memberIds: []
            });
        }

        return items;
    }

    root.SplitSmartOCR = {
        normalizeReceiptPrice,
        extractReceiptDetails,
        extractReceiptItems
    };
})(window);
