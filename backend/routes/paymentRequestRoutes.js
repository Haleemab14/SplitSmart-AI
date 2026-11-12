const express = require("express");
const {
    REFERENCE_PATTERN,
    dashboardForUser,
    generateForUser,
    loadAuthorizedRequest,
    markRequestRead,
    cancelRequest
} = require("../services/paymentRequests");

const router = express.Router();

router.get("/me/debts", (req, res) => {
    try {
        res.json(dashboardForUser(req.user.id));
    } catch (error) {
        console.error("Debt dashboard error:", error);
        res.status(500).json({
            success: false,
            message: "Could not load your balances."
        });
    }
});

router.post("/me/payment-requests/generate", (req, res) => {
    try {
        res.json(generateForUser(req.user.id));
    } catch (error) {
        console.error("Payment request generation error:", error);
        res.status(500).json({
            success: false,
            message: "Could not generate payment requests."
        });
    }
});

router.post("/me/payment-requests", (req, res) => {
    const groupId = Number(req.body.groupId);
    const fromMemberId = Number(req.body.fromMemberId);

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(fromMemberId) || fromMemberId <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Choose a group and the person who owes you."
        });
    }

    try {
        const dashboard = generateForUser(req.user.id, {
            force: true,
            groupId,
            fromMemberId
        });
        const created = dashboard.receivables.find(item =>
            item.groupId === groupId &&
            item.memberId === fromMemberId &&
            item.request &&
            item.request.status === "open"
        );

        if (!created) {
            return res.status(400).json({
                success: false,
                message: "The ledger has no outstanding amount from that person to you."
            });
        }

        res.status(201).json({
            success: true,
            reference: created.request.reference,
            dashboard
        });
    } catch (error) {
        console.error("Payment request create error:", error);
        res.status(500).json({
            success: false,
            message: "Could not create the payment request."
        });
    }
});

router.get("/payment-requests/:reference", (req, res) => {
    const reference = String(req.params.reference || "");

    if (!REFERENCE_PATTERN.test(reference)) {
        return res.status(404).json({
            success: false,
            message: "Payment request not found."
        });
    }

    try {
        const view = loadAuthorizedRequest(req.user.id, reference);

        if (!view) {
            return res.status(404).json({
                success: false,
                message: "Payment request not found."
            });
        }

        res.json(view);
    } catch (error) {
        console.error("Payment request load error:", error);
        res.status(500).json({
            success: false,
            message: "Could not open this payment request."
        });
    }
});

router.post("/payment-requests/:reference/read", (req, res) => {
    const reference = String(req.params.reference || "");

    try {
        const view = markRequestRead(req.user.id, reference);

        if (!view) {
            return res.status(404).json({
                success: false,
                message: "Payment request not found."
            });
        }

        res.json(view);
    } catch (error) {
        console.error("Payment request read error:", error);
        res.status(500).json({
            success: false,
            message: "Could not update this notification."
        });
    }
});

router.post("/payment-requests/:reference/cancel", (req, res) => {
    const reference = String(req.params.reference || "");

    try {
        const result = cancelRequest(req.user.id, reference);

        if (result.status === 404) {
            return res.status(404).json({
                success: false,
                message: "Payment request not found."
            });
        }

        if (result.status === 409) {
            return res.status(409).json({
                success: false,
                message: "This payment request can no longer be cancelled."
            });
        }

        res.json({
            success: true,
            already: Boolean(result.already),
            message: result.already
                ? "This payment request was already cancelled. It remains unpaid."
                : "Payment request cancelled. The ledger balance is unchanged and nothing was paid."
        });
    } catch (error) {
        console.error("Payment request cancel error:", error);
        res.status(500).json({
            success: false,
            message: "Could not cancel this payment request."
        });
    }
});

module.exports = router;
