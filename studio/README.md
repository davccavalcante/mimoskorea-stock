# Mimos Catalog Studio

Registers products in the Mimos Korea WooCommerce store with almost no human
typing. The operator enters only three things:

1. the product name,
2. one reference link (Mercado Livre, Amazon, Shopee, manufacturer...),
3. the quantity in stock.

The studio then researches the product on the web, writes a professional
Brazilian Portuguese listing, verifies every fact against its source, treats
the photos, checks whether the product already exists in the store, and shows
a read-only preview. One click on **Sincronizar** sends it to WooCommerce.

It was designed from the findings of the catalogue audit (`../audit/`):
duplicated listings created instead of restocking, AI text full of emoji,
missing nutrition/alcohol/material information, images copied with junk
names, shared SKUs and hidden drafts.

## How it works

```
operator: name + link + stock
        |
        v
 1. Reference   Tavily/Exa extract the reference page
 2. Identify    Gemini: exact brand, line, variant, size, kind, search queries
 3. Research    Tavily + Exa search (pt-BR, English, native language), ranked,
                each source tagged "mentions the exact variant: yes/no"
 4. Write       Gemini writes copy + structured facts, each fact with a
                verbatim quote from a cited source
                -> deterministic verification (quote must exist in the source,
                   numbers must match, variant-sensitive facts must come from a
                   page about the same flavour/size, EAN check digit)
                -> deterministic HTML (sections, specs table, nutrition table,
                   legal notices), emoji and store name stripped, HTML allowlist
 5. Images      download (SSRF-safe) -> dedupe (perceptual hash) -> Gemini
                vision picks the exact product without overlays -> sharp:
                trim, white square canvas, gentle colour correction, sharpen,
                WebP, SEO file name, alt text
 6. Duplicates  search the store (all statuses) by SKU, EAN, name and the
                operator's typed name
                -> "match" forces UPDATE of the existing product (stock,
                   content, photos; URL and SKU kept); several matches ask
                   which one; "possible" asks the operator; "none" allows CREATE
        |
        v
 review screen (read-only)  ->  Sincronizar  ->  duplicate re-check against
                                                 the live store  ->  WooCommerce
```

Rules enforced by the system, not by the operator:

| Rule | Where |
|---|---|
| No emoji, no store name, no pipes or keyword lists in titles | `src/lib/text/normalize.ts` |
| A fact is published only if its quoted evidence exists in the cited source | `src/lib/pipeline/verify.ts` |
| Alcohol: official warnings are fixed text; ABV is mandatory | `src/lib/pipeline/compliance.ts` |
| Required information per product kind (food, alcohol, toy, bag...) | `src/lib/pipeline/compliance.ts` |
| Same product cannot be created twice | `src/lib/pipeline/duplicates.ts`, `sync.ts` |
| New products have no price, so they go to WooCommerce as **pending** for the owner | `src/lib/pipeline/sync.ts` |
| Incomplete listings never publish themselves | `src/lib/pipeline/sync.ts` |
| A live product is never overwritten by an incomplete listing (stock only) | `src/lib/pipeline/plan.ts` |
| The confirmation dialog and the server use the same plan function | `src/lib/pipeline/plan.ts` |
| Free text cannot carry unverified numbers, contact data, prices or promotions | `src/lib/pipeline/prose.ts` |
| Barcode only from a verified fact; a new brand term only if the sources name it | `src/lib/pipeline/write.ts` |
| Soju, beer, wine... are always treated as alcohol (18+), whatever the AI says | `src/lib/pipeline/compliance.ts` |
| The store is re-checked right before sync; syncs run one at a time | `src/lib/jobs/runner.ts` |
| Mock (demo) content can never be sent to a non-local store | `src/lib/jobs/runner.ts` |
| Every job is kept as an audit trail (inputs, sources, output, sync result) | `.data/jobs/*.json`, `/historico` |

## Stack

Next.js 16.3 (App Router, Turbopack) · React 19.3 · TypeScript 7 · Tailwind CSS 4.3 ·
Radix UI · Motion 13 · Phosphor Icons · Biome 2.5 · Zod 4 · `@google/genai` 2.x
(Gemini Interactions API, `gemini-3.8-flash`) · Tavily and Exa over REST · sharp ·
Vitest 5 · Playwright.

## Setup

Requirements: Node.js 22.19 or newer.

```bash
cd studio
npm install
cp .env.example .env.local     # then fill in the keys
npm run dev                    # http://localhost:3000
```

Production:

```bash
npm run build
npm run start                  # or: PORT=3000 npm run start
```

### Keys and credentials (`.env.local`)

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `TAVILY_API_KEY` | https://app.tavily.com |
| `EXA_API_KEY` | https://dashboard.exa.ai |
| `WC_BASE_URL` | the store URL, e.g. `https://mimoskorea.com.br` |
| `WP_USERNAME` / `WP_APPLICATION_PASSWORD` | wp-admin > Users > Profile > Application Passwords |

Set `STUDIO_PROVIDERS=live` to use the real AI and search providers.
With `STUDIO_PROVIDERS=mock` everything runs offline with fixtures (used by the tests).

WordPress requirements: pretty permalinks enabled (Settings > Permalinks),
HTTPS in production (Application Passwords are disabled on plain HTTP unless the
site is a local environment), WooCommerce stock management enabled.

### Security without a login screen

There is no login screen by design. The app protects itself in layers
(`src/proxy.ts`):

1. **Host allowlist** (`STUDIO_ALLOWED_HOSTS`, default `localhost,127.0.0.1,[::1]`).
   When other computers on the network open the studio, add the machine name or
   IP, e.g. `STUDIO_ALLOWED_HOSTS=localhost,estoque.local,192.168.0.20`.
2. **Same-origin writes**: registrations and syncs are accepted only from the
   studio's own pages (blocks other websites open in the same browser).
3. **JSON-only API writes**.
4. Optional browser password: `STUDIO_BASIC_AUTH=user:password`.

Image downloads are protected against SSRF and DNS rebinding (the address is
checked again at connection time, including IPv6 forms such as NAT64 and 6to4),
and oversized or non-image files are refused.

Paid quotas are protected too: at most `STUDIO_MAX_CONCURRENT_JOBS` registrations
are researched at the same time and `STUDIO_MAX_JOBS_PER_MINUTE` can start per minute.

## Test environment

A disposable WordPress + WooCommerce + MariaDB store that mirrors the production
catalogue lives in `../staging` (see its README). With it running:

```bash
npm run check          # Biome + TypeScript
npm test               # unit + integration (mock providers, in-memory store)
npm run test:staging   # + real WooCommerce REST tests against the staging store
npm run build && npm run test:e2e   # browser tests: form -> review -> sync
```

## Project layout

```
src/
  app/                  pages (/, /historico) and API routes (/api/jobs, /api/media, /api/health)
  components/           UI (form, progress, review, sync dialog, done)
  lib/
    env.ts              environment schema (all settings documented)
    types.ts            shared types and Zod schemas
    jobs/               file-backed job store, pipeline runner, public view
    pipeline/           identify, research, write, verify, compose, compliance, images, duplicates, sync, prompts
    providers/          Gemini, Tavily, Exa, WooCommerce, mocks
    text/               emoji/title rules, HTML safety, similarity
    net/                HTTP with retries, SSRF guard
tests/                  unit, integration, e2e
```
