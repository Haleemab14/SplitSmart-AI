const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

function sandboxMode() {
    return String(process.env.PAYPAL_MODE || "sandbox").trim().toLowerCase() === "sandbox";
}

function paypalEnabled() {
    return Boolean(
        sandboxMode() &&
        process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET
    );
}

function assertSandbox() {
    if (!sandboxMode()) {
        throw new Error("SplitSmart only accepts PayPal Sandbox mode.");
    }

    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        throw new Error("PayPal Sandbox is not configured.");
    }
}

function centsFromPayPalValue(value) {
    const text = String(value ?? "");
    const match = text.match(/^(\d+)\.(\d{2})$/);

    if (!match) {
        return null;
    }

    return (Number(match[1]) * 100) + Number(match[2]);
}

function paypalErrorMessage(data, fallback) {
    return data?.details?.[0]?.description ||
        data?.message ||
        data?.error_description ||
        fallback;
}

function safePaypalFailure(response, data) {
    const details = Array.isArray(data?.details)
        ? data.details.map(item => ({
            issue: item?.issue || null,
            description: item?.description || null,
            field: item?.field || null
        }))
        : [];

    return {
        httpStatus: response.status,
        name: data?.name || null,
        issue: details[0]?.issue || null,
        description: details[0]?.description || null,
        debugId: data?.debug_id || response.headers.get("paypal-debug-id") || null,
        details,
        headers: {
            "paypal-debug-id": response.headers.get("paypal-debug-id") || null,
            "correlation-id": response.headers.get("correlation-id") || null
        }
    };
}

function logPaypalFailure(action, failure) {
    console.error(`PayPal ${action} rejected:`, failure);
}

async function paypalRequest(path, { method = "GET", body } = {}) {
    const accessToken = await getAccessToken();
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
    };
    const options = { method, headers };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${SANDBOX_BASE}${path}`, options);
    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            data = {};
        }
    }

    return { response, data };
}

async function getAccessToken() {
    assertSandbox();

    const credentials = Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(`${SANDBOX_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
        throw new Error(paypalErrorMessage(
            data,
            "Could not authenticate with PayPal Sandbox."
        ));
    }

    return data.access_token;
}

async function createOrder({
    amountCents,
    currency = "USD",
    description,
    customId,
    returnUrl,
    cancelUrl
}) {
    const accessToken = await getAccessToken();
    const value = `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`;

    const response = await fetch(`${SANDBOX_BASE}/v2/checkout/orders`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
                {
                    description: description || "SplitSmart group settlement",
                    custom_id: customId,
                    amount: {
                        currency_code: currency,
                        value
                    }
                }
            ],
            application_context: {
                brand_name: "SplitSmart AI",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
                return_url: returnUrl,
                cancel_url: cancelUrl
            }
        })
    });

    const data = await response.json();

    if (!response.ok || !data.id) {
        throw new Error(paypalErrorMessage(
            data,
            "Could not create a PayPal Sandbox order."
        ));
    }

    return data;
}

async function captureOrder(orderId) {
    const { response, data } = await paypalRequest(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        { method: "POST", body: {} }
    );

    if (!response.ok) {
        const failure = safePaypalFailure(response, data);
        logPaypalFailure("capture", failure);

        const error = new Error(paypalErrorMessage(
            data,
            "Could not capture the PayPal Sandbox order."
        ));
        error.paypal = failure;
        error.paypalName = failure.issue || failure.name || "";
        throw error;
    }

    return data;
}

async function getOrder(orderId) {
    const { response, data } = await paypalRequest(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}`
    );

    if (!response.ok) {
        const failure = safePaypalFailure(response, data);
        logPaypalFailure("order lookup", failure);

        const error = new Error(paypalErrorMessage(
            data,
            "Could not load the PayPal Sandbox order."
        ));
        error.paypal = failure;
        throw error;
    }

    return data;
}

function readCapture(order) {
    const units = Array.isArray(order?.purchase_units)
        ? order.purchase_units
        : [];

    for (const unit of units) {
        const captures = unit?.payments?.captures || [];

        for (const capture of captures) {
            return {
                captureId: capture.id || null,
                status: String(capture.status || "").toUpperCase(),
                currency: String(capture.amount?.currency_code || "").toUpperCase(),
                amountCents: centsFromPayPalValue(capture.amount?.value),
                customId: unit.custom_id || null
            };
        }
    }

    return null;
}

function isCaptured(order) {
    const capture = readCapture(order);
    return Boolean(capture && capture.status === "COMPLETED");
}

function orderStatus(order) {
    return String(order?.status || "").toUpperCase();
}

function needsBuyerApproval(order) {
    const status = orderStatus(order);
    return status === "CREATED" || status === "PAYER_ACTION_REQUIRED";
}

module.exports = {
    paypalEnabled,
    createOrder,
    captureOrder,
    getOrder,
    readCapture,
    isCaptured,
    orderStatus,
    needsBuyerApproval
};
