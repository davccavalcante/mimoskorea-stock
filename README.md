# mimoskorea-stock

Tooling and documentation for cleaning up and governing the product catalog and
inventory of the Mimos Korea Design WooCommerce store
(https://mimoskorea.com.br).

## Status

| Phase | State |
|---|---|
| 1. Audit of the current catalog (public data) | done, see [`audit/AUDIT_REPORT.md`](audit/AUDIT_REPORT.md) |
| 2. Admin-side diagnostics (database, drafts, trash, orders) | pending access, queries ready in [`audit/sql/diagnostics.sql`](audit/sql/diagnostics.sql) |
| 3. Solution design and implementation | not started |

## Layout

```
audit/
  AUDIT_REPORT.md              full audit report (findings, evidence, priorities)
  data/
    README.md                  how the snapshot was captured and its limits
    raw/                       public API snapshots (2026-09-28)
    derived/                   per-product scorecard, duplicates, taxonomy, media, id space, reviews
  scripts/
    collect_public_catalog.py  re-collect the public snapshot over HTTP (stdlib only)
    extract_exa_payloads.py    helper used for the first snapshot (captured via Exa)
    analyze_catalog.py         deterministic metrics -> audit/data/derived
  sql/
    diagnostics.sql            read-only MariaDB queries to close the gaps public data cannot see
```

## Reproduce the metrics

```bash
python3 audit/scripts/collect_public_catalog.py   # needs direct access to mimoskorea.com.br
python3 audit/scripts/analyze_catalog.py
```
