const db = require("../database/db");
const paypal = require("./paypalService");
const { getGroupLedger } = require("./ledger");
const {
    userCanPayAsPayer,
    recordVerifiedRequestPayment
} = require("./paymentRequests");

function outstandingSettlement(groupId, fromId, toId) {
    return getGroupLedger(groupId).settlements.find(item =>
        item.fromId === fromId && item.toId === toId
    ) || null;
}

function settlementCustomId(groupId, fromId, toId, amountCents) {
    return `${groupId}:${fromId}:${toId}:${amountCents}`;
}

function memberNames(fromId, toId) {
    return db.prepare(`
        SELECT payer.name AS payer, payee.name AS payee
        FROM members payer, members payee
        WHERE payer.id = ? AND payee.id = ?
    `).get(fromId, toId);
}

async function loadOrderForCapture(orderId) {
    let latest = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        latest = await paypal.getOrder(orderId);
        const status = paypal.orderStatus(latest);

        if (status !== "CREATED" || paypal.isCaptured(latest)) {
            return latest;
        }

        if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 700));
        }
    }

    return latest;
}

function pendingPayments(groupId, fromId, toId, amountCents) {
    return db.prepare(`
        SELECT *
        FROM payments
        WHERE group_id = ?
          AND payer_id = ?
          AND payee_id = ?
          AND amount_cents = ?
          AND status = 'PENDING'
          AND paypal_order_id IS NOT NULL
        ORDER BY id DESC
    `).all(groupId, fromId, toId, amountCents);
}

function voidPending(paymentId) {
    db.prepare(`
        UPDATE payments
        SET status = 'VOIDED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'PENDING'
    `).run(paymentId);
}

async function startSettlementCheckout({
    userId,
    groupId,
    fromId,
    toId,
    returnUrl,
    cancelUrl
}) {
    if (!paypal.paypalEnabled()) {
        return {
            status: 503,
            body: { success: false, message: "PayPal Sandbox is not configured." }
        };
    }

    if (
        !Number.isInteger(groupId) || groupId <= 0 ||
        !Number.isInteger(fromId) ||
        !Number.isInteger(toId) ||
        fromId === toId
    ) {
        return {
            status: 400,
            body: { success: false, message: "Invalid settlement payment details." }
        };
    }

    if (!userCanPayAsPayer(groupId, userId, fromId)) {
        return {
            status: 403,
            body: {
                success: false,
                message: "Only the linked member who owes this amount can start PayPal Sandbox checkout."
            }
        };
    }

    const settlement = outstandingSettlement(groupId, fromId, toId);

    if (!settlement) {
        return {
            status: 400,
            body: { success: false, message: "This settlement is no longer outstanding." }
        };
    }

    const names = memberNames(fromId, toId);
    const pending = pendingPayments(groupId, fromId, toId, settlement.amountCents);

    for (const payment of pending) {
        try {
            const remote = await paypal.getOrder(payment.paypal_order_id);
            const remoteStatus = paypal.orderStatus(remote);

            if (paypal.isCaptured(remote)) {
                return captureSettlementCheckout({
                    userId,
                    groupId,
                    orderId: payment.paypal_order_id
                });
            }

            if (remoteStatus === "APPROVED") {
                return {
                    status: 200,
                    body: {
                        success: true,
                        next: "capture",
                        orderId: payment.paypal_order_id,
                        paymentId: payment.id,
                        status: remoteStatus,
                        amountCents: settlement.amountCents,
                        currency: "USD",
                        payer: names?.payer || settlement.from,
                        payee: names?.payee || settlement.to
                    }
                };
            }
        } catch (lookupError) {
            console.error("PayPal order lookup error:", lookupError.message);
        }

        voidPending(payment.id);
    }

    const order = await paypal.createOrder({
        amountCents: settlement.amountCents,
        currency: "USD",
        description: `SplitSmart settlement: ${settlement.from} to ${settlement.to}`,
        customId: settlementCustomId(groupId, fromId, toId, settlement.amountCents),
        returnUrl,
        cancelUrl
    });

    const result = db.prepare(`
        INSERT INTO payments (
            group_id,
            payer_id,
            payee_id,
            amount_cents,
            currency,
            status,
            paypal_order_id,
            updated_at
        )
        VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, CURRENT_TIMESTAMP)
    `).run(groupId, fromId, toId, settlement.amountCents, order.id);

    return {
        status: 201,
        body: {
            success: true,
            next: "approve",
            orderId: order.id,
            paymentId: Number(result.lastInsertRowid),
            status: "CREATED",
            amountCents: settlement.amountCents,
            currency: "USD",
            payer: names?.payer || settlement.from,
            payee: names?.payee || settlement.to
        }
    };
}

async function captureSettlementCheckout({ userId, groupId, orderId }) {
    if (!paypal.paypalEnabled()) {
        return {
            status: 503,
            body: { success: false, message: "PayPal Sandbox is not configured." }
        };
    }

    if (!Number.isInteger(groupId) || groupId <= 0 || !orderId) {
        return {
            status: 400,
            body: { success: false, message: "Invalid payment capture request." }
        };
    }

    const payment = db.prepare(`
        SELECT *
        FROM payments
        WHERE group_id = ? AND paypal_order_id = ?
    `).get(groupId, orderId);

    if (!payment || !userCanPayAsPayer(groupId, userId, payment.payer_id)) {
        return {
            status: 403,
            body: {
                success: false,
                message: "Only the linked member who owes this amount can complete this payment."
            }
        };
    }

    if (payment.status === "COMPLETED") {
        return {
            status: 200,
            body: {
                success: true,
                message: "This PayPal Sandbox payment was already captured.",
                status: "COMPLETED",
                orderId,
                captureId: payment.paypal_capture_id || null
            }
        };
    }

    const live = outstandingSettlement(groupId, payment.payer_id, payment.payee_id);

    if (!live || live.amountCents !== payment.amount_cents) {
        return {
            status: 409,
            body: {
                success: false,
                message: "This settlement amount is no longer outstanding, so it was not marked paid."
            }
        };
    }

    const remote = await loadOrderForCapture(orderId);
    let captured = remote;

    if (paypal.isCaptured(remote)) {
        captured = remote;
    } else if (paypal.needsBuyerApproval(remote)) {
        const status = paypal.orderStatus(remote);
        const code = status === "PAYER_ACTION_REQUIRED"
            ? "PAYER_ACTION_REQUIRED"
            : "ORDER_NOT_APPROVED";

        return {
            status: 409,
            body: {
                success: false,
                code,
                needsApproval: true,
                message: code === "PAYER_ACTION_REQUIRED"
                    ? "PayPal Sandbox needs the buyer to finish approval. The settlement is still unpaid."
                    : "PayPal Sandbox has not approved this order yet. Approve it in the PayPal window. The settlement is still unpaid.",
                status
            }
        };
    } else if (paypal.orderStatus(remote) !== "APPROVED") {
        return {
            status: 409,
            body: {
                success: false,
                code: paypal.orderStatus(remote) || "UNKNOWN",
                needsApproval: false,
                message: "This PayPal Sandbox order cannot be captured. The settlement is still unpaid.",
                status: paypal.orderStatus(remote) || "UNKNOWN"
            }
        };
    } else {
        try {
            captured = await paypal.captureOrder(orderId);
        } catch (captureError) {
            const issue = captureError.paypal?.issue || "";

            if (issue === "ORDER_ALREADY_CAPTURED" || issue === "ORDER_ALREADY_COMPLETED") {
                captured = await paypal.getOrder(orderId);
            } else if (issue === "ORDER_NOT_APPROVED" || issue === "PAYER_ACTION_REQUIRED") {
                return {
                    status: 409,
                    body: {
                        success: false,
                        code: issue,
                        needsApproval: true,
                        message: captureError.paypal?.description ||
                            "PayPal Sandbox still needs buyer approval. The settlement is still unpaid.",
                        status: "CREATED"
                    }
                };
            } else {
                const latest = await paypal.getOrder(orderId).catch(() => null);

                if (latest && paypal.isCaptured(latest)) {
                    captured = latest;
                } else {
                    return {
                        status: 409,
                        body: {
                            success: false,
                            code: issue || captureError.paypal?.name || "CAPTURE_FAILED",
                            needsApproval: false,
                            message: "PayPal Sandbox did not capture this order. The settlement is still unpaid.",
                            status: latest ? paypal.orderStatus(latest) : "PENDING"
                        }
                    };
                }
            }
        }
    }

    const capture = paypal.readCapture(captured);
    const expectedCustomId = settlementCustomId(
        groupId,
        payment.payer_id,
        payment.payee_id,
        payment.amount_cents
    );
    const verified = Boolean(
        capture &&
        capture.status === "COMPLETED" &&
        capture.currency === "USD" &&
        capture.amountCents === payment.amount_cents &&
        capture.captureId &&
        (!capture.customId || capture.customId === expectedCustomId)
    );

    if (!verified) {
        db.prepare(`
            UPDATE payments
            SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status != 'COMPLETED'
        `).run(payment.id);

        return {
            status: 409,
            body: {
                success: false,
                message: "The PayPal capture could not be verified. The settlement was not marked paid.",
                status: capture?.status || captured?.status || "UNKNOWN"
            }
        };
    }

    let saved;

    try {
        saved = db.transaction(() => {
            const current = db.prepare(`
                SELECT status
                FROM payments
                WHERE id = ? AND group_id = ?
            `).get(payment.id, groupId);

            if (!current) {
                throw new Error("Payment record disappeared.");
            }

            if (current.status === "COMPLETED") {
                return { already: true };
            }

            const stillDue = outstandingSettlement(
                groupId,
                payment.payer_id,
                payment.payee_id
            );

            if (!stillDue || stillDue.amountCents !== payment.amount_cents) {
                throw new Error("ALREADY_CLEARED");
            }

            const updated = db.prepare(`
                UPDATE payments
                SET status = 'COMPLETED',
                    paypal_capture_id = ?,
                    currency = 'USD',
                    captured_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND group_id = ? AND status != 'COMPLETED'
            `).run(capture.captureId, payment.id, groupId);

            if (updated.changes !== 1) {
                return { already: true };
            }

            db.prepare(`
                INSERT INTO ss_settlement_records (
                    group_id,
                    from_member_id,
                    to_member_id,
                    amount_cents,
                    status
                )
                VALUES (?, ?, ?, ?, 'paid')
            `).run(
                groupId,
                payment.payer_id,
                payment.payee_id,
                payment.amount_cents
            );

            const requestUpdate = recordVerifiedRequestPayment({
                groupId,
                fromMemberId: payment.payer_id,
                toMemberId: payment.payee_id,
                amountCents: payment.amount_cents,
                captureId: capture.captureId,
                paymentId: payment.id
            });

            return { already: false, requestUpdate };
        })();
    } catch (error) {
        if (error.message === "ALREADY_CLEARED") {
            return {
                status: 409,
                body: {
                    success: false,
                    message: "This settlement was already cleared, so the payment was not counted again."
                }
            };
        }

        throw error;
    }

    const names = memberNames(payment.payer_id, payment.payee_id);

    return {
        status: 200,
        body: {
            success: true,
            message: saved.already
                ? "This PayPal Sandbox payment was already captured."
                : "PayPal Sandbox payment captured. The settlement is now paid.",
            status: "COMPLETED",
            orderId,
            captureId: capture.captureId,
            amountCents: payment.amount_cents,
            currency: "USD",
            payer: names?.payer || null,
            payee: names?.payee || null,
            paymentRequest: saved.requestUpdate || null
        }
    };
}

module.exports = {
    startSettlementCheckout,
    captureSettlementCheckout
};
