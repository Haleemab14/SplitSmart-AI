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

## Render Free demo

This demo is temporary. `npm start` runs `node backend/server.js` and listens on Render's `PORT`. In production the process reads Render's environment only and does not load a `.env` file.

On boot, with `DATABASE_PATH` unset, the app creates a new empty SQLite file at `backend/database/splitsmart.db` on that instance. Schema setup inserts no accounts, expenses, or payments. The local database is gitignored and must stay on this machine. Do not upload it to GitHub or Render.

Render Free storage is ephemeral. A restart or redeploy discards the demo database and creates another empty one.

Set these in the Render dashboard:

- `NODE_ENV=production`
- `JWT_SECRET`: a private random value of at least 32 characters. The server reads only the environment value and refuses known placeholders.
- `PAYPAL_MODE=sandbox`. Any other mode stops the process. Live payments are not available.
- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: optional Sandbox credentials. Leave both empty to run without checkout.
- Leave `GEMINI_API_KEY`, `GEMINI_MODEL`, `ELASTICSEARCH_URL`, and `ELASTICSEARCH_API_KEY` unset. Finny answers from the ledger, and search uses SQLite.

Render sets `RENDER_EXTERNAL_URL` to the service's HTTPS address. Finny and Pay Now send PayPal Sandbox back to that address. Health check: `/api/health`.

## License

MIT
