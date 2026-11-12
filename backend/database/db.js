const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const databasePath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(__dirname, "splitsmart.db");

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(
    path.join(__dirname, "schema.sql"),
    "utf8"
);

// Create all tables
db.exec(schema);

// Safely add is_active to existing databases
const memberColumns = db
    .prepare("PRAGMA table_info(members)")
    .all();

const hasActiveColumn = memberColumns.some(
    column => column.name === "is_active"
);

if (!hasActiveColumn) {
    db.exec(`
        ALTER TABLE members
        ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
    `);

    console.log("Member active-status column added successfully!");
}

function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();

    if (!columns.some(item => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

addColumnIfMissing("payments", "currency", "TEXT NOT NULL DEFAULT 'USD'");
addColumnIfMissing("payments", "paypal_capture_id", "TEXT");
addColumnIfMissing("payments", "updated_at", "TEXT");
addColumnIfMissing("payments", "captured_at", "TEXT");
addColumnIfMissing("payment_requests", "recipient_user_id", "INTEGER");
addColumnIfMissing("payment_requests", "receipt_number", "TEXT");
addColumnIfMissing("payment_notifications", "message", "TEXT");

db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_order_unique
    ON payments(paypal_order_id)
    WHERE paypal_order_id IS NOT NULL
`);

console.log("Database connected successfully!");
console.log("SplitSmart AI database is ready!");

module.exports = db;
