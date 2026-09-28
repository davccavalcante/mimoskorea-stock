# Mimos Korea Design: Catalogue Audit Report

| | |
|---|---|
| Store | https://mimoskorea.com.br (WooCommerce) |
| Snapshot date | 2026-09-28 |
| Scope | The public catalogue: 103 published products, 195 public images, 24 categories, 221 tags, 23 brands, 10 pages |
| Data | `audit/data/` (raw snapshots and derived files, see Appendix B) |
| Readers | The store owner (sections 1, 4, 13, 14) and the developer (all sections) |

How to read this report:

- Section 1 is one page. It lists the 10 most important findings.
- Every section starts with **In short**. You can read only those parts first.
- Numbers are written as "X of Y". Example: "59 of 59" means "all 59".
- Product numbers (like 235) are WooCommerce product IDs. You find them in wp-admin under Products.

---

## 1. Executive summary

**In short**

- The shop shows 103 products. **Every one has a description and at least one photo.** The real problem is wrong, copied and incomplete information, not empty pages.
- Old products are not restocked. New copies are created instead. This makes duplicates and loses the good data of the old records.
- The 59 products made in 2026 have no SKU and no attributes (product facts). The 44 products made in 2025 had both.
- A few listings can hurt customers or break rules. The most urgent one is a wheat cake sold as "Sem Glúten".
- The database also holds 69 hidden products and 9 hidden images that nobody has reviewed yet.

### Top 10 findings

| # | Finding | Severity | Key numbers | Section |
|---|---|---|---|---|
| 1 | Two Choco Pie listings say "Sem Glúten", but their own data says "Contém glúten" and "Farinha de trigo". Both are in stock. | Critical | 2 products (70, 259) | 6, 12 |
| 2 | Restock by re-creation: the same item is listed 2 or 3 times, with different prices, stock and weights. | Critical | 4 verified groups, 10 listings (6 extra copies) | 4 |
| 3 | Soju (alcohol) listings made in 2026 show no alcohol content and no 18+ notice. One soju costs R$ 0,00 and is in stock. | Critical | 10 of 13 soju listings; product 156 | 7, 10 |
| 4 | Text copied between flavours states wrong facts: other flavours, wrong product line, wrong colour, "Zero Açúcar" with added sugar. | High | 41 single-flavour listings list flavours they do not sell | 6 |
| 5 | Food and drink listings miss legally expected information. | High | 0 of 87 food and drink listings show a nutrition table; 0 of 103 show shelf life | 7 |
| 6 | Two "eras" of data quality. The 2026 products lost SKU, brand, attributes and short descriptions. | High | SKU: 44 of 44 (2025) vs 0 of 59 (2026) | 3, 10 |
| 7 | Shared SKUs: several flavours use one SKU. This fits a "clone the product" workflow. | High | 6 SKUs on 23 products | 4, 10 |
| 8 | Images come from marketplaces, AI tools, screenshots and a "40% de DESCONTO" banner. No image has alt text. | High | Banner on 18 products; AI images on 16; alt text empty on 195 of 195 files | 8 |
| 9 | Hidden records: products and images that the public cannot see but that still live in the database. | High | 69 hidden products, 9 hidden images | 5 |
| 10 | All of the above flows into Google and Meta catalogues through the active sales-channel plugins. | High | 2 channel plugins active; 13 alcohol listings, 20 products with promo-banner images, 49 products without brand | 12 |

Also important:

- "Ofertas Mimos" holds 64 of 103 products, but 0 of 103 products are on sale (section 9).
- Shipping data is wrong on many items. 33 products use a 5 x 5 x 10 cm placeholder box, including 6 backpacks of 25 to 29 litres (section 10).
- The public REST API lists the site's 2 user accounts. This should be restricted (section 11).

### What to do first

1. Make a full backup (files and database). Test that it restores.
2. Fix the safety items today: remove "Sem Glúten" from 70 and 259, set a price on 156 or hide it, and fix "Zero Açúcar" on 64 and 66.
3. Merge the verified duplicates (section 4). Keep the oldest URL. Redirect the others.
4. Run the read-only SQL queries in `audit/sql/diagnostics.sql` on the backup. They show what the public data cannot.
5. From now on, create and restock products only through Mimos Catalog Studio (section 14b). It blocks duplicates and invented facts.

### What already works

- The 44 products from 2025 have a SKU, a brand, attributes and descriptive image names.
- All 58 images uploaded in 2025 use WebP and descriptive file names.
- The legal pages publish the company's legal name, CNPJ and address. The 7-day withdrawal right is stated.
- No product page is empty. The shortest description has 71 words.

---

## 2. Scope, method and access limits

**In short**

- We used only public data. We had no wp-admin, database, order or Merchant Center access.
- Every number in this report was recomputed with Python from the saved data files.
- AI reviewer agents gave leads. We kept only what the data supports.

### 2.1 How the data was captured

The audit sandbox could not reach the store directly (its proxy answered 403). All public endpoints were fetched through the Exa fetch service and saved as JSON on 2026-09-28. Details are in `audit/data/README.md`.

| Data | Endpoint | Records |
|---|---|---|
| Products (Store API) | `/wp-json/wc/store/v1/products` | 103 |
| Products (WordPress API) | `/wp-json/wp/v2/product` | 103 |
| Images | `/wp-json/wp/v2/media` | 195 |
| Pages | `/wp-json/wp/v2/pages` | 10 |
| Categories, tags, brands | `/wp-json/wp/v2/product_cat`, `product_tag`, `product_brand` | 24, 221, 23 |
| Image total probe | `/wp-json/wp/v2/media?per_page=1&page=N` | 204 in total |
| ID probe | `/wp-json/wp/v2/product/{id}` and `/media/{id}` for IDs 1 to 1054 | 1054 IDs |

The ID probe reads HTTP status codes. A published product answers 200. A hidden product (draft, pending, private, trash or auto-draft) answers 401. Any other ID answers 404.

### 2.2 Known limits

- **HTML markup.** Exa removed opening HTML tags. Description text is complete, but tables and lists could not be judged.
- **Hidden records.** A 401 answer does not say if a product is a draft, private or in the trash. Permanently deleted posts answer 404, like any non-product ID.
- **Images.** Images were judged by file name only. No pixels, sizes or embedded metadata were checked.
- **Physical labels.** Real ingredients, allergens, nutrition, origin and barcodes need the packages.
- **Admin data.** Orders, stock quantities, authors, revisions, plugin list and sync status are not public.
- **Two observations are not stored in `audit/data/raw/`.** The REST namespace list (`/wp-json/`) and the users endpoint were checked by the lead auditor on 2026-09-28. Future snapshots should save them too.

### 2.3 Agent reviews used as leads

| Input | What it is |
|---|---|
| `product_reviews.json` | 8 reviewer agents, 13 products each, one structured review per product (103) |
| `duplicate_verification.json` | 2 independent verifiers: a data-integrity lens and a shopper lens |
| `storefront_findings.json` | Crawl of the live storefront (53 URLs) |
| `external_index_findings.json` | Search-index and marketplace footprint (60 URLs) |
| `regulatory_matrix.json` | Brazilian requirements per product kind, with source links |
| `channel_feed_findings.json` | Google Merchant Center and Meta catalogue rules (40 URLs) |
| `completeness_critic.json` | A critic that listed gaps and contradictions between agents |

### 2.4 Data notes (discrepancies and rejected claims)

Where an agent claim and the data disagree, this report follows the data.

| Agent claim | What the data shows | Used in report |
|---|---|---|
| "11 newer soju listings lack ABV" (channel agent) | 10 newer soju listings: 810, 813, 815, 817, 819, 822, 825, 827, 829, 831 | 10 |
| "5 SKUs shared by 17 listings" (one batch reviewer) | 6 SKUs shared by 23 products; the count left out Milkis | 6 SKUs, 23 products |
| "12 of 13 out of stock" and "every product has exactly one image" (batch reviewers) | True only inside one batch. Catalogue-wide: 41 of 103 out of stock; 46 of 103 have one image | Catalogue-wide numbers |
| "70 and 259 share the same first image file" (critic) | Different files: 258 "...chocolate-duplo-com-marshmallow" and 260 "...chocolate-original". Different original slugs. They are two flavours. | Not a verified duplicate (4.3) |
| "None of the 86 food and drink products has a nutrition table" (channel agent) | Correct that none has a table. By product kind there are 87 food and drink listings. | 0 of 87 |
| `summary.json` says 21 products have "nutrition_facts" | The check matches the word "kcal". All 21 are estimates like "Cerca de 150 kcal por pacote". None is a nutrition table. | 21 calorie estimates, 0 tables |
| "Sinomie line campeã de vendas" (index agent) | No order data supports this. Only a third-party marketplace ranking was seen. | Dropped |
| "False low-calorie claims at 467 to 526 kcal/100g" (reviewers) | The kcal values come from the store's own estimated attributes, not from labels. | "baixa caloria" is reported as unsupported, without kcal/100g figures |
| "One 'lichia' image on a soju and on juices" | 3 separate uploads with the same file name (816, 853, 861) within 77 minutes. The files may or may not be the same photo. | Needs a visual check (8.3) |
| Probe totals "755 vs 746" and "24 IDs never probed" (critic) | Resolved: `id_space.json` classifies each of the 1054 IDs exactly once. The 24 IDs are the 10 public pages and 14 known public images. | Final counts |
| Image-class totals in the storefront findings (60 junk, 34 Shopee, 27 AI...) | Those count image uses per product. Per file, `media_audit.json` gives 54 junk, 22 Shopee, 24 AI, 15 promo. | File counts (8.1) |
| "Mamadeira" is a Mercado Livre classification error (index agent) | The store's own titles for 833, 838 and 840 start with "Mamadeira Chuyin". | Reported as a store naming issue |

---

## 3. How the catalogue got here

**In short**

- WordPress gives every object (product, image, page, order, revision, menu item) a number from **one shared counter**. Gaps between product numbers are normal. They are not damage.
- **Never renumber IDs.** Links, orders, images, Google and Meta all point to these numbers.
- The real problems are hidden duplicates, orphans and data that drifted apart. They are measured below.

### 3.1 Why the IDs have gaps

The store has 103 published products, but their IDs run from 64 to 1021. This is expected. Between two products, WordPress also used IDs for images, pages, revisions, auto-drafts ("Add new" clicks), menu items and, depending on settings, order placeholders.

The probe classified all 1054 IDs:

| Class | IDs | Meaning |
|---|---|---|
| Published product | 103 | Visible in the shop |
| Hidden product | 69 | Exists, not public (draft, pending, private, trash or auto-draft) |
| Public image | 195 | Visible in the media API |
| Hidden image | 9 | Exists, attached to a non-public post |
| Published page | 10 | Cart, checkout, legal pages and similar |
| Other type or permanently deleted | 668 | Not a product or image; type unknown from public data |
| **Total** | **1054** | |

The 668 "other" IDs need SQL query 01 (all post types) and 20 (orders) to be explained. Most are probably normal WordPress objects.

### 3.2 ID space map

| ID range | Period | Published products | Hidden products | Public images | Hidden images | Pages | Other |
|---|---|---|---|---|---|---|---|
| 1-63 | 2025-11-15, store setup | 0 | 0 | 1 | 0 | 7 | 55 |
| 64-160 | 2025-11-15, bulk import | 27 | 60 | 0 | 0 | 0 | 10 |
| 161-285 | 2025-11-15 to 19, manual additions | 17 | 4 | 37 | 5 | 3 | 59 |
| 286-357 | 2025-11-19 to 12-09 | 0 | 3 | 20 | 4 | 0 | 45 |
| 358-809 | 2025-12-09 to 2026-08-22 | 0 | 0 | 0 | 0 | 0 | 452 |
| 810-879 | 2026-08-22 batch | 25 | 0 | 43 | 0 | 0 | 2 |
| 880-1006 | 2026-09-02 batch | 29 | 0 | 81 | 0 | 0 | 17 |
| 1007-1025 | 2026-09-12 batch | 5 | 0 | 13 | 0 | 0 | 1 |
| 1026-1054 | after the last published product | 0 | 2 | 0 | 0 | 0 | 27 |
| **Total** | | **103** | **69** | **195** | **9** | **10** | **668** |

Notes:

- **The bulk import.** IDs 64 to 160 (97 IDs) were created in 16 seconds (2025-11-15 21:17:25 to 21:17:41). Only 27 of these 97 are still published. 60 are hidden products.
- **The long gap.** IDs 358 to 809 (452 IDs) were used between 2025-12-09 and 2026-08-22, but none is a public product or image. SQL queries 01 and 20 will show if they are orders, order placeholders, revisions or deleted posts.
- **After the last product.** Products 1029 and 1032 are hidden and were created after the last published product (1021, 2026-09-12).

### 3.3 Timeline

| When | What happened | Evidence |
|---|---|---|
| 2025-11-15 20:37-21:25 | Store set up: cart, checkout, account and legal pages | `wp_pages.json` |
| 2025-11-15 21:17 | Bulk import of 97 IDs in 16 seconds. 27 still published, 60 hidden | `id_space.json` |
| 2025-11-17 | Soju images uploaded for Manga, Blueberry, Maçã Verde and Iogurte. Their products no longer exist publicly | Images 220, 221, 223, 225 have no parent |
| 2025-11-18 | 12 products added by cloning (O'Star, Sac Sac, Choco Pie, O'Rice, Pepero) | Shared SKUs, image ID = product ID + 1 |
| 2025-11-19 | 5 Milkis flavours cloned, about 45 seconds apart | Creation times 12:56:09 to 12:59:21 |
| 2025-12-09 | 16 images uploaded: new plush and slipper photos, plus 8 stationery images that are now unattached | Images 341-357 |
| 2025-12-09 to 2026-08-22 | 452 IDs used, no public product or image | `id_space.json` |
| April 2026 | 30 of the 44 older products had their last edit in April 2026 | `modified` dates |
| 2026-08-22 | Batch of 25 products (soju, juices, Chuyin, a Marine Boy copy, Koony, Turtle Chips) | Creation dates |
| 2026-09-02 | Batch of 29 products (Sakuragi, O'Star copies, backpacks) | Creation dates |
| 2026-09-12 | Batch of 5 products (O'Star copies again, Custard, BongBang, Miz). Products 70 and 259 rewritten in the 2026 style | Creation and `modified` dates |
| After 2026-09-12 | Hidden products 1029 and 1032 created | ID probe |

### 3.4 Two eras of data quality

The 44 products from November 2025 and the 59 products from August and September 2026 look like they were made by two different processes.

| Measure | 2025 products (44) | 2026 products (59) |
|---|---|---|
| Has a SKU | 44 of 44 | 0 of 59 |
| Has attributes (ingredients, allergens, calories, ABV...) | 44 of 44 | 0 of 59 |
| Has a brand | 44 of 44 | 10 of 59 (only the soju, all "Lotte") |
| Has tags | 44 of 44 | 0 of 59 |
| Emoji in the description | 2 of 44 (70 and 259, rewritten in 2026) | 59 of 59 |
| Short description missing | 0 of 44 | 37 of 59 |
| At least one non-descriptive image file name | 2 of 44 (70 and 259 again) | 59 of 59 |
| In stock | 5 of 44 | 57 of 59 |
| Price ending | mostly ",90" (25) and ",99" (18) | ",99" (58 of 59) |
| Text style | One AI template ("valor agregado" in 37 of 44) | Emoji template with check-mark lists |
| Images uploaded in that year | 58 files, all WebP, all descriptive names | 137 files: 136 PNG, 1 JPEG, 4 descriptive names |
| Account that uploaded the images | user ID 1 (58 of 58) | user ID 3 (137 of 137) |

This is a process finding, not a judgement about any person. The 2026 work did not follow the structure of the 2025 import (SKU, brand, attributes, tags), and nothing in the shop required it. Section 13 explains the causes.

---

## 4. Duplicates and restock by re-creation

**In short**

- When a product sold out, a **new copy** was often created instead of adding stock to the old one.
- The old copy stays online, out of stock, with the SKU, brand and sales history. The new copy is in stock but has no SKU, no brand and different data.
- Both reviewers agree on 4 duplicate groups (10 listings). Keep the oldest listing in each group and redirect the rest.

### 4.1 Verified duplicate groups

Both verification lenses (data-integrity and shopper) agreed on these 4 groups. The data supports each one.

| Group | Listings | Keep | Remove and redirect | Main conflicts between copies |
|---|---|---|---|---|
| O'Star Queijo Duplo 30g | 235 (2025-11-18), 954 (2026-09-02), 1021 (2026-09-12) | 235 | 954, 1021 | Price R$ 12,90 vs 12,99. Stock: 235 out, 954 and 1021 in. Weight 0.03 vs 0.2 vs 0.2 kg. Box 15x10x5 vs 5x5x5 vs 5x3x6 cm. SKU only on 235. 1021's only image is named "zzz". 954 and 1021 have identical descriptions. |
| O'Star Bife Americano (NY) 30g | 237 (2025-11-18), 952 (2026-09-02), 1019 (2026-09-12) | 237 | 952, 1019 | Price R$ 12,90 vs 12,99. Stock: 237 out, 952 and 1019 in. Weight 0.03 vs 0.2 kg. Flavour named "Bife Americano", "Bife Americano NY", "Bife NY". 952 and 1019 have identical descriptions. |
| Marine Boy Camarão 30g | 150 (2025-11-15), 864 (2026-08-22) | 150 | 864 | Price R$ 12,90 vs 10,99. Stock: 150 out, 864 in. Weight 0.03 vs 0.200 kg. 864 reuses 150's own image (attachment 228). Allergen "Contém crustáceos" only on 150. 864's text says "Marine Voy". |
| Sac Sac Uva Verde | 242 (2025-11-18 21:08), 253 (2025-11-18 21:16) | 242 | 253 | Price R$ 12,90 vs 9,99. Volume 238 ml vs 240 ml in the title. 253's slug ends in "-2", which WordPress adds when a post with the same name exists. Same SKU REF-SAC-LT-238. Both out of stock. |

Why keep the oldest listing:

- It has the SKU, brand, tags and attributes.
- It has the older URL, so it has search history and inbound links.
- Its Google and Meta item IDs are based on its product ID. Keeping it keeps that history.

How to merge (details in section 14a):

1. Copy the correct price, stock and any better content to the kept listing.
2. Rewrite the text from the real label.
3. Move the copies to the trash (not permanent delete).
4. Add a 301 redirect from each copy's URL to the kept URL.

### 4.2 Why this matters

- A shopper sees the same bag of chips three times, at two prices, under three names.
- The old, out-of-stock copy keeps the "Mais Vendidos" slot on the homepage. The in-stock copy has no sales history.
- Stock and sales reports are split across records.
- Brazilian price rules treat different prices for the same item as a problem, and the consumer may claim the lowest price. This is a requirement to verify with legal counsel (Decreto 5.903/2006 art. 9 VII, https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d5903.htm).

### 4.3 Disputed pairs (need a physical check)

| Pair | For | Against | Action |
|---|---|---|---|
| 985 and 993 (black notebook backpacks) | Shopper lens (low confidence): created 2 minutes apart; image files "2" to "7" and "3 (2)" to "7 (2)" look like one photo set downloaded twice | Data-integrity lens: prices R$ 389,99 vs 249,99, different material claims, different weights, separate image files | Compare the two backpacks in the stock room |
| 70 and 259 (Choco Pie, 6-unit box) | Critic: same SKU BLN-CHP-LT-CHC, same price R$ 25,90, both in stock, similar titles | Both lenses: different flavours. Original image names and slugs say "chocolate-duplo-com-marshmallow" (70) and "chocolate-original" (259). 259 was renamed "ChocoPie Chocolate 180g" in 2026, which hides the flavour | Keep both. Give each its own SKU. Put the flavour back in 259's title. Check the maker (the listings say Orion, the brand field says Lotte) |

### 4.4 Flavours and colours stored as separate products

Both lenses agree on 24 families (79 listings) that are really one product in several flavours or colours. They are stored as unrelated "simple" products. All 103 products are of type "simple".

| Family | Listings | Varies by |
|---|---|---|
| Orion O'Star 30g | 149, 231, 233, 235, 237, 952, 954, 1019, 1021 (5 real flavours) | Flavour |
| Lotte Milkis 250ml | 67, 277, 279, 281, 283, 285 | Flavour |
| Lotte Chum-Churum soju 360ml | 154, 155, 156, 810, 813, 815, 817 | Flavour |
| Lotte Saero soju 360ml zero sugar | 819, 822, 825, 827 | Flavour |
| Lotte Pepero 47g | 68, 269, 271, 273 | Flavour |
| Yantai juice 238ml | 842, 846, 849, 852 | Flavour |
| Orion O'Rice 129g | 69, 263, 265 | Flavour |
| Lotte Sac Sac 238ml | 145, 242, 253 (253 is a duplicate) | Flavour |
| Chuyin "Mamadeira" 280ml | 833, 838, 840 | Flavour |
| Chuyin juice 500ml | 855, 858, 860 | Flavour |
| Sakuragi 4D gummy 50g | 894, 899, 902 | Flavour |
| Sakuragi gummy 70% fruit 32g | 905, 908, 910 | Flavour |
| Sakuragi mint candy 16g | 926, 932, 933 | Flavour |
| Backpack Escolar 25L | 957, 967, 968 | Colour |
| Backpack Executiva 29L | 969, 980, 981 | Colour |
| Lotte Cantata iced coffee 230ml | 64, 66 | Flavour |
| Choco Pie 6-unit box | 70, 259 | Flavour (check maker) |
| Sakuragi wafer 5 layers 110g | 941, 946 | Flavour |
| Sakuragi wafer cubes 65g | 934, 939 | Flavour |
| Sakuragi animal biscuits 130g | 919, 923 | Flavour |
| Sakuragi snack biscuits 80g | 912, 916 | Flavour |
| Orion Turtle Chips 60g | 875, 879 | Flavour |
| Orion Koony 40g | 147, 871 | Flavour (check it is the same format) |
| Orion Tok 38g | 151, 85 | Flavour and pack size |

Keep kits separate (829 Kit 6 Chum-Churum, 831 Kit 4 Saero). The heuristic in `duplicate_candidates.json` also grouped some items that are **not** duplicates (for example Sakuragi 894 vs 905, two different gummy lines). The verifiers rejected those.

Converting a family into one "variable" product gives one URL and a flavour selector. It also creates new IDs for each variation, which resets Google and Meta item IDs. Do it once, in a planned window (section 14a, step 8).

### 4.5 Shared SKUs and the clone workflow

A SKU should identify exactly one sellable item. Here, 6 SKUs are shared by 23 products.

| SKU | Products | Count |
|---|---|---|
| REF-MLK-LT-250 | 67, 277, 279, 281, 283, 285 (Milkis flavours) | 6 |
| SNK-BAT-OST-ORI-30G | 149, 231, 233, 235, 237 (O'Star flavours) | 5 |
| BSC-PPR-LT-47G | 68, 269, 271, 273 (Pepero flavours) | 4 |
| BSC-ARR-ORC-ORI-129G | 69, 263, 265 (O'Rice flavours) | 3 |
| REF-SAC-LT-238 | 145, 242, 253 (Sac Sac) | 3 |
| BLN-CHP-LT-CHC | 70, 259 (Choco Pie) | 2 |

What the data shows:

- The copies were made within seconds or minutes of each other. Example: Milkis 277, 279, 281, 283 and 285 were created between 12:56:09 and 12:59:21 on 2025-11-19.
- The copies carry the same description, short description, attributes, tags, weight and box size. Only the title and the main image differ.
- Each copy's image has the ID "product ID + 1" (278, 280, 282, 284, 286). The image was uploaded while editing the new copy.

WooCommerce normally blocks a duplicate SKU. Its own "Duplicate" button also changes the SKU and adds "(Copy)" to the title. The pattern here is **consistent with** the Yoast Duplicate Post plugin, whose REST namespace (`duplicate-post/v1`) is active on the site. That plugin copies all meta fields, including SKU, stock and gallery. Other raw-copy tools would leave the same trace. **SQL query 04** (`_dp_original`) confirms or rejects this. **SQL query 05** lists duplicate SKUs across all statuses, including hidden products.

If Yoast Duplicate Post is confirmed, either turn it off for products or add `_sku`, `_global_unique_id`, `_stock`, `_stock_status`, `total_sales`, `_product_image_gallery` and the Google and Meta sync fields to its "Do not copy" list.

---

## 5. Hidden products and database hygiene

**In short**

- 69 hidden products and 9 hidden images exist. The public cannot see them, and nobody has checked what they are.
- 14 public images are attached to nothing, and 146 tags have no products.
- These are the real "database mess". The ID gaps are not.

### 5.1 Hidden products (69)

| Where | IDs | Count | Likely story (to confirm with SQL 03) |
|---|---|---|---|
| Bulk import range | 71-74, 78-84, 86-105, 107-113, 115-130, 132, 138, 143, 144, 146, 157 | 60 | Imported on 2025-11-15 and never published, or unpublished later |
| Manual additions, 2025-11-18 | 247, 249, 251, 256 | 4 | 247 to 251 were created right after an image named "lamen-asiatico-sinomie-72g-...-carbonara" (246, now unattached). This fits the Sinomie URLs that now return "not found" (section 11.3) |
| 2025-11-19 to 12-09 | 288, 293, 295 | 3 | Unknown |
| After 2026-09-12 | 1029, 1032 | 2 | Newest drafts or trashed attempts |

A hidden product may still be a good record (for example a draft with a SKU and a description). Decide per product, not by ID range.

The owner reported "many products without description or photos". In the published catalogue this is not true: 0 of 103 lack a description and 0 of 103 lack an image. If such records exist, they are among these 69 hidden products. SQL queries 03 and 11 show them.

### 5.2 Hidden and unattached images

- **Total images in the database:** 204. **Public:** 195. **Hidden:** 9 (244, 248, 250, 252, 257, 289, 294, 296, 347).
- 7 of the 9 hidden images have the ID right after a hidden product (for example product 247, image 248). They were uploaded while editing those products. SQL query 09 lists them.
- **Unattached public images (no parent post): 14.**

| Images | What they show | What it means |
|---|---|---|
| 220, 221, 223, 225 (2025-11-17) | Soju Manga, Blueberry, Maçã Verde, Iogurte | Their products are gone. 221 and 223 are now the main images of 813 and 810, created 2026-08-22. The products were deleted and later re-created |
| 246 (2025-11-18) | Sinomie 72g carbonara | Its product is gone or hidden |
| 341, 342, 351, 352, 354-357 (2025-12-09) | Stationery: scissors, sticky notes, colouring book, pencil cases | The stationery products are gone. The "Papelaria" category is now empty |
| 7 | WooCommerce placeholder | Normal |

- **Public images not used by any published product: 14.** 12 of them are in the unattached list above. The other 2 (895 "40% de DESCONTO" and 975 "Documento A4 etiqueta...") are extra uploads of promo graphics.
- **36 image files** have a re-upload suffix (for example "40-de-DESCONTO-61-8.png"). The same local file was uploaded again instead of reused.

### 5.3 Orphan taxonomy terms

| Taxonomy | Total | With 0 products |
|---|---|---|
| Categories | 24 | 11 |
| Tags | 221 | 146 |
| Brands | 23 | 6 |

The unused tags describe products the shop no longer sells publicly: stationery ("Tesoura", "Post It", "Livro Colorir"), make-up and beauty ("Maquiagem", "Cílios", "Dermaplaning"), bottles and lunch boxes ("Garrafa Térmica", "Lancheira", "Marmita"), and the Sinomie noodles. Section 9 has the details.

### 5.4 What the public data cannot show

These checks need the database (see section 15):

- Meta rows without a post, and term links without a post (SQL 08).
- Lookup-table drift: `wc_product_meta_lookup` rows that disagree with the product's real SKU or stock (SQL 13).
- Featured images or gallery IDs that point to deleted images (SQL 11, 12).
- Orders that point to deleted products (SQL 16).
- Revisions, auto-drafts, trash, transients and task-queue size (SQL 19).

Safety rules for all clean-up work:

- Never renumber IDs.
- Never delete by ID range.
- Move to trash first. Delete permanently only after checking orders, redirects and feeds.

---

## 6. Product content quality

**In short**

- The text was written by AI tools and published without a fact check.
- One text was often pasted onto every flavour. So each listing describes the other flavours too, and some facts are simply wrong.
- Some claims are risky: "Sem Glúten" on a wheat cake, "Zero Açúcar" with added sugar, "baixa caloria" on fried snacks, "antialérgico" on plush toys.

### 6.1 Two generations of AI text

| | 2025 products | 2026 products |
|---|---|---|
| Style | One fixed template: "X oferece ... perfeito para ... Elaborado com ... de alta qualidade ... Invista no X ... qualidade superior, versatilidade e valor agregado" | Emoji headings, fruit emoji lists, check-mark bullet lists, store self-promotion |
| Signal | "valor agregado" appears in 37 of 44 | Emoji in 59 of 59; check-mark lists in 37 of 59 |
| Facts | 3 generic "main ingredients" and a calorie estimate ("Cerca de X kcal") | Almost none; no attributes at all |

Catalogue totals:

- 61 of 103 descriptions contain emoji. In total there are 1,377 emoji in descriptions and short descriptions.
- 64 of 103 products have a description that is identical to at least one other product (21 groups of identical text).
- 37 of 103 products have no short description (all 37 are from 2026).
- No description is empty. The shortest has 71 words.

### 6.2 Copied text with wrong facts

These quotes come from the product reviews and were checked against the saved text.

| Products | What the listing says | What is wrong |
|---|---|---|
| 70, 259 | Title and bullet list: "Sem Glúten" | Its own attributes say "Alérgicos: Contém glúten, leite, soja" and "Farinha de trigo". A risk for people with celiac disease |
| 64, 66 | Title: "Zero Açúcar" | Attribute: "Açúcar: Contém açúcar adicionado" |
| 149, 233, 235, 237 | "perfeito para jovens que apreciam sabores inovadores como kimchi" | These are Maionese, Barbecue de Frango, Queijo Duplo and Bife Americano. Only 231 is kimchi |
| 67, 277, 279, 281, 283, 285 | Milkis text on every flavour: "sabores naturais como banana e morango" and "entrega saúde" | 6 flavours share one text. A sugared soda is sold as healthy |
| 819, 822, 825, 827 (and kit 831) | Saero listings: "O Lotte Chum Churum Soju 360ml é um dos sojus mais..."; kit 831: "Kit Soju Coreano Lotte Chum Churum Sem Açúcar" | Saero is a different Lotte line (zero sugar, R$ 39,99). The text describes Chum Churum |
| 810 to 827 (8 listings) | "1 Garrafa ... (escolha o sabor no momento da compra)" | These are simple products. There is no flavour selector |
| 41 single-flavour listings | "Sabores disponíveis", "Vários Sabores" or "escolha o sabor" | The shopper reads about flavours the page does not sell |
| 957, 967, 968 | "Com um design moderno na cor azul" | The listings are Cinza, Rosa and Verde |
| 829 | "O Kit Contém 5/6 Garrafas" and "Kit com 5 ou 6 garrafas" | The title says "Kit 6". The quantity is unclear at a fixed price |
| 259 | Title "180g", description "Cada caixa contém 6 unidades (168g)" | Two net weights on one page |
| 1011 | "Peso líquido: 140g" | Its images are named "...Soft-Cake_-174g" and "..._Cham_Booner_Bbang_174g". They may show a different pack |
| 919, 923 | Korean flag and "Mimos Korea Design" heading, then "Produto importado da Ásia (China)" | Origin is shown in a misleading way |
| 1011 | Korean flag heading, then "Produto importado do Vietnã pela Orion" | Same |
| 69 | "se sobressai pela baixa caloria" | Its own attribute says "Cerca de 500 kcal por embalagem" |
| 871, 948 | "Estoques ... costumam esgotar em um piscar de olhos" (871); "estoques voam" (948) | False urgency. 948 is out of stock |
| 822 | The text ends with "Avaliações do produto" | Copied from a marketplace page |
| 910 | The description ends mid-word: "Uma explosão de sabo" | Text was cut |

Spelling errors in titles and text: "Koreia, Kpop" (810, 813, 815, 817), "Ceral" (1016), "Marine Voy" (864), "Diretemente" (833, 840), a misspelled Korean thank-you on 829, and "impotado" in the slug of 871.

### 6.3 Claims without support

| Claim | Products | Why it is a risk |
|---|---|---|
| "Sem Glúten" | 70, 259 (contradicted); 106 (a gum, unverified) | Allergen safety |
| "Zero Açúcar" | 64, 66 (contradicted); Saero soju 819, 822, 825, 827 and kit 831 ("Sem Açúcar") | Nutrient claim; for alcohol, see 7.2 |
| "baixa caloria" | 11 products: 69, 106, 148, 149, 150, 231, 233, 235, 237, 263, 265 | Regulated nutrient claim, no nutrition table behind it |
| "sem culpa", "sem excesso" | 9 products (for example 147, 151) | Implied diet claim |
| "saúde", "saudável" | 10 products (Milkis family, O'Rice family, 106) | Health claim on sweets and sodas |
| "antialérgico", "hipoalergênico" | 7 of 7 plush toys (135 to 142) | No test or certificate shown |
| "Impermeável" in the title | 8 of 8 backpacks | The texts say "hidrorrepelente" or "chuva leve" |
| "Importação Própria", "Importação Exclusiva" | 70, 259, 864, 952, 954, 1007, 1016, 1019, 1021 | No importer is named; several of these use marketplace photos |

### 6.4 Titles

- 44 of 103 titles contain the store name. 42 of them are from 2026.
- 45 of 103 titles use two or more "|" separators as keyword chains.
- 54 of 103 titles are longer than 70 characters (62 are longer than 65).
- 5 titles do not say which flavour is sold ("Sabores"): 151, 160, 831, 952, 954.

A clear title pattern is: Type, Brand, Line, Flavour or Colour, Size. Example: "Salgadinho Orion O'Star Queijo Duplo 30g".

---

## 7. Missing product information and compliance to verify

**In short**

- Food and drink make up 87 of 103 listings. None shows a nutrition table or a shelf life. Only 2 name an importer.
- 10 of 13 soju listings show no alcohol content and no 18+ notice.
- The plush toys show no INMETRO information.
- The legal points below are **requirements to verify with legal counsel**. They are not legal advice.

### 7.1 What is missing, by product kind

Counts come from the per-product reviews (`product_reviews.json`), one review per product.

| Kind | Listings | 2025 / 2026 | Most common gaps (X of the listings of that kind) |
|---|---|---|---|
| Savoury snacks | 20 | 10 / 10 | Nutrition table 20; shelf life 20; storage 20; Portuguese label info 20; ingredients 19; importer 19; lactose 13; gluten 12; allergens 10 |
| Non-alcoholic drinks | 19 | 9 / 10 | Nutrition table 19; ingredients 19; allergens 19; gluten 19; importer 19; shelf life 19; country of origin 11; lactose 9 |
| Biscuits and cakes | 19 | 8 / 11 | Nutrition table 19; importer 19; shelf life 19; lactose 17; ingredients 17; allergens 11; gluten 11 |
| Soju (alcohol) | 13 | 3 / 10 | Importer 13; ABV 10; 18+ notice 10; "beba com moderação" 10; ingredients 10; allergens 10 |
| Candy, gum, jelly | 11 | 1 / 10 | Nutrition table 11; shelf life 11; allergens 10; ingredients 10; gluten 10; country of origin 10 |
| Backpacks | 8 | 0 / 8 | Item weight 8; warranty 8; care 8; country of origin 8; real dimensions 5 |
| Plush toys | 7 | 7 / 0 | INMETRO 7; safety warnings 7; care 7; importer 7; country of origin 7 |
| Coffee drinks | 3 | 3 / 0 | Nutrition table 3; allergens 3; gluten 3; lactose 3 |
| Snack kit, instant topokki, slippers | 1 each | 3 / 0 | Kit contents; flavour; slipper size and materials |

What the saved text contains, across all 103 products:

| Information | Products that mention it | Note |
|---|---|---|
| Nutrition table | 0 of 103 | 21 give only a calorie estimate ("Cerca de X kcal") |
| Ingredients | 31 of 103 | 30 of 44 from 2025, 1 of 59 from 2026 |
| Allergens | 31 of 103 | All 31 from 2025 |
| Shelf life | 0 of 103 | |
| Storage | 1 of 103 | |
| Importer | 2 of 103 | 867 and 890 |
| Country of origin (any mention) | 53 of 103 | Often only "importado" or a flag |
| Alcohol content (ABV) | 3 of 13 soju | 154, 155, 156 (as attributes) |
| 18+ notice | 3 of 13 soju | 154, 155, 156 |
| INMETRO | 0 of 7 plush toys | |
| Warranty | 0 of 103 | |

### 7.2 Requirements to verify with legal counsel

This table uses only the bases for which the regulatory research gave a source link. "Confidence" is the researcher's own rating.

| Requirement | Applies to | Basis | Confidence |
|---|---|---|---|
| Clear, correct information in Portuguese: composition, quantity, origin, risks | All products | CDC arts. 6 III, 31 ([CDC](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm)); Decreto 7.962/2013 art. 2 ([decree](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm)) | High |
| Supplier identification (legal name, CNPJ, address, contact) in a visible place | Whole site | Decreto 7.962/2013 art. 2 I-II | High |
| Ingredients and allergen statement ("ALÉRGICOS: CONTÉM ...") | Food and drinks | RDC Anvisa 727/2022 arts. 13-15 ([RDC 727](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&codTipo=&cod_menu=9434&cod_modulo=310&desItem=&desItemFim=&numeroAto=00000727&orgao=RDC%2FDC%2FANVISA%2FMS&pesquisa=true&seqAto=002&tipo=RDC&valorAno=2022)) for the label; CDC art. 31 for the listing | High |
| "Contém glúten" or "Não contém glúten" | Food and drinks | Lei 10.674/2003 ([law](https://www.planalto.gov.br/ccivil_03/leis/2003/l10.674.htm)); applying it to a web page is an interpretation | Medium |
| "Contém lactose" when above 100 mg per 100 g/ml | Dairy drinks, milk-flavoured items | Lei 13.305/2016 ([law](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/lei/l13305.htm)) | High (label) |
| Nutrition table | Food and non-alcoholic drinks | RDC 429/2020 ([RDC 429](https://bvs.saude.gov.br/bvs/saudelegis/anvisa/2020/RDC_429_2020_.pdf)) for the label; on the web page it is expected under CDC art. 31 | Medium |
| No invented health or nutrition claims ("saudável", "baixa caloria", "sem alérgenos") | Food and drinks | RDC 727/2022 art. 4; CDC arts. 30, 37 and 38 | High |
| Net content and price per unit of measure | Food and drinks | CDC art. 31 and art. 6 XIII | High / Medium |
| Sale to people under 18 is prohibited; show the notice and check age at checkout and delivery | Soju | ECA art. 243 as changed by Lei 13.106/2015 ([law](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13106.htm)) | High |
| Alcohol content (% vol.) | Soju | Decreto 6.871/2009 art. 11 ([decree](https://presidencia.gov.br/ccivil_03/_ato2007-2010/2009/decreto/d6871.htm)) for the label; CDC art. 31 for the listing | High |
| Warning phrases such as "Beba com moderação"; no appeal to minors or K-pop youth themes next to alcohol | Soju | CONAR code, Anexo A ([code](http://www.conar.org.br/pdf/Codigo-CONAR-2025.pdf)); Lei 9.294/1996 for drinks above 13 °GL ([law](https://www.planalto.gov.br/ccivil_03/leis/l9294.htm)) | Medium |
| Nutrition claims such as "zero açúcar" are not allowed on alcoholic drinks | Saero soju 819, 822, 825, 827, 831 | RDC 429/2020 (same link as above) | High (per research; confirm) |
| INMETRO conformity seal and registration; age grading and safety warnings | Plush toys | Portaria Inmetro 302/2021 ([regulation](http://sistema-sil.inmetro.gov.br/rtac/RTAC002801.pdf)) | Medium |
| Footwear label (size, materials, origin) | Slippers (131) | Portaria Inmetro 459/2025 ([text](https://www.legisweb.com.br/legislacao/?id=482498)); retail deadline 31/12/2027 | High (label) |
| One price per item | Duplicate listings | Decreto 5.903/2006 art. 9 VII ([decree](https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d5903.htm)) | High |
| Legal warranty (30 days for food, 90 days for durable goods) | All products | CDC arts. 24, 26, 50 | High |

Low-confidence points (the research itself rated them low; check before acting):

- A caffeine notice for ready-to-drink coffee (64, 65, 66).
- Rules for a USB port or power bank on backpacks (Anatel).
- A general duty to show the INMETRO seal image online (the proposal Consulta Pública Inmetro 6/2026 was not yet in force when researched).
- Showing the approximate tax amount (Lei 12.741/2012 was not read).

### 7.3 Alcohol listings in detail

| Listings | ABV shown | 18+ notice | Other issues |
|---|---|---|---|
| 154, 155, 156 (2025) | 12% (as an attribute) | Yes (as an attribute) | 156 costs R$ 0,00, is in stock and has no weight or box size. 155's 12% may be wrong for the "Original" flavour; check the label |
| 810, 813, 815, 817 (2026, Chum-Churum) | No | No | "Koreia, Kpop" in the title; the text lists 12 flavours and says "escolha o sabor"; 815 is not in the "Soju" category |
| 819, 822, 825, 827 (2026, Saero) | No | No | Text describes Chum-Churum; "Sem Açúcar" claim (see 7.2) |
| 829, 831 (2026, kits) | No | No | 829 says "5 ou 6 garrafas"; the kit box is the size of one bottle (8 x 6 x 21 cm) |

12 of 13 soju listings are in stock (all except 155).

---

## 8. Images

**In short**

- Image file names show where the pictures came from: marketplace sites, AI tools, screenshots, a discount banner and names like "zzz" or "1".
- One picture is often reused for different flavours or colours, so the shopper may see the wrong product.
- 0 of 195 images have alt text.

### 8.1 Where the image files come from

File names match these patterns. **File names match CDN naming patterns; confirm the source and the right to use each image.**

| Class | Files | Products using them | Examples |
|---|---|---|---|
| Descriptive name (58 files from 2025, 4 from 2026) | 62 | 48 | "snack-coreano-marine-boy-orion-camarao-de-30g" |
| Junk or meaningless name | 54 | 33 | "zzz", "1", "2", "dsdsdssdsdsds", "sasdasd", "HGH" |
| AI-generated ("ChatGPT Image ...") | 24 | 16 (main image on 15) | "ChatGPT Image 6 de ago. de 2026, 16_24_18" |
| Shopee CDN hash ("br-11134207-...") | 22 | 24 | "br-11134207-820lc-mralsmujhipye8" |
| Promo banner | 15 | 20 (main image on 3: 890, 980, 985) | "40% de DESCONTO (61)", "Documento A4 etiqueta adesiva oferta balão..." |
| Mercado Livre CDN ("D_NQ_NP_2X_...-MLA...") | 6 | 3 (957, 967, 968) | "MLA" is the Mercado Libre Argentina site code |
| Short or unclear | 5 | 6 | "tonichoco", "kit-saero", "lichia-sem" |
| Amazon CDN ("61RZ-t7Z5SL._AC_...") | 4 | 2 (894, 899) | One name ends "UF350,350_QL50", which suggests a 350 px thumbnail |
| Screenshot ("Capturar") | 2 | 6 (842, 846, 849, 852, 941, 946) | |
| WhatsApp export | 1 | 1 (948) | "WhatsApp Image 2026-06-27 at 16.41.01" |
| **Total** | **195** | | |

Together, marketplace CDN names (Shopee, Mercado Livre, Amazon) appear on 29 of 103 products.

### 8.2 The "40% de DESCONTO" banner

- The same banner file "40% de DESCONTO (61)" was uploaded 8 separate times (891, 897, 907, 914, 920, 927, 935, 942).
- It appears in the gallery of 18 Sakuragi products: 890, 894, 899, 902, 905, 908, 910, 912, 916, 919, 923, 926, 932, 933, 934, 939, 941, 946.
- None of these products has a sale price. A discount shown in a photo with no real discount may be misleading advertising (CDC art. 37, verify with counsel). Google and Meta also reject promotional overlays on product images (section 12).

### 8.3 One image, many products

28 image files are used by two or more products. The most important cases:

| Image | Used on | Problem |
|---|---|---|
| Shopee file "br-11134207-820lc-mralsmujhipye8" (uploaded twice: 812 and 824) | 10 soju listings: 810, 813, 815, 817, 819, 822, 825, 827, 829, 831 | One photo cannot show 8 flavours, 2 product lines and 2 kits |
| Mercado Livre photos 959 to 964 | 957 Cinza, 967 Rosa, 968 Verde | Same 6 photos for 3 colours |
| Screenshot 843 "Capturar" | 842, 846, 849, 852 (4 Yantai flavours) | One screenshot on 4 flavours cannot be flavour-specific |
| AI image 931 | 926, 932, 933 (3 mint flavours) | Not flavour-specific, not a real photo |
| Image 877 "miklho" (corn) | 875 corn and 879 seaweed | Corn image on the seaweed listing |
| Images 836 "1" and 837 (Shopee) | 833, 838, 840 (3 Chuyin flavours) | Not flavour-specific |
| Image 228 | 150 and its copy 864 | Duplicate listing |

**Same file name, separate uploads.** A file named "lichia" was uploaded 3 times within 77 minutes on 2026-08-22: for soju 815 (816), Yantai juice 852 (853) and Chuyin juice 860 (861). "morango" and "uva" show the same pattern between Yantai and Chuyin. If these are the same local photo, two of the three listings show the wrong product. This needs a visual check.

Other image problems:

- 19 products list the same image twice in their gallery. Some galleries contain one file uploaded twice (894: 896 and 898; 899: 900 and 901; 902: 903 and 904; 1007: 1008 and 1010).
- 30 products use an image that was uploaded for a different product.
- 46 of 103 products have only one image.
- 1011 shows images named for a 174 g pack while it sells 140 g.

### 8.4 Format and accessibility

- 195 of 195 image files have empty alt text. 103 of 103 products are affected.
- 136 of 195 files are PNG (all from 2026). 58 are WebP (all from 2025). 1 is JPEG.
- File names are part of image search. Names like "zzz" give search engines nothing.

AI-generated images: Google asks that images made with generative AI keep their AI metadata (for example the IPTC "DigitalSourceType" tag). This was not checked (no pixels or metadata were downloaded). Real photos of the real package are safer for food.

---

## 9. Taxonomy: categories, tags and brands

**In short**

- "Ofertas Mimos" is the default category. It holds 64 products, but no product is on sale.
- 11 of 24 categories are empty. 146 of 221 tags are unused.
- Brands mix maker and product line. 49 products have no brand.

### 9.1 Categories

- 24 categories, all at one level (no sub-categories), 24 of 24 without a description.
- 11 are empty: Agendas, Almofadas, Bolsas, Chaveiros, Eletrônicos, Garrafas, Jogos, Lar, Maquiagens, Papelaria, Presentes.
- 6 of these empty categories are in the main menu (Presentes, Agendas, Papelaria, Lar, Eletrônicos, Jogos). "Moda" has 1 product, and it is out of stock.

| Category | Products |
|---|---|
| Comida e Bebida | 66 |
| Ofertas Mimos (default category, id 15) | 64 |
| Bebidas | 21 |
| Soju | 12 |
| Salgadinhos | 10 |
| Mochilas | 8 |
| Biscoitos | 7 |
| Pelúcias | 7 |
| Bebê e Infantil | 7 |
| Refrigerantes | 6 |
| Doces | 3 |
| Moda, Ramyeon | 1 each |

Problems:

- **"Ofertas Mimos"** holds 64 of 103 products: 5 of 44 from 2025 and 59 of 59 from 2026. 0 of 103 products are on sale. New products land there because it is the default category.
- **32 of 103 products** sit only in generic categories ("Comida e Bebida" and/or "Ofertas Mimos"). All 32 are from 2026. A shopper browsing "Salgadinhos" finds the old, out-of-stock O'Star copies but not the new in-stock ones.
- **815 (soju Lichia)** is not in "Soju". **858** (juice) is only in "Ofertas Mimos".
- **Plush toys** are in "Bebê e Infantil" but their attributes say "Acima de 3 anos".

### 9.2 Tags

- 221 tags. 146 have no products. 75 are used, 32 of them by one product only.
- 59 of 103 products have no tags (all 59 from 2026).
- 55 tags are sizes or quantities ("30g", "250ml", "4 Unidades"). 19 of those are in use.
- 21 tags repeat a brand name ("Lotte", "Orion", "Milkis") and 6 repeat a category ("Soju", "Mochila").
- Unused tags describe products no longer sold: stationery, make-up, bottles, lunch boxes, the Sinomie noodles.

Sizes, flavours and brands belong in attributes and the brand field, not in tags.

### 9.3 Brands

- 23 brands. 6 have no products: Bobbie Goods, Fofy, Mimos Korea Design, MKD, Post It, Sinomie. The store's own name exists twice ("Mimos Korea Design" and "MKD").
- 49 of 103 products have no brand. All 49 are from 2026, including Orion, Sakuragi, Chuyin and Yantai items.
- 33 of 103 products have two brand terms: the maker and the product line (for example "Lotte" and "Milkis").
- 8 products use "Genérico" (the slippers and the 7 plush toys).
- 70 and 259 say "Orion" in the title but carry the brand "Lotte". Orion and Lotte make different Choco Pies. Check the package.

A clean model: one brand per product (the maker: Lotte, Orion, Sakuragi...). The product line (Milkis, Pepero, O'Star, Chum-Churum, Saero) goes into an attribute.

### 9.4 Attributes

- 44 products have attributes. 0 use global attributes (`pa_` taxonomies). All are free text per product.
- 59 products have no attributes.
- Free-text attributes cannot drive filters or variations. A global "Sabor" attribute is needed before converting families to variable products.

---

## 10. Inventory and logistics data

**In short**

- 59 of 103 products have no SKU. 23 products share 6 SKUs.
- 41 of 103 products are out of stock: 39 of the 44 old ones and 2 of the 59 new ones.
- Weights and box sizes are often placeholders. Freight quotes will be wrong.

### 10.1 SKU

- 44 of 44 products from 2025 have a SKU. 0 of 59 from 2026 have one.
- 6 SKUs are shared by 23 products (table in 4.5).
- The SKU scheme is not consistent. Example: 64 uses "CAF-CNT-LT-GEL-230" and its sibling 66 uses "CAF-GEL-CNT-LT-230". Most SKUs do not include the flavour.
- No GTIN (EAN barcode) is visible for any product. The Store API may not expose it, so check the database (SQL query 21, column `gtin`).

### 10.2 Stock

| Group | In stock | Out of stock |
|---|---|---|
| 2025 products (44) | 5 (70, 147, 154, 156, 259) | 39 |
| 2026 products (59) | 57 | 2 (867, 948) |
| All (103) | 62 | 41 |

- All 7 plush toys and the only "Moda" product are out of stock.
- The public data shows only "in stock" or "out of stock". Real quantities and "manage stock" settings need SQL query 14.
- The pattern supports finding 2: old records were left out of stock and new ones were created.

### 10.3 Price

- 156 (Soju Pêssego) costs R$ 0,00 and is in stock.
- Duplicates have different prices (section 4.1).
- Kit 85 (2 bags of Tok) costs R$ 27,99. One bag (151) costs R$ 9,99. Two single bags cost R$ 19,98.
- Plush 140 (35 cm) costs R$ 139,99. The larger plush 139 (40 cm) costs R$ 109,99. Check if this is intended.

### 10.4 Weight and box size

| Problem | Products | Examples |
|---|---|---|
| Placeholder box 5 x 5 x 10 cm | 33 | Backpacks 957, 967, 968 (25 L) and 969, 980, 981 (29 L), all at 0.3 kg; juices; Sakuragi items |
| Weight below the net content | 9 | 70 and 259: 0.05 kg for a 180 g box; juices 842-860: 0.2-0.3 kg for 238-500 ml |
| Same item, different data | 8 listings in 3 duplicate groups | 30 g snacks: 0.03 kg on 150, 235, 237 vs 0.2 kg on the copies 864, 952, 954, 1019, 1021 |
| Kit smaller than its contents | 829, 831 | 829: 6 bottles, 3.5 kg, box 8 x 6 x 21 cm (the size of one bottle) |
| Weight or box missing | 1 | 156 |
| Box too small for the product | 985, 993 | Backpacks at 6 x 6 x 12 cm |

Correios and carrier quotes use these fields. A backpack declared as a 5 x 5 x 10 cm box is under-quoted at checkout. Candy declared at 0.2 kg for 16 g is over-quoted.

---

## 11. Storefront, SEO and external footprint

**In short**

- Shoppers see duplicates side by side, empty menu categories and out-of-stock "best sellers".
- The legal pages contradict each other on returns and need a lawyer's review.
- Removed products still appear in search indexes and now lead to "not found".

These findings come from a crawl of the live pages through Exa on 2026-09-28. Exa returns cleaned page content from its cache or a live fetch. It does not show page headers, meta tags or structured data. Only well-evidenced items are listed.

### 11.1 Storefront

| Finding | Evidence |
|---|---|
| Duplicates shown side by side | The homepage "Mais Vendidos" block shows old 235 and 237 (out of stock, R$ 12,90). The "Comida e Bebida" block on the same page shows copies 1021, 1019, 954 and 952 (R$ 12,99) |
| Out-of-stock and price-less items promoted | "Mais Vendidos" includes 235, 237 and 156 (no price). The "Pelúcias" block shows 7 plush toys, all out of stock |
| Empty menu entries | 6 of 10 main-menu categories show "Nenhum produto foi encontrado" (Presentes, Agendas, Papelaria, Lar, Eletrônicos, Jogos) |
| Homepage promises products the shop does not list | Banners and text mention canecas, maquiagem and K-Beauty; no such product is published |
| Legal pages contradict each other | Return shipping on withdrawal: one page says the supplier pays, another says the consumer pays. Apparent defects: 7 days on one page, 30/90 days on another. One page sets a fixed court (Recife) "com renúncia a outros". Free-shipping threshold: R$ 150 on some pages, R$ 290 on others (possibly cache timing) |
| Legal pages contain unrelated AI text | Privacy, cookies and terms pages describe an AI chatbot product and features the shop does not offer (subscriptions, points, cashback). No data protection officer (encarregado) is named |
| Company data | Legal name, CNPJ and address appear on the legal pages. The address line contains a typo ("ML oka 017pc"). /contato/ and /lojas could not be crawled |
| Origin signals | The homepage says "direto de Seul". Korean flags appear on products whose own text says China (919, 923) or Vietnam (1011) |

The legal-page points are requirements to verify with legal counsel (CDC arts. 26, 49 and 51; Decreto 7.962/2013; LGPD art. 41).

### 11.2 SEO

- **No SEO plugin.** The REST namespace list shows no Yoast SEO, Rank Math, All in One SEO or SEOPress (lead auditor check). There is no per-product meta title or meta description control.
- **Page titles repeat the store name.** Example: "Bala Hortelã Sakuragi Sabor Melancia 16g | Importado | Mimos Korea Design – Mimos Korea Design".
- **Long slugs.** 34 of 103 slugs are longer than 75 characters. One slug ends in "-2" (253). One slug has a typo ("impotado", 871). Changing a slug changes the URL, so every change needs a 301 redirect.
- **Thin archives.** Tag archives such as /produto-tag/30g/ are crawlable. 146 tags are empty.
- **Emoji in snippets.** Emoji at the start of descriptions end up in search snippets and card excerpts.
- **Empty alt text** on every image (section 8.4).

### 11.3 External index and marketplaces

The "index" here is Exa's search index, not Google's. Google Search Console access is needed to confirm.

| Finding | Evidence | Confidence |
|---|---|---|
| 5 product URLs in the index now return "not found" in a live crawl: Cantata Avelã, Let's Be Mild Coffee 175 ml, and 3 Sinomie noodle flavours | Live fetches with a cache-busting parameter; control URLs of published products worked | Medium-high. Fits the empty "Sinomie" brand, the unused "Sinomie" tag and unattached image 246 |
| The index still shows removed products | Cached "Papelaria" page with 8 items; cached brand page "Mimos Korea Design" with a plush; both empty today | High |
| Two host versions (www and without www) indexed separately; one cached homepage shows broken accents | Cached pages | Medium |
| Old "/MLB-..." URLs from an earlier Mercado Shops storefront on the www host are indexed and now return "not found" | Cached and live fetches | Medium |
| The same naming and photo problems appear on marketplace listings (for example a Chuyin drink listed as a baby bottle) | Marketplace pages seen through search | Low-medium; confirm the seller account |

Actions: add 301 redirects for removed product URLs (or restore the products if they are only hidden), redirect /MLB-* URLs, pick one host (www or not) with a 301, and submit the sitemap in Google Search Console.

### 11.4 Security note

- The public REST users endpoint lists the site's 2 accounts (IDs 1 and 3). Restrict `/wp-json/wp/v2/users` for visitors who are not logged in (a security plugin or a small code snippet can do this).
- The media API also shows the uploader ID of each image. This is normal WordPress behaviour, but it is one more reason to restrict user listing.
- Use strong, unique passwords and two-factor login for both accounts.

---

## 12. Sales channel feeds (Google and Meta)

**In short**

- Google for WooCommerce (`wc/gla`) and Facebook for WooCommerce (`wc-facebook`) are active on the site.
- If they sync, every catalogue problem above is copied into Google Merchant Center and the Meta catalogue.
- The worst risks are the false "Sem Glúten" claim and alcohol listings on Meta.

We could not see whether the plugins are connected or which items are approved. Check Merchant Center diagnostics and Meta Commerce Manager.

| Problem | Products | Google Merchant Center | Meta catalogue |
|---|---|---|---|
| "Sem Glúten" on a wheat cake | 70, 259 | Misrepresentation policy ([6150127](https://support.google.com/merchants/answer/6150127?hl=en)). Google treats misrepresentation as egregious; the risk is account suspension, not just item disapproval | Items must represent the product accurately |
| Alcohol | 13 soju (12 in stock) | Allowed in Brazil with limits ([12077694](https://support.google.com/merchants/answer/12077694?hl=en)); needs the right product category and age targeting | Commerce policy does not allow alcohol ([policy](https://www.facebook.com/policies_center/commerce/alcohol)). Exclude from sync. Fix 815's category first so a category rule catches it |
| Promo overlays on images | 20 (main image on 3) | Promotional overlays lead to disapproval ([6324350](https://support.google.com/merchants/answer/6324350?hl=en)) | Images must show the product |
| AI images as main image | 15 | AI images must keep AI metadata (same page) | Must represent the product |
| Duplicates at different prices | 10 listings in 4 groups | One offer per product ID ("gla_" + ID), so twins compete | Same |
| Missing brand | 49 (plus 8 "Genérico") | Brand is required for branded goods ([6324351](https://support.google.com/merchants/answer/6324351?hl=en)) | Brand is a required field |
| Missing GTIN | 103 not visible | GTIN strongly recommended; limited visibility without it ([6324461](https://support.google.com/merchants/answer/6324461?hl=en)) | Recommended |
| Store name and keyword chains in titles | 44 with store name; 62 over 65 characters | Titles must not include the company name ([6324415](https://support.google.com/merchants/answer/6324415?hl=en)) | Meta recommends fewer than 65 characters |
| Emoji and store promotion in descriptions | 61 | Descriptions should describe only the product ([6324468](https://support.google.com/merchants/answer/6324468?hl=en)) | Plain text expected |
| Price R$ 0,00 | 156 | Price must match the landing page | Invalid price |

**IDs matter.** Google for WooCommerce uses "gla_" plus the product ID. Facebook for WooCommerce uses the SKU plus the product ID. So:

- Deleting and re-creating a product starts a new item with no history.
- Adding or changing a SKU also changes the Meta item ID.
- Converting flavours to variations creates new IDs.

Do all ID-changing work once, in one planned window, then resync both channels (section 14a, step 8).

**Clones and sync fields (to check).** A raw-meta clone may also copy the source product's Google and Meta sync fields. A clone could then point to the original's channel item. This is plausible from the plugin code but was not observed. Check the database for identical `fb_product_item_id` or `_wc_gla_*` values on different products.

---

## 13. Root causes

**In short:** the problems come from the process and the tools, not from one mistake. Each cause below has a matching fix in section 14.

| # | Cause | Effect in the data |
|---|---|---|
| 1 | **No simple "restock" path.** Creating a new listing was easier than finding and updating the old one. | 4 duplicate groups; 39 of 44 old products left out of stock; re-created soju (810, 813) |
| 2 | **A clone tool copies everything.** The copy keeps the SKU, stock, gallery and text of the source; only the title and main image were changed. | 6 shared SKUs on 23 products; flavour text copied to other flavours |
| 3 | **No required fields before publishing.** Nothing forced SKU, brand, attributes, weight, box size or legal notices. | 0 of 59 new products with SKU or attributes; 49 without brand; placeholder boxes on 33 |
| 4 | **AI text without facts.** The text appears to be generated from the product name, not from the label, and was not checked. | "Sem Glúten" on wheat, "Zero Açúcar" with sugar, kimchi on cheese chips |
| 5 | **Images taken from whatever was at hand.** No rule for source, naming or alt text. | Marketplace CDN names on 29 products; AI images on 16; banner on 18; alt text on 0 |
| 6 | **Taxonomy without an owner.** The default category is a promotion bucket; tags are free keywords; brands mix maker and line. | 64 products in "Ofertas Mimos" with no sale; 146 unused tags; 2 store-name brands |
| 7 | **Hiding or deleting instead of retiring.** No redirects and no record of what was removed. | 69 hidden products; 5 indexed URLs not found; unattached images |
| 8 | **Two accounts, two ways of working.** The 2025 and 2026 work followed different patterns, and no change log exists (no activity-log plugin was seen). | The two eras in section 3.4 |
| 9 | **No SEO and feed checks.** No SEO plugin; nobody checks Merchant Center or Meta diagnostics. | Store name in titles, emoji snippets, alcohol possibly on Meta |

---

## 14. Recommendations

### 14a. Immediate clean-up plan

**In short:** back up first. Fix safety items. Then merge, then clean, then migrate. Do one step at a time and write down every change.

**Safety rules (for every step)**

- Make a full backup of files and database before you start. Test that it restores.
- Work on a staging copy when possible. Pause product creation in wp-admin during clean-up.
- Never renumber IDs. Never delete by ID range.
- Move items to the trash first. Delete permanently only after orders, redirects and feeds are checked.
- When two listings are the same item, keep the URL with history (usually the oldest) and 301-redirect the others to it.
- Keep a simple change log: date, product ID, what changed, why.

| Step | What to do | Products | Why this order |
|---|---|---|---|
| 0 | Full backup and restore test | All | Everything else depends on it |
| 1 | **Safety fixes today.** Remove "Sem Glúten" from 70 and 259 (title, text, short text). Fix "Zero Açúcar" on 64 and 66 after checking the label. Give 156 a price or hide it. Add ABV (from the label), "Venda proibida para menores de 18 anos" and "Beba com moderação" to the 10 soju that lack them, and make them visible on the 3 older ones too. Remove the "40% de DESCONTO" and "Documento A4 etiqueta..." images from all galleries | 70, 259, 64, 66, 156, 13 soju, 20 banner products | Customer safety and the highest legal and channel risk |
| 2 | **Channels.** Exclude alcohol from the Meta catalogue sync. Check Merchant Center and Commerce Manager diagnostics. Export the current item lists as a baseline | 13 soju | Stops the worst feed problems before bigger changes |
| 3 | **Diagnostics.** Run `audit/sql/diagnostics.sql` on the backup (read-only). Priority: 01, 02, 03, 04, 05, 08, 13, 14, 16, 20. Keep the results private: queries 03 and 17 return account logins | Database | Replaces guesses with facts |
| 4 | **Merge the 4 verified duplicate groups.** Move price, stock and better content to 235, 237, 150 and 242. Trash 954, 1021, 952, 1019, 864 and 253. Add 301 redirects from their URLs | 10 listings | Removes the most visible confusion |
| 5 | **Give every product its own SKU.** One scheme, flavour included (for example the Studio pattern TYPE-BRAND-LINE-VARIANT-SIZE). Do it together with step 8 if possible, because the Meta item ID includes the SKU | 23 shared + 59 missing | Makes stock and feeds reliable |
| 6 | **Decide on the 69 hidden products.** For each one: publish, keep as draft, or trash. Look for records with good data (SKU, description) before trashing. Add a 301 for any URL that was ever public | 69 | Cleans the database without losing good data |
| 7 | **Taxonomy.** Make a neutral category the default. Remove "Ofertas Mimos" from items without a sale price (or fill it automatically from real sales). Put each product in one leaf category (fix 815 and 858). Merge brands to one maker per product; keep one store brand (MKD or Mimos Korea Design). Delete unused tags after SQL 15 | 64, 32, 49, 146 tags | Clear navigation and correct feeds |
| 8 | **One migration window for ID-changing work.** Choose: keep simple products (unique SKU and GTIN per flavour) or convert the 24 families to variable products. Keep an old-to-new ID map, add redirects, then resync Google and Meta | 79 listings in 24 families | ID changes reset channel history, so do them once |
| 9 | **Content rebuild.** Rewrite text from the physical label: ingredients, allergens, gluten and lactose statements, nutrition table, origin, importer, shelf life policy. Remove emoji, store name in titles, and unsupported claims | 103 | Legal information and trust |
| 10 | **Images.** Replace AI, banner, screenshot and marketplace images with own photos (front and back label). Upload as WebP with descriptive names and alt text. Delete unattached images only after SQL 10 confirms they are unused | 103 | Accurate pictures and image search |
| 11 | **Logistics.** Weigh and measure each packed item. Replace the 5 x 5 x 10 cm placeholders | 33 + 9 + kits | Correct freight quotes |
| 12 | **Site hygiene.** Hide empty menu categories. Review the legal pages with a lawyer. Restrict the users endpoint. Pick one host (www or not). Install one SEO plugin. Submit the sitemap in Search Console | Site | Trust, security and search |

If Yoast Duplicate Post is confirmed by SQL 04, turn it off for products or configure its "Do not copy" list (section 4.5).

### 14b. Mimos Catalog Studio: how it prevents each problem

Mimos Catalog Studio (`studio/`) is the tool being built to replace manual product creation. It is a web app for the operator.

How it works:

1. **The operator types only three things:** the product name, one reference link, and the stock quantity.
2. **Research.** The Studio reads the reference page and searches the web (Tavily and Exa). Gemini identifies the exact product and writes short copy from the sources.
3. **Every fact must quote its source.** A fact is accepted only if its quote really appears in the cited source and every number in the value appears in the quote. This check is plain code, not AI (`src/lib/pipeline/verify.ts`). Facts that change between flavours (ABV, ingredients, allergens, nutrition, barcode) need a source that names the same flavour. Unverified facts never reach the product page.
4. **Duplicate guard.** Before saving, it searches the store in all statuses except trash (published, draft, pending, private) by SKU, barcode, line and flavour. A confident match can only be **updated**, never created again (`duplicates.ts`, `sync.ts`).
5. **Deterministic SKU.** Same product, same SKU (`sku.ts`).
6. **Required fields per product kind.** Missing required fields (for example ingredients, allergens, gluten, nutrition for food; alcohol content for soju; material and size for footwear) mark the draft as incomplete (`compliance.ts`).
7. **Legal notices are fixed text owned by the system.** Alcohol always gets "Venda e consumo proibidos para menores de 18 anos" and "Beba com moderação. Se beber, não dirija". Toys get an INMETRO reminder. The AI does not write them.
8. **Images.** Downloaded safely, duplicates removed by perceptual hash, checked by a vision model that rejects other flavours, promo overlays, screenshots and watermarks, converted to WebP, named after the product slug, with alt text (`images.ts`, `select-images.ts`).
9. **Text rules.** No emoji, no store name, no "|" chains, no hype phrases; the page layout (sections and tables) is built by code, not by the AI (`prompts.ts`, `compose.ts`).
10. **Owner approval.** New products are created as "pending" with no price. The owner sets the price and publishes. Updating a published product keeps it published and sets stock to the typed quantity.

| Audit finding | How the Studio prevents it |
|---|---|
| Restock by re-creation, duplicates (section 4) | Duplicate guard searches all statuses; a match forces "update stock" instead of "create" |
| Shared or missing SKU (4.5, 10.1) | SKU built from type, brand, line, flavour and size; WooCommerce uniqueness enforced on create |
| Copied text with wrong facts (6.2) | Facts must quote a source for the same flavour; unverified facts are dropped |
| "Sem Glúten", "Zero Açúcar", "baixa caloria" (6.3) | Claims come only from verified facts; hype phrases are banned |
| Missing food, alcohol and toy information (7) | Required fields per product kind; incomplete drafts stay "pending" |
| No ABV or 18+ notice on soju (7.3) | Fixed legal notices added by code for every alcohol product |
| Marketplace, AI, banner and screenshot images (8) | Vision check rejects banners, screenshots and wrong variants; every image records its source |
| Junk file names, no alt text, PNG files (8.4) | WebP files named after the product slug, with alt text |
| Emoji, store name and keyword chains in titles (6.4) | Title pattern and text rules enforced in code |
| No brand (9.3) | Brand comes from a verified fact or the product identification and is saved in the brand taxonomy |
| Placeholder weights and boxes (10.4) | Weight and box are estimated per product (from sources, or from type and size; never 0) and marked "estimated" when no source confirms them. The owner should still weigh and measure (14a, step 11) |
| Unreviewed publishing (13) | New products go to "pending" for the owner's approval |
| No audit trail (13) | Each synced product stores its job ID and source URLs in product meta |

What the Studio does **not** do (yet):

- It does not clean the existing catalogue. Steps 1 to 12 in 14a are still needed.
- It creates simple products. Converting families to variable products is a separate, one-time migration (step 8).
- It cannot read physical labels. When sources are missing, the draft stays incomplete, and the owner should add label data by hand.
- Developer note: on a SKU collision during "create", the sync currently appends a suffix to the SKU. A SKU collision usually means the item already exists. It is safer to treat it as a duplicate match and switch to "update".

---

## 15. Gaps and next steps

**In short:** the public data cannot see drafts, trash, orders, stock quantities, authors or plugin settings. The read-only queries in `audit/sql/diagnostics.sql` close most gaps. Run them on a backup copy.

| Gap | Why it matters | How to close it |
|---|---|---|
| Status of the 69 hidden products (draft, pending, private, trash) | Core of the "deleted or draft" complaint; may contain good records | SQL 02, 03 |
| What the 668 "other" IDs are | Shows that most ID gaps are normal WordPress objects | SQL 01, 20 |
| Clone origin of shared SKUs | Decides whether to reconfigure Yoast Duplicate Post or another tool | SQL 04, 05, 06, 07; plugin list (`wp plugin list` or `/wc/v3/system_status` with a read-only key) |
| Orphans and lookup-table drift | The real database "pollution" | SQL 08, 09, 10, 11, 12, 13, 15 |
| Stock quantities and settings | Explains why restock turned into re-creation | SQL 14 |
| Orders and sales for deleted or duplicate products | Chooses which duplicate keeps the history; shows lost sales | SQL 16 |
| Who created, edited and trashed products | Needed to design roles (for example no "delete product" right for staff). Keep results private | SQL 17 |
| Emoji in hidden products | Size of the text clean-up beyond the public 103 | SQL 18 |
| Database weight (revisions, auto-drafts, trash, transients, task queue) | Performance and backup size | SQL 19 |
| Full product export for reconciliation (including GTIN and clone source) | Base file for the clean-up | SQL 21 |
| Old slugs and redirects | Decide restore vs 301 for URLs that now return "not found" | Not in the SQL file yet: query `_wp_old_slug` in `wp_postmeta`; check the sitemap and Search Console |
| Global attributes and brand taxonomy setup | Needed before variable products | Not in the SQL file yet: `wp_woocommerce_attribute_taxonomies`; `/wc/v3/products/attributes` |
| Channel status | Which items are live or disapproved | Merchant Center and Meta Commerce Manager (owner login) |
| Image quality | File names are not enough | Can be done with public data: download the files, check size, perceptual hash, OCR for banners, C2PA/EXIF for AI images |
| Real label data | Ingredients, allergens, nutrition, origin, importer, barcode | Photograph the back label and the Portuguese sticker of every product in stock |
| The "flattened variable product" idea | 21 files named "...-sabores-..." suggest flavours were split from one parent; unproven | Check attachment parents and `product_variation` rows (SQL 02) |

Contradictions to settle with admin data:

- Cause of shared SKUs: import tool, clone plugin or direct database writes. SQL 04 and 05 decide.
- 70 and 259: two flavours (both lenses) or one item (critic). Check the packages.
- 985 and 993: one backpack or two models. Check the stock room.

---

## Appendix A. Per-product table (103 products)

- **Era:** year the product was created.
- **Priority:** from the per-product review (critical, high, medium).
- **Top issues:** up to 3 issues, chosen from the data in this order: duplicates and safety claims first, then wrong facts, images, SKU, stock and missing information. Full details per product are in `audit/data/derived/product_reviews.json` and `product_scorecard.csv`.

Priority counts: 70 critical, 32 high, 1 medium.

| ID | Product | Era | Priority | Top issues |
|---|---|---|---|---|
| 64 | Café Cantata Lotte 230ml Americano | 2025 | critical | 'Zero Açúcar' but sugar added; Out of stock; No nutrition table |
| 65 | Café Let's Be Lotte Cappuccino 240ml | 2025 | critical | Out of stock; No nutrition table; No importer named |
| 66 | Café Cantata Lotte 230ml Amêndoa | 2025 | critical | 'Zero Açúcar' but sugar added; Out of stock; No nutrition table |
| 67 | Milkis Lotte 250ml Original | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 68 | Pepero Lotte 47g White Cookie | 2025 | high | Text copied across flavours; Shared SKU BSC-PPR-LT-47G; Out of stock |
| 69 | O'Rice Orion 129g Queijo com Batata | 2025 | critical | Text copied across flavours; Shared SKU BSC-ARR-ORC-ORI-129G; 'baixa caloria' claim |
| 70 | ChocoPie Orion Chocolate Duplo c/ Marshmallow | 2025 | critical | 'Sem Glúten' but contains wheat; Shared SKU BLN-CHP-LT-CHC; Weight below net content |
| 85 | Kit 2 Orion Tok 38g Carne e Queijo | 2025 | high | Kit dearer than 2 singles; Out of stock; No nutrition table |
| 106 | Kit Guloseima Chiclete Orion Morango 12g | 2025 | high | 'baixa caloria' claim; Out of stock; No nutrition table |
| 131 | Pantufas Fofas Porquinho Rosa | 2025 | high | No size (numeração); Out of stock; No importer named |
| 135 | Pelúcia Cachorro Pug Fofinho 30cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 136 | Pelúcia Capivara Gotinha Fofinha 45cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 137 | Pelúcia Coala Fofinho 45cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 139 | Pelúcia Porquinho Rosa Deitado Fofinho 40cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 140 | Pelúcia Porquinho Rosa Mamadeira 35cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 141 | Pelúcia Unicórnio Fofo Deitado Rosa 50cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 142 | Pelúcia Unicórnio Infantil Fofo 40cm | 2025 | high | No INMETRO info, 'antialérgico' claim; Out of stock; No importer named |
| 145 | Sac Sac Lotte 238ml Morango | 2025 | critical | Text copied across flavours; Shared SKU REF-SAC-LT-238; Out of stock |
| 147 | Koony Frango Frito 40g | 2025 | high | 'prazer sem culpa' diet framing; No nutrition table; No importer named |
| 148 | Orion Milho Agridoce Picante 35g | 2025 | critical | 'baixa caloria' claim; Out of stock; No nutrition table |
| 149 | O'star Orion 30g Maionese | 2025 | critical | Text says 'como kimchi'; Shared SKU SNK-BAT-OST-ORI-30G; 'baixa caloria' claim |
| 150 | Marine Boy Orion Camarão 30g | 2025 | critical | Keep: has copy 864; 'baixa caloria' claim; Out of stock |
| 151 | Orion Tok 38g 'Sabores' | 2025 | high | Flavour not stated ('Sabores'); Out of stock; No nutrition table |
| 154 | Soju Chum-Churum Lotte Morango 360ml | 2025 | medium | ABV only in attributes; Weight differs from same line; In 'Ofertas Mimos', no sale |
| 155 | Soju Chum-Churum Lotte Original 360ml | 2025 | high | Out of stock; ABV 12% to verify (Original); Weight differs from same line |
| 156 | Soju Chum-Churum Lotte Pêssego 360ml | 2025 | critical | Price R$ 0,00 while in stock; In 'Ofertas Mimos', no sale; No importer named |
| 160 | Topokki Yopokki Youngpoong 120g Copo Sabores | 2025 | high | Flavour not stated ('Sabores'); Out of stock; No nutrition table |
| 231 | O'star Orion 30g Kimchi | 2025 | high | Shared SKU SNK-BAT-OST-ORI-30G; 'baixa caloria' claim; Out of stock |
| 233 | O'star Orion 30g Barbecue Frango | 2025 | critical | Text says 'como kimchi'; Shared SKU SNK-BAT-OST-ORI-30G; 'baixa caloria' claim |
| 235 | O'star Orion 30g Queijo Duplo | 2025 | critical | Keep: has copies 954, 1021; Text says 'como kimchi'; Shared SKU SNK-BAT-OST-ORI-30G |
| 237 | O'star Orion 30g Bife Americano | 2025 | critical | Keep: has copies 952, 1019; Text says 'como kimchi'; Shared SKU SNK-BAT-OST-ORI-30G |
| 242 | Sac Sac Lotte 238ml Uva Verde | 2025 | critical | Keep: has copy 253; Shared SKU REF-SAC-LT-238; Out of stock |
| 253 | Sac Sac Lotte 240ml Uva Verde | 2025 | critical | Duplicate of 242 ('-2' slug); Shared SKU REF-SAC-LT-238; Out of stock |
| 259 | ChocoPie Chocolate 180g Orion | 2025 | critical | 'Sem Glúten' but contains wheat; Shared SKU BLN-CHP-LT-CHC; Weight below net content |
| 263 | O'Rice Orion 129g Natural | 2025 | high | Text copied across flavours; Shared SKU BSC-ARR-ORC-ORI-129G; 'baixa caloria' claim |
| 265 | O'Rice Orion 129g Alga | 2025 | high | Text copied across flavours; Shared SKU BSC-ARR-ORC-ORI-129G; 'baixa caloria' claim |
| 269 | Pepero Lotte 47g Original | 2025 | high | Text copied across flavours; Shared SKU BSC-PPR-LT-47G; Out of stock |
| 271 | Pepero Lotte 47g Choco Cookie | 2025 | high | Text copied across flavours; Shared SKU BSC-PPR-LT-47G; Out of stock |
| 273 | Pepero Lotte 47g Amêndoa | 2025 | high | Text copied across flavours; Shared SKU BSC-PPR-LT-47G; Out of stock |
| 277 | Milkis Lotte 250ml Melão | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 279 | Milkis Lotte 250ml Banana | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 281 | Milkis Lotte 250ml Uva | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 283 | Milkis Lotte 250ml Morango | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 285 | Milkis Lotte 250ml Pêssego | 2025 | critical | Text names other flavours; Shared SKU REF-MLK-LT-250; Out of stock |
| 810 | Soju Lotte Chum Churum 360ml Maçã Verde | 2026 | critical | No ABV, no 18+ notice; Lists flavours it does not sell; Marketplace CDN image |
| 813 | Soju Lotte Chum Churum 360ml Blueberry | 2026 | critical | No ABV, no 18+ notice; Lists flavours it does not sell; Marketplace CDN image |
| 815 | Soju Lotte Chum Churum 360ml Lichia | 2026 | critical | No ABV, no 18+ notice; Lists flavours it does not sell; Marketplace CDN image |
| 817 | Soju Lotte Chum Churum 360ml Ameixa | 2026 | critical | No ABV, no 18+ notice; Lists flavours it does not sell; Marketplace CDN image |
| 819 | Soju Lotte Saero 360ml Original Sem Açúcar | 2026 | critical | No ABV, no 18+ notice; Text describes Chum Churum, not Saero; Marketplace CDN image |
| 822 | Soju Lotte Saero 360ml Lichia Sem Açúcar | 2026 | critical | No ABV, no 18+ notice; Text describes Chum Churum, not Saero; Marketplace CDN image |
| 825 | Soju Lotte Saero 360ml Damasco Sem Açúcar | 2026 | critical | No ABV, no 18+ notice; Text describes Chum Churum, not Saero; Marketplace CDN image |
| 827 | Soju Lotte Saero 360ml Kiwi Sem Açúcar | 2026 | critical | No ABV, no 18+ notice; Text describes Chum Churum, not Saero; Marketplace CDN image |
| 829 | Kit 6 Soju Chum Churum sortido | 2026 | critical | No ABV, no 18+ notice; Text says '5 ou 6 garrafas'; Marketplace CDN image |
| 831 | Kit 4 Soju Saero Sem Açúcar | 2026 | critical | No ABV, no 18+ notice; Text describes Chum Churum, not Saero; Marketplace CDN image |
| 833 | Mamadeira Chuyin 280ml Vidro Original | 2026 | critical | Lists flavours it does not sell; Marketplace CDN image; No SKU |
| 838 | Mamadeira Chuyin 280ml Vidro Manga | 2026 | critical | Lists flavours it does not sell; Marketplace CDN image; No SKU |
| 840 | Mamadeira Chuyin 280ml Vidro Melão | 2026 | critical | Lists flavours it does not sell; Marketplace CDN image; No SKU |
| 842 | Yantai suco 238ml Morango | 2026 | high | Lists flavours it does not sell; Screenshot as photo; Weight below net content |
| 846 | Yantai suco 238ml Pêssego | 2026 | high | Lists flavours it does not sell; Screenshot as photo; Weight below net content |
| 849 | Yantai suco 238ml Uva | 2026 | high | Lists flavours it does not sell; Screenshot as photo; Weight below net content |
| 852 | Yantai suco 238ml Lichia | 2026 | high | Lists flavours it does not sell; Screenshot as photo; Weight below net content |
| 855 | Chuyin suco 500ml Morango | 2026 | high | Lists flavours it does not sell; Weight below net content; Placeholder box 5x5x10 cm |
| 858 | Chuyin suco 500ml Uva | 2026 | high | Lists flavours it does not sell; Weight below net content; Placeholder box 5x5x10 cm |
| 860 | Chuyin suco 500ml Lichia | 2026 | high | Lists flavours it does not sell; Weight below net content; Placeholder box 5x5x10 cm |
| 864 | Marine Boy Orion Camarão 30g | 2026 | critical | Duplicate of 150; Marketplace CDN image; No SKU |
| 867 | CornChip Orion Milho Assado 70g | 2026 | critical | Placeholder box 5x5x10 cm; Marketplace CDN image; No SKU |
| 871 | Koony Orion Chili Picante 40g | 2026 | critical | Placeholder box 5x5x10 cm; Marketplace CDN image; No SKU |
| 875 | Masita TurtleChips Orion Milho Agridoce 60g | 2026 | critical | Lists flavours it does not sell; Placeholder box 5x5x10 cm; No SKU |
| 879 | Masita TurtleChips Orion Alga Marinha 60g | 2026 | critical | Corn image on seaweed listing; Lists flavours it does not sell; Placeholder box 5x5x10 cm |
| 890 | Sakuragi bala Tortinha 40g | 2026 | critical | Promo banner as photo; AI-generated image; Placeholder box 5x5x10 cm |
| 894 | Sakuragi bala 4D 50g Morango | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; Placeholder box 5x5x10 cm |
| 899 | Sakuragi bala 4D 50g Uva | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; Placeholder box 5x5x10 cm |
| 902 | Sakuragi bala 4D 50g Maçã | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 905 | Sakuragi bala 70% fruta 32g Morango | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 908 | Sakuragi bala 70% fruta 32g Blueberry | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 910 | Sakuragi bala 70% fruta 32g Limão com Sal | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 912 | Sakuragi biscoito 80g Abóbora | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 916 | Sakuragi biscoito 80g Batata Doce | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 919 | Sakuragi Animais 130g Chocolate | 2026 | critical | Korean flag, text says China/Vietnam; Lists flavours it does not sell; Promo banner as photo |
| 923 | Sakuragi Animais 130g Leite | 2026 | critical | Korean flag, text says China/Vietnam; Lists flavours it does not sell; Promo banner as photo |
| 926 | Sakuragi bala hortelã 16g Melancia | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 932 | Sakuragi bala hortelã 16g Café | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 933 | Sakuragi bala hortelã 16g Pêssego | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 934 | Sakuragi Wafer Cubos 65g Queijo | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 939 | Sakuragi Wafer Cubos 65g Sorvete Leite | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 941 | Sakuragi Wafer 5 Camadas 110g Chocolate | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 946 | Sakuragi Wafer 5 Camadas 110g Sorvete Leite | 2026 | critical | Lists flavours it does not sell; Promo banner as photo; AI-generated image |
| 948 | Orion Toonies Chocolate 60g | 2026 | critical | WhatsApp export as photo; Placeholder box 5x5x10 cm; No SKU |
| 952 | O'Star Orion 30g Bife Americano NY | 2026 | critical | Duplicate of 237; Lists flavours it does not sell; No SKU |
| 954 | O'Star Orion 30g Queijo Duplo | 2026 | critical | Duplicate of 235; Lists flavours it does not sell; No SKU |
| 957 | Mochila Escolar 25L Cinza | 2026 | critical | Text says 'cor azul'; Placeholder box 5x5x10 cm; Marketplace CDN image |
| 967 | Mochila Escolar 25L Rosa | 2026 | critical | Text says 'cor azul'; Placeholder box 5x5x10 cm; Marketplace CDN image |
| 968 | Mochila Escolar 25L Verde | 2026 | critical | Text says 'cor azul'; Placeholder box 5x5x10 cm; Marketplace CDN image |
| 969 | Mochila Executiva 29L Bege | 2026 | high | Placeholder box 5x5x10 cm; No SKU; Junk image name |
| 980 | Mochila Executiva 29L Preto | 2026 | critical | Promo banner as photo; Placeholder box 5x5x10 cm; No SKU |
| 981 | Mochila Executiva 29L Rosa | 2026 | high | Placeholder box 5x5x10 cm; No SKU; Junk image name |
| 985 | Mochila Premium Preta | 2026 | high | Promo banner as photo; Possible duplicate of 993 (check); No SKU |
| 993 | Mochila Faculdade Preta | 2026 | high | Possible duplicate of 985 (check); No SKU; Junk image name |
| 1007 | Orion Custard 12 un 276g | 2026 | critical | Marketplace CDN image; No SKU; No brand |
| 1011 | Orion BongBang 5 un 140g | 2026 | critical | Images show 174g packs, listing is 140g; Korean flag, text says China/Vietnam; No SKU |
| 1016 | Orion Miz Chocolate 54g | 2026 | critical | Marketplace CDN image; No SKU; No brand |
| 1019 | O'Star Orion 30g Bife NY | 2026 | critical | Duplicate of 237; Lists flavours it does not sell; Marketplace CDN image |
| 1021 | O'Star Orion 30g Queijo Duplo | 2026 | critical | Duplicate of 235; Lists flavours it does not sell; No SKU |

---

## Appendix B. Data files index

| File | What it contains |
|---|---|
| `audit/data/README.md` | How the snapshot was captured; the Exa HTML-tag limitation |
| `audit/data/raw/store_products.json` | Store API products (103): prices, stock, SKU, images, attributes, brands |
| `audit/data/raw/wp_products.json` | WordPress products (103): dates, categories including the default category |
| `audit/data/raw/wp_media.json` | Public images (195): file, date, uploader ID, parent post, alt text |
| `audit/data/raw/wp_pages.json` | Published pages (10) |
| `audit/data/raw/product_categories.json`, `product_tags.json`, `product_brands.json` | Taxonomies (24, 221, 23 terms) |
| `audit/data/raw/media_total_probe.json` | Proof that 204 images exist (195 public) |
| `audit/data/raw/id_probe.json` | Status codes for every unknown ID: hidden products, hidden images, other |
| `audit/data/derived/summary.json` | Headline numbers |
| `audit/data/derived/product_scorecard.json` / `.csv` | One row per product with all metrics |
| `audit/data/derived/duplicate_candidates.json` | Heuristic duplicate pairs and clusters (not verified) |
| `audit/data/derived/duplicate_verification.json` | Two verifier lenses: duplicate groups, variant families, wrong images |
| `audit/data/derived/variant_families.json` | Heuristic flavour and colour families |
| `audit/data/derived/taxonomy_audit.json` | Category, tag and brand health |
| `audit/data/derived/media_audit.json` | One row per public image: class, parent, reuse |
| `audit/data/derived/id_space.json` | Class of every ID from 1 to 1054, ranges and eras |
| `audit/data/derived/product_reviews.json` | One structured review per product (103) |
| `audit/data/derived/storefront_findings.json` | Live storefront crawl findings |
| `audit/data/derived/external_index_findings.json` | Search index and marketplace findings |
| `audit/data/derived/regulatory_matrix.json` | Brazilian requirements per product kind, with sources and confidence |
| `audit/data/derived/channel_feed_findings.json` | Google and Meta catalogue findings |
| `audit/data/derived/completeness_critic.json` | Gaps, contradictions and claims to verify |
| `audit/sql/diagnostics.sql` | 21 read-only SQL queries for the admin-side gaps |
| `audit/scripts/collect_public_catalog.py` | Re-collects the public snapshot over HTTP |
| `audit/scripts/analyze_catalog.py` | Rebuilds the deterministic derived files |
| `studio/` | Mimos Catalog Studio (section 14b) |
