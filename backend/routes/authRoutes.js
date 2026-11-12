
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../database/db");
const authenticateUser = require("../middleware/authMiddleware");

const router = express.Router();

// ==========================================
// AUTH COOKIE
// ==========================================

function setAuthCookie(res, token) {
    res.cookie("authToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
    });
}

// ==========================================
// REGISTER
// ==========================================

router.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            !/^[a-zA-Z0-9_]{3,25}$/.test(username) ||
            typeof password !== "string" ||
            password.length < 10 ||
            password.length > 72
        ) {
            return res.status(400).json({
                success: false,
                message: "Username must be 3–25 letters, numbers or underscores. Password must be at least 10 characters."
            });
        }

        const existingUser = db.prepare(`
            SELECT id FROM users WHERE username = ?
        `).get(username);

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "That username is already registered."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = db.prepare(`
            INSERT INTO users (username, password_hash)
            VALUES (?, ?)
        `).run(username, passwordHash);

        const user = {
            id: Number(result.lastInsertRowid),
            username
        };

        const token = jwt.sign(
            user,
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        setAuthCookie(res, token);

        res.status(201).json({
            success: true,
            message: "Account created successfully!",
            user
        });

    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).json({
            success: false,
            message: "Could not create account."
        });
    }
});

// ==========================================
// LOGIN
// ==========================================

router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter your username and password."
            });
        }

        const user = db.prepare(`
            SELECT id, username, password_hash
            FROM users
            WHERE username = ?
        `).get(username);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Incorrect username or password."
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: "Incorrect username or password."
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username
            },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        setAuthCookie(res, token);

        res.json({
            success: true,
            message: "Login successful!",
            user: {
                id: user.id,
                username: user.username
            }
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Could not log in."
        });
    }
});

// ==========================================
// CHECK CURRENT LOGIN
// ==========================================

router.get("/me", authenticateUser, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// ==========================================
// LOGOUT
// ==========================================

router.post("/logout", (req, res) => {
    res.clearCookie("authToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    });

    res.json({
        success: true,
        message: "Logged out successfully."
    });
});

module.exports = router;
