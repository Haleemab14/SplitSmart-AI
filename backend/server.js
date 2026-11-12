
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

if (process.env.NODE_ENV !== "production") {
    require("dotenv").config({
        path: path.join(__dirname, "../.env"),
        override: false
    });
}

const BLOCKED_JWT_SECRETS = new Set([
    "your_long_random_secret_here",
    "replace_with_a_long_random_secret",
    "changeme",
    "change_me",
    "secret",
    "password",
    "jwt_secret"
]);

function assertJwtSecret() {
    const secret = process.env.JWT_SECRET;
    const normalized = typeof secret === "string" ? secret.trim().toLowerCase() : "";

    if (!secret || BLOCKED_JWT_SECRETS.has(normalized)) {
        throw new Error("Set a private JWT_SECRET in the environment. SplitSmart AI does not provide a fallback secret.");
    }

    if (process.env.NODE_ENV === "production" && secret.trim().length < 32) {
        throw new Error("Set a private JWT_SECRET in the environment. SplitSmart AI does not provide a fallback secret.");
    }
}

function assertPaypalSandbox() {
    const mode = String(process.env.PAYPAL_MODE || "sandbox").trim().toLowerCase();

    if (mode !== "sandbox") {
        throw new Error("SplitSmart only accepts PayPal Sandbox mode.");
    }
}

assertJwtSecret();
assertPaypalSandbox();

const db = require("./database/db");
const authenticateUser = require("./middleware/authMiddleware");
const { elasticConfigured } = require("./config/elastic");
const { geminiConfigured } = require("./services/finnyAi");
const paypal = require("./services/paypalService");

const authRoutes = require("./routes/authRoutes");
const groupRoutes = require("./routes/groupRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const groupManagementRoutes = require("./routes/groupManagementRoutes");
const balanceRoutes = require("./routes/balanceRoutes");
const assistantRoutes = require("./routes/assistantRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const personalExpenseRoutes = require("./routes/personalExpenseRoutes");
const receiptRoutes = require("./routes/receiptRoutes");
const memberIdentityRoutes = require("./routes/memberIdentityRoutes");
const paymentRoutes = require("./routes/payments");
const paymentRequestRoutes = require("./routes/paymentRequestRoutes");
const searchRoutes = require("./routes/searchRoutes");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, "../frontend"), {
    setHeaders(res, filePath) {
        if (/\.(html|js|css)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
        }
    }
}));

app.use("/api/auth", authRoutes);

app.get("/api/health", (req, res) => {
    let database = false;

    try {
        database = Boolean(db.prepare("SELECT 1 AS ok").get());
    } catch (error) {
        database = false;
    }

    res.json({
        success: true,
        service: "splitsmart-ai",
        message: "SplitSmart AI backend is running!",
        database,
        elasticsearch: elasticConfigured,
        gemini: geminiConfigured(),
        paypalSandbox: paypal.paypalEnabled(),
        time: new Date().toISOString()
    });
});

app.use("/api", authenticateUser);
app.use("/api/groups", memberIdentityRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api", groupManagementRoutes);
app.use("/api/groups", expenseRoutes);
app.use("/api/groups", receiptRoutes);
app.use("/api/groups", balanceRoutes);
app.use("/api/groups", assistantRoutes);
app.use("/api/groups", analyticsRoutes);
app.use("/api/personal-expenses", personalExpenseRoutes);
app.use("/api", paymentRequestRoutes);
app.use("/api", paymentRoutes);
app.use("/api", searchRoutes);

app.use((error, req, res, next) => {
    console.error(error.message || "Unhandled server error.");

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === "production"
            ? "Something went wrong."
            : (error.message || "Something went wrong.")
    });
});

app.listen(PORT, () => {
    console.log(`SplitSmart AI server running on http://localhost:${PORT}`);
});
