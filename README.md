# Saffron House — Restaurant Platform

A full-stack restaurant platform (static frontend + Express API + SQLite) with:

- Public storefront: menu, product pages, cart & checkout, reservations, contact, tracking, customer accounts
- Admin panel: POS, orders, kitchen screen, billing, menu/catalog, inventory, recipes, suppliers, expenses, reports, staff, settings
- Demo card payment option ("demo") for online orders

## Requirements

- **Node.js ≥ 22.13** (uses the built-in `node:sqlite` module)
- No C compiler required — SQLite is built into Node

## Local setup

```bash
npm install
npm run seed   # optional: rebuild the demo dataset (default admin included)
npm start      # http://localhost:3001
```

The database is a SQLite file at `database/restaurant.db` (no server needed).

### Demo accounts (after seeding)

| Role    | Email                     | Password    |
|---------|---------------------------|-------------|
| Admin   | admin@saffronhouse.pk     | admin123    |
| Manager | manager@saffronhouse.pk   | manager123  |
| Customer| customer@example.com      | customer123 |

## Deploying to Vercel

The repo ships with `vercel.json` — just import it into Vercel (`vercel` CLI or dashboard).

How it works:

- `server.js` is deployed as a serverless function for every `/api/*` and `/uploads/*` request
- Everything else is served statically from `frontend/`
- Because Vercel's filesystem is read-only/ephemeral, the SQLite database is copied into
  `/tmp` on each serverless instance and persists for that instance only. Data resets
  between deploys and cold starts — this is a demo-friendly configuration.

### Optional environment variables

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Secret for session cookie signing (set a strong random value in production) |
| `DB_PATH` | Override the SQLite file location |

### Notes for the Vercel demo build

- Uploaded images are stored **in the database** (no writable disk) and served from `/uploads/<name>`
- **Database restore** (`/api/admin/restore`) is disabled serverless
- Sessions are stored in the database, so logins survive instance swaps
