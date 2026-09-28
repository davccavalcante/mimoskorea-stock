#!/usr/bin/env python3
"""
Seed the local staging WooCommerce with a mirror of the production catalog.

Reads the public snapshot captured by the audit (audit/data/raw/) and recreates,
through the WooCommerce REST API of the staging site:

  - every product category (including the empty ones)
  - every product brand
  - every published product (name, slug, SKU, price, stock status, categories,
    brands, weight, dimensions, descriptions, custom attributes)

Images are not copied (the staging site cannot download from production). The
point of the mirror is to exercise duplicate detection and stock updates
against real names, SKUs and taxonomy.

Stdlib only. Usage:
  STAGING_URL=http://localhost:8080 STAGING_USER=admin STAGING_APP_PASSWORD=xxxx \
    python3 staging/seed_from_snapshot.py
"""

import base64
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "audit" / "data" / "raw"

BASE = os.environ.get("STAGING_URL", "http://localhost:8080").rstrip("/")
USER = os.environ.get("STAGING_USER", "admin")
APP_PASSWORD = os.environ.get("STAGING_APP_PASSWORD", "")

if not APP_PASSWORD:
    sys.exit("STAGING_APP_PASSWORD is required (see staging/README.md)")

AUTH = "Basic " + base64.b64encode(f"{USER}:{APP_PASSWORD}".encode()).decode()


# =============================================================================
# HTTP
# =============================================================================


def call(method, path, body=None, params=None):
    url = f"{BASE}/wp-json{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": AUTH,
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}") from None


def list_all(path, params=None):
    out, page = [], 1
    while True:
        batch = call("GET", path, params={"per_page": 100, "page": page, **(params or {})})
        out.extend(batch)
        if len(batch) < 100:
            return out
        page += 1


def load(name):
    return json.loads((RAW / name).read_text(encoding="utf-8"))["data"]


def text(value):
    return html.unescape(value or "").replace("<\\/", "</")


# =============================================================================
# Seed
# =============================================================================


def seed_categories():
    wanted = load("product_categories.json")
    existing = {c["slug"]: c["id"] for c in list_all("/wc/v3/products/categories", {"hide_empty": "false"})}
    mapping = {}
    for c in sorted(wanted, key=lambda x: x["parent"]):
        if c["slug"] not in existing:
            created = call("POST", "/wc/v3/products/categories", {"name": html.unescape(c["name"]), "slug": c["slug"]})
            existing[c["slug"]] = created["id"]
        mapping[c["id"]] = existing[c["slug"]]
    print(f"categories: {len(mapping)}")
    return mapping


def seed_brands():
    wanted = load("product_brands.json")
    existing = {b["slug"]: b["id"] for b in list_all("/wc/v3/products/brands")}
    mapping = {}
    for b in wanted:
        if b["slug"] not in existing:
            created = call("POST", "/wc/v3/products/brands", {"name": html.unescape(b["name"]), "slug": b["slug"]})
            existing[b["slug"]] = created["id"]
        mapping[b["id"]] = existing[b["slug"]]
    print(f"brands: {len(mapping)}")
    return mapping


def seed_products(cat_map, brand_map):
    store = load("store_products.json")
    wp = {p["id"]: p for p in load("wp_products.json")}
    existing_slugs = {p["slug"] for p in list_all("/wc/v3/products", {"status": "any"})}
    created = skipped = 0
    for p in sorted(store, key=lambda x: x["id"]):
        if p["slug"] in existing_slugs:
            skipped += 1
            continue
        out_of_stock = p["stock_availability"]["class"] == "out-of-stock"
        body = {
            "name": html.unescape(p["name"]),
            "slug": p["slug"],
            "type": "simple",
            "status": "publish",
            "regular_price": f'{int(p["prices"]["regular_price"] or 0) / 100:.2f}',
            "description": text(p["description"]),
            "short_description": text(p["short_description"]),
            "manage_stock": True,
            "stock_quantity": 0 if out_of_stock else 10,
            "weight": p["weight"] or "",
            "dimensions": {k: (p["dimensions"] or {}).get(k, "") for k in ("length", "width", "height")},
            "categories": [{"id": cat_map[c]} for c in wp.get(p["id"], {}).get("product_cat", []) if c in cat_map],
            "brands": [{"id": brand_map[b]} for b in wp.get(p["id"], {}).get("product_brand", []) if b in brand_map],
            "attributes": [
                {"name": html.unescape(a["name"]), "options": [html.unescape(t["name"]) for t in a["terms"]], "visible": True}
                for a in p["attributes"]
            ],
            "meta_data": [{"key": "_production_id", "value": str(p["id"])}],
        }
        # Duplicated SKUs exist in production; WooCommerce rejects them, so keep only the first.
        if p["sku"]:
            body["sku"] = p["sku"]
        try:
            call("POST", "/wc/v3/products", body)
        except RuntimeError as e:
            if "product_invalid_sku" in str(e) or "sku" in str(e).lower():
                body.pop("sku", None)
                body["meta_data"].append({"key": "_production_sku_duplicate", "value": p["sku"]})
                call("POST", "/wc/v3/products", body)
            else:
                raise
        created += 1
    print(f"products: created {created}, already present {skipped}")


if __name__ == "__main__":
    cats = seed_categories()
    brands = seed_brands()
    seed_products(cats, brands)
