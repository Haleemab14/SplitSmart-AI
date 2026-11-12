const express = require("express");
const paypal = require("../services/paypalService");
const checkout = require("../services/paypalCheckout");
const { recordPaymentReceipt } = require("../services/finnyTools");

const router = express.Router();

router.get("/paypal/config", (req, res) => {
    const enabled = paypal.paypalEnabled();

    res.json({
        success: true,
        enabled,
        clientId: enabled ? process.env.PAYPAL_CLIENT_ID : null,
        mode: "sandbox",
        currency: "USD"
    });
});

router.post("/groups/:groupId/paypal/orders", async (req, res) => {
    const groupId = Number(req.params.groupId);

    try {
        const urls = paypal.checkoutUrls(req);
        const outcome = await checkout.startSettlementCheckout({
            userId: req.user.id,
            groupId,
            fromId: Number(req.body.fromId),
            toId: Number(req.body.toId),
            returnUrl: urls.returnUrl,
            cancelUrl: urls.cancelUrl
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error("PayPal create order error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not create a PayPal Sandbox order."
        });
    }
});

router.post("/groups/:groupId/paypal/orders/:orderId/capture", async (req, res) => {
    const groupId = Number(req.params.groupId);
    const orderId = String(req.params.orderId || "").trim();

    try {
        const outcome = await checkout.captureSettlementCheckout({
            userId: req.user.id,
            groupId,
            orderId
        });

        if (
            outcome.body.success &&
            outcome.body.status === "COMPLETED" &&
            outcome.body.payer &&
            outcome.body.payee &&
            outcome.body.captureId
        ) {
            try {
                outcome.body.receipt = recordPaymentReceipt({
                    userId: req.user.id,
                    groupId,
                    payerName: outcome.body.payer,
                    payeeName: outcome.body.payee,
                    amountCents: outcome.body.amountCents,
                    currency: "USD",
                    captureId: outcome.body.captureId
                });
            } catch (noticeError) {
                console.error("Payment receipt notice failed:", noticeError.message);
            }
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error("PayPal capture error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not capture the PayPal Sandbox payment. The settlement is still unpaid."
        });
    }
});

module.exports = router;
