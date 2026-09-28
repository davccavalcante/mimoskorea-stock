# Audit data

Snapshot of the public catalog of https://mimoskorea.com.br captured on **2026-09-28**.

## How it was captured

The audit sandbox could not reach the store directly (its outbound proxy
answered `403` for `mimoskorea.com.br`). All public endpoints were therefore
fetched through the Exa fetch service, which requests the URL from its own
servers and returns the body. `audit/scripts/extract_exa_payloads.py` split the
Exa responses back into JSON.

For future snapshots from a machine with normal internet access, use
`audit/scripts/collect_public_catalog.py`, which calls the same endpoints
directly and writes the same files.

## Known limitation of this snapshot

Exa strips **opening** HTML tags (`<p>`, `<strong>`, `<table>`, `<img ...>`) from
the bodies it returns, while closing tags written as `<\/p>` inside JSON strings
survive. Consequences:

- Description **text** is complete; description **markup** is not. Do not use
  this snapshot to judge HTML structure (tables, lists, inline images).
- `price_html` fields are also missing their opening tags.

Everything else (IDs, dates, prices, SKUs, stock, taxonomies, image records,
media parents) is structured JSON and is unaffected.

## raw/

| File | Endpoint | Records |
|---|---|---|
| `store_products.json` | `/wp-json/wc/store/v1/products?per_page=50&page=1..3` | 103 |
| `wp_products.json` | `/wp-json/wp/v2/product?per_page=100&_fields=...` | 103 |
| `wp_media.json` | `/wp-json/wp/v2/media?per_page=100&page=1..3&_fields=...` | 195 |
| `wp_pages.json` | `/wp-json/wp/v2/pages?per_page=100` | 10 |
| `product_categories.json` | `/wp-json/wp/v2/product_cat?hide_empty=false` | 24 |
| `product_tags.json` | `/wp-json/wp/v2/product_tag?hide_empty=false&page=1..3` | 221 |
| `product_brands.json` | `/wp-json/wp/v2/product_brand?hide_empty=false` | 23 |
| `media_total_probe.json` | `/wp-json/wp/v2/media?per_page=1&page=N` (page 204 valid, 205 invalid) | total 204 |
| `id_probe.json` | `/wp-json/wp/v2/product/{id}` and `/wp-json/wp/v2/media/{id}` status codes for every unknown ID | see file |

Notes:

- The Store API omits the store's default category (id 15, "Ofertas Mimos")
  from each product's `categories`; `wp_products.json` (`product_cat`) has the
  complete list and is used as the source of truth.
- Media listing returned 195 records although 204 exist: the REST API hides
  attachments whose parent product is not public (draft, pending, private,
  trash). That difference is itself evidence of hidden products.

## derived/

Produced by `python3 audit/scripts/analyze_catalog.py` (deterministic, stdlib only)
plus the multi-agent review results merged by the report build.

| File | Content |
|---|---|
| `product_scorecard.csv` / `.json` | one row per published product with completeness and quality metrics |
| `duplicate_candidates.json` | heuristic candidate pairs and clusters (verified in the report) |
| `variant_families.json` | heuristic groups of simple products that should be one variable product |
| `taxonomy_audit.json` | categories, tags and brands health |
| `media_audit.json` | media library health, one row per public attachment |
| `summary.json` | headline numbers |
