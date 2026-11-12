# SplitSmart AI

SplitSmart AI splits group expenses, keeps an integer-cent ledger, and collects PayPal Sandbox settlements after verified capture.

The app is Node.js, Express 5, better-sqlite3, a static frontend, JWT httpOnly cookies, and PayPal Sandbox only.

## Local setup

1. Copy `.env.example` to `.env` and fill in your own secrets. Never commit `.env`.
2. Install Node.js 20 or newer.
3. From `splitsmart-ai`:

```bash
npm install
npm start
```

The server listens on `PORT`, default `3000`. Open http://localhost:3000.

## Environment variables

| Name | Purpose |
| --- | --- |
| `PORT` | HTTP port. Render sets this automatically. |
| `NODE_ENV` | `development` or `production`. Production cookies are HTTPS-only. |
| `JWT_SECRET` | Required private signing secret. |
| `DATABASE_PATH` | Optional SQLite file path. Use a persistent disk in production. |
| `PAYPAL_MODE` | Must stay `sandbox`. |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal Sandbox REST credentials. Server-side only. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Optional Finny model. The ledger answers if Gemini is unavailable. |
| `ELASTICSEARCH_URL` / `ELASTICSEARCH_API_KEY` | Optional Elastic Cloud or cluster credentials. Search falls back to SQLite. |

## Sponsor technologies

- **Elasticsearch** uses the official `@elastic/elasticsearch` client for expenses, merchants, groups, and transactions. SQLite remains the financial source of truth. Search never changes balances.
- **AG Grid Community 36.3.0** powers the dashboard Expense Explorer, the Expenses history table, and settlement history. No Enterprise features.
- **PayPal** checkout is the existing Sandbox integration. The APIMatic PayPal Context Plugin is a Cursor development-time skill pack, not a runtime dependency.
- **Postman** examples live in `docs/postman/SplitSmart-AI.postman_collection.json`. They contain placeholders only.

## GitHub

Do not commit `.env`, SQLite databases, logs, or `node_modules`. Review the staged files before the first push.

## Render

This project uses `better-sqlite3`. Render's default filesystem is ephemeral, so a redeploy would lose the database unless a **persistent disk** is mounted.

Recommended Render settings:

- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`
- Disk: mount `/var/data`
- `DATABASE_PATH=/var/data/splitsmart.db`
- `NODE_ENV=production`
- Copy the existing `backend/database/splitsmart.db` onto the disk before going live if you need current data. Do not migrate to PostgreSQL unless you later choose a multi-instance database.

A PostgreSQL migration is not required for a single web service with a persistent disk. It would be required only if you run multiple instances or need managed backups beyond the disk.

## License

MIT
