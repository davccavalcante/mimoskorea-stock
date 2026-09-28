# mimoskorea-stock

Tooling and documentation for cleaning up and governing the product catalog and
inventory of the Mimos Korea Design WooCommerce store
(https://mimoskorea.com.br).

## Status

| Part | State |
|---|---|
| 1. Audit of the current catalog (public data) | done, see [`audit/`](audit/) |
| 2. Admin-side diagnostics (database, drafts, trash, orders) | pending access, queries ready in [`audit/sql/diagnostics.sql`](audit/sql/diagnostics.sql) |
| 3. Mimos Catalog Studio (AI product registration) | working in test mode, see [`studio/`](studio/) |
| 4. Local staging store (WordPress + WooCommerce + MariaDB) | working, see [`staging/`](staging/) |
| 5. Connection to the production store | pending credentials |

## Layout

```
audit/     catalog audit: report, data snapshots, analysis scripts, SQL diagnostics
studio/    Mimos Catalog Studio (Next.js): name + link + stock -> researched, verified listing -> WooCommerce
staging/   disposable WordPress + WooCommerce + MariaDB mirror of the catalog for testing
```

## Quick start

```bash
# 1. test store (Docker)
cd staging && ./setup.sh

# 2. studio in test mode (mock AI, real staging store)
cd ../studio && npm install && npm run build && npm run start
# open http://localhost:3000
```

For real AI research, fill `studio/.env.local` with the Gemini, Tavily and Exa keys and set
`STUDIO_PROVIDERS=live` (see [`studio/README.md`](studio/README.md)).
