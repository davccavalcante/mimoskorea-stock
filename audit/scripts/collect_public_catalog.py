#!/usr/bin/env python3
"""
Collect a fresh public snapshot of the Mimos Korea catalog directly over HTTP.

Use this from any machine that can reach https://mimoskorea.com.br (the
original audit ran in a sandbox whose proxy blocked the domain, so the first
snapshot was captured through the Exa fetch service instead; see
audit/data/README.md).

It writes the same files that audit/scripts/analyze_catalog.py expects:

  audit/data/raw/store_products.json      WooCommerce Store API products (full records)
  audit/data/raw/wp_products.json         WP core view of products (dates, terms, featured image)
  audit/data/raw/wp_media.json            media library (public attachments only)
  audit/data/raw/wp_pages.json            published pages
  audit/data/raw/product_categories.json  all product categories (including empty ones)
  audit/data/raw/product_tags.json        all product tags (including orphans)
  audit/data/raw/product_brands.json      all product brands (including empty ones)
  audit/data/raw/media_total_probe.json   total media count (X-WP-Total) vs publicly visible
  audit/data/raw/id_probe.json            optional (--probe-ids): status of every post ID

Stdlib only. Usage:
  python3 audit/scripts/collect_public_catalog.py
  python3 audit/scripts/collect_public_catalog.py --probe-ids --max-id 1100
"""

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

BASE = "https://mimoskorea.com.br"
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
UA = "mimoskorea-catalog-audit/1.0 (+internal audit)"

# =============================================================================
# HTTP helpers
# =============================================================================


def get(path, params=None, retries=3):
    """GET a JSON endpoint. Returns (status, headers, body_or_None)."""
    query = ""
    if params:
        query = "?" + "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{BASE}{path}{query}"
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, dict(resp.headers), json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return e.code, dict(e.headers or {}), None
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    return 0, {}, None


def paginate(path, params):
    """Fetch every page of a WP/WC collection endpoint."""
    items, urls, page = [], [], 1
    while True:
        p = dict(params, page=page)
        status, headers, body = get(path, p)
        urls.append(f"{BASE}{path}?" + "&".join(f"{k}={v}" for k, v in p.items()))
        if status == 400 or not body:
            break
        items.extend(body)
        total_pages = int(headers.get("X-WP-TotalPages") or headers.get("x-wp-totalpages") or 0)
        if total_pages and page >= total_pages:
            break
        page += 1
    return urls, items


def save(name, urls, data, **extra):
    RAW.mkdir(parents=True, exist_ok=True)
    payload = {"source_urls": urls, "captured_at": date.today().isoformat(), "count": len(data), "data": data, **extra}
    (RAW / name).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{name}: {len(data)} records")


# =============================================================================
# Collection
# =============================================================================

WP_PRODUCT_FIELDS = ("id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,featured_media,"
                     "template,product_brand,product_cat,product_tag,class_list")
MEDIA_FIELDS = "id,date,modified,slug,title,post,source_url,mime_type,alt_text,author,media_details"


def collect():
    save("store_products.json", *paginate("/wp-json/wc/store/v1/products", {"per_page": 100}))
    save("wp_products.json", *paginate("/wp-json/wp/v2/product", {"per_page": 100, "_fields": WP_PRODUCT_FIELDS}))
    urls, media = paginate("/wp-json/wp/v2/media", {"per_page": 100, "_fields": MEDIA_FIELDS})
    save("wp_media.json", urls, media)
    save("wp_pages.json", *paginate("/wp-json/wp/v2/pages", {"per_page": 100, "_fields": "id,date,modified,slug,status,link,title,parent,template"}))
    for name, tax in (("product_categories.json", "product_cat"), ("product_tags.json", "product_tag"), ("product_brands.json", "product_brand")):
        save(name, *paginate(f"/wp-json/wp/v2/{tax}", {"per_page": 100, "hide_empty": "false", "_fields": "id,count,name,slug,parent,description"}))

    # X-WP-Total counts every attachment, including those hidden because their parent is not public.
    _, headers, _ = get("/wp-json/wp/v2/media", {"per_page": 1, "_fields": "id"})
    total = int(headers.get("X-WP-Total") or headers.get("x-wp-total") or 0)
    probe = {"method": "X-WP-Total header of /wp-json/wp/v2/media", "media_total_in_database": total,
             "media_visible_publicly": len(media), "media_hidden": total - len(media),
             "captured_at": date.today().isoformat()}
    (RAW / "media_total_probe.json").write_text(json.dumps(probe, indent=1), encoding="utf-8")
    print(f"media_total_probe.json: total={total} visible={len(media)}")


def probe_ids(max_id, known):
    """
    Classify every post ID through public status codes:
      /wp/v2/product/{id}: 200 published, 401 exists but not public (draft/pending/private/trash/auto-draft), 404 not a product
      /wp/v2/media/{id}:   401 attachment hidden because its parent is not public
    """
    out = {"hidden_product_ids": [], "published_product_ids": [], "hidden_media_ids": [], "other_ids": [], "errors": []}
    for i in range(1, max_id + 1):
        if i in known:
            continue
        status, _, _ = get(f"/wp-json/wp/v2/product/{i}", {"_fields": "id"})
        if status == 200:
            out["published_product_ids"].append(i)
        elif status in (401, 403):
            out["hidden_product_ids"].append(i)
        elif status == 404:
            m_status, _, _ = get(f"/wp-json/wp/v2/media/{i}", {"_fields": "id"})
            (out["hidden_media_ids"] if m_status in (401, 403) else out["other_ids"]).append(i)
        else:
            out["errors"].append({"id": i, "status": status})
        time.sleep(0.2)  # be gentle with the shared host
    out["captured_at"] = date.today().isoformat()
    (RAW / "id_probe.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"id_probe.json: hidden products={len(out['hidden_product_ids'])} hidden media={len(out['hidden_media_ids'])}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe-ids", action="store_true", help="also classify every post ID (slow: ~2 requests per unknown ID)")
    ap.add_argument("--max-id", type=int, default=1100)
    a = ap.parse_args()
    collect()
    if a.probe_ids:
        load = lambda n: json.loads((RAW / n).read_text(encoding="utf-8"))["data"]
        known = {p["id"] for p in load("store_products.json")} | {m["id"] for m in load("wp_media.json")} | {p["id"] for p in load("wp_pages.json")}
        probe_ids(a.max_id, known)
