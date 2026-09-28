#!/usr/bin/env python3
"""
Deterministic catalog audit for the Mimos Korea WooCommerce store.

Reads the public-API snapshots in audit/data/raw/ and writes derived
datasets to audit/data/derived/:

  product_scorecard.csv     one row per published product (completeness + quality metrics)
  product_scorecard.json    same data, JSON
  duplicate_candidates.json candidate duplicate pairs/clusters (to be verified by a human/agent)
  variant_families.json     groups of simple products that should be one variable product
  taxonomy_audit.json       categories / tags / brands health
  media_audit.json          media library health
  summary.json              headline numbers used by the report

Stdlib only. Usage:
  python3 audit/scripts/analyze_catalog.py
"""

import csv
import hashlib
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "derived"

# =============================================================================
# Loading
# =============================================================================


def load(name):
    return json.loads((RAW / name).read_text(encoding="utf-8"))["data"]


store_products = load("store_products.json")
wp_products = {p["id"]: p for p in load("wp_products.json")}
media = load("wp_media.json")
categories = load("product_categories.json")
tags = load("product_tags.json")
brands = load("product_brands.json")
media_probe = json.loads((RAW / "media_total_probe.json").read_text(encoding="utf-8"))

media_by_id = {m["id"]: m for m in media}

# =============================================================================
# Text helpers
# =============================================================================

EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # pictographs, emoticons, transport, supplemental symbols
    "\U00002600-\U000027BF"  # misc symbols + dingbats (includes the check mark U+2705 range neighbours)
    "\U00002B00-\U00002BFF"  # arrows, stars
    "\U0000FE0F"             # variation selector-16
    "\U0000200D"             # zero width joiner
    "\U00002190-\U000021FF"  # arrows
    "\U00003030\U0000303D\U00003297\U00003299"
    "\U000024C2\U00002122\U00002139"
    "]"
)
# Characters that are part of emoji sequences but not "visible" emoji on their own.
EMOJI_JOINERS = {"️", "‍"}

TAG_RE = re.compile(r"<[^>]*>")


def strip_html(s):
    """Remove HTML remnants. Note: the snapshot lost opening tags (see data README)."""
    s = s or ""
    s = s.replace("<\\/", "</")
    s = TAG_RE.sub(" ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def count_emoji(s):
    return sum(1 for ch in (s or "") if EMOJI_RE.match(ch) and ch not in EMOJI_JOINERS)


def fold(s):
    """Lowercase, remove accents, normalise quotes."""
    s = html.unescape(s or "").replace("’", "'").replace("‘", "'")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower()


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+|\s{2,}|(?<=\S)\s(?=[✅✔])", text)
    return [p.strip() for p in parts if len(p.strip()) >= 25]


# =============================================================================
# Content checks (regex heuristics, Portuguese)
# =============================================================================

CHECKS = {
    "nutrition_facts": r"tabela nutricional|informac(?:ao|oes) nutriciona|valor energetico|\bkcal\b|carboidrato|proteina|gorduras? (?:totais|saturadas)|sodio|porcao de",
    "ingredients": r"ingrediente",
    "allergens": r"alergic|contem gluten|nao contem gluten|contem leite|pode conter|contem derivados|contem soja|contem trigo",
    "shelf_life": r"validade|consumir (?:ate|antes)|prazo de|shelf",
    "storage": r"conservar|armazen|local seco|manter refrigerad|apos aberto",
    "country_of_origin": r"coreia|china|japao|taiwan|tailandia|origem|importad|fabricado (?:na|no|em)",
    "importer_info": r"importado (?:por|e distribuido)|importador|cnpj",
    "alcohol_abv": r"teor alcoolico|% ?vol\b|\babv\b|graduacao alcoolica|\d+(?:[.,]\d+)? ?% (?:de )?(?:alcool|teor)",
    "age_18_warning": r"maiores de 18|menores de 18|\+18|18 anos|proibid[ao] para menores|venda proibida",
    "drink_responsibly": r"beba com moderacao|aprecie com moderacao|consumo moderado|com moderacao",
    "material": r"material|poliester|nylon|algodao|\bpvc\b|plastico|tecido|oxford|espuma|fibra|poliuretano|couro|vidro|silicone|acrilic",
    "dimensions_text": r"\d+(?:[.,]\d+)? ?(?:cm|mm)\b|\d+ ?x ?\d+",
    "capacity": r"\d+(?:[.,]\d+)? ?(?:l|litros?)\b",
    "care_instructions": r"lavar|lavagem|lave |limpeza|limpar|nao usar alvejante|secar",
    "age_range": r"(?:idade|faixa etaria|a partir de|acima de) ?\d|\d+ ?(?:anos|meses)\b|\b\d\+",
    "inmetro": r"inmetro",
    "warranty": r"garantia",
    "anvisa": r"anvisa",
}
CHECKS = {k: re.compile(v) for k, v in CHECKS.items()}

GENERIC_CATEGORY_SLUGS = {"comida-e-bebida", "ofertas-mimos"}
STORE_NAME_RE = re.compile(r"mimos korea(?: design)?|\bmimos\b|\bmkd\b")
SHOPEE_IMG_RE = re.compile(r"^(?:br|sg|my|ph|th|vn|tw|id)-\d{8}-[0-9a-z]{5}-[0-9a-z]+", re.I)
JUNK_IMG_RE = re.compile(
    r"^(?:z+|x+|a+|teste?|test|image\d*|img[-_ ]?\d*|foto\d*|imagem\d*|whatsapp.*|screenshot.*|captura.*|"
    r"design-sem-nome.*|sem-titulo.*|untitled.*|download.*|\d+|[0-9a-f]{16,})(?:-\d+)?(?:-scaled)?$",
    re.I,
)

# Words that identify a product "flavour/colour/variant" in titles.
VARIANT_RE = re.compile(r"\b(?:sabor(?:es)?|cor)\b\s+([^|,]+)", re.I)
NET_CONTENT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s?(ml|g|kg)\b", re.I)


MERCADOLIVRE_IMG_RE = re.compile(r"^d_nq_np_|^d_q_np_|-ml[abcmu]\d{6,}", re.I)
AMAZON_IMG_RE = re.compile(r"^[0-9][0-9a-z+%-]{8,}\._(?:ac|sx|sy|sl|ux|uy)[_a-z0-9,]*", re.I)
AI_IMG_RE = re.compile(r"chatgpt[ _-]image|dall[ _-]?e|midjourney|gemini[ _-]generated|firefly", re.I)
SCREENSHOT_RE = re.compile(r"^capturar|captura de tela|screenshot|print[ _-]?screen|^screen[ _-]", re.I)
PROMO_IMG_RE = re.compile(r"desconto|promo|oferta|black[ _-]?friday|frete gr", re.I)
WHATSAPP_IMG_RE = re.compile(r"whatsapp", re.I)


def classify_image_name(name):
    base = (name or "").strip().lower()
    if SHOPEE_IMG_RE.match(base):
        return "shopee_cdn_hash"
    if MERCADOLIVRE_IMG_RE.search(base):
        return "mercadolivre_cdn_copy"
    if AMAZON_IMG_RE.search(base):
        return "amazon_cdn_copy"
    if AI_IMG_RE.search(base):
        return "ai_generated_image"
    if SCREENSHOT_RE.search(base):
        return "screenshot"
    if WHATSAPP_IMG_RE.search(base):
        return "whatsapp_export"
    if PROMO_IMG_RE.search(base):
        return "promo_banner"
    if JUNK_IMG_RE.match(base) or len(base) <= 8:
        return "junk_name"
    if len(base) >= 12 and "-" in base:
        return "descriptive"
    return "short_or_unclear"


def net_content_grams(title):
    """Return net content in grams/ml from a title, or None."""
    m = NET_CONTENT_RE.search(fold(title))
    if not m:
        return None
    value = float(m.group(1).replace(",", "."))
    unit = m.group(2).lower()
    return value * (1000 if unit == "kg" else 1)


def title_core(title):
    """Normalised token set used for duplicate / family detection."""
    t = fold(title)
    t = STORE_NAME_RE.sub(" ", t)
    t = re.sub(r"\b(?:importad[oa]s?|coreian?[oa]s?|coreano|coreana|koreia|kpop|k-pop|k-snacks?|bebida|snack|salgadinhos?|"
               r"original de|de|da|do|com|c/|e|para|premium|sabor(?:es)?|cor|un|unidades?|caixa|crocante|batata frita|"
               r"design)\b", " ", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    return set(w for w in t.split() if len(w) > 1)


def jaccard(a, b):
    return len(a & b) / len(a | b) if a | b else 0.0


# =============================================================================
# Per-product scorecard
# =============================================================================

sentence_freq = Counter()
product_text = {}
for p in store_products:
    text = strip_html(p["description"]) + " " + strip_html(p["short_description"])
    product_text[p["id"]] = text
    for s in set(sentences(text)):
        sentence_freq[fold(s)] += 1

sku_counter = Counter(p["sku"].strip() for p in store_products if p["sku"].strip())
desc_hash_counter = Counter(
    hashlib.sha1(fold(strip_html(p["description"])).encode()).hexdigest()
    for p in store_products
    if strip_html(p["description"])
)
featured_counter = Counter(p["images"][0]["id"] for p in store_products if p["images"])
category_slug_by_id = {c["id"]: c["slug"] for c in categories}
image_users = defaultdict(set)
for _p in store_products:
    for _im in _p["images"]:
        image_users[_im["name"]].add(_p["id"])


def attributes_text(p):
    return " ".join(
        f'{a["name"]}: ' + ", ".join(t["name"] for t in a.get("terms", [])) for a in p.get("attributes", [])
    )

rows = []
for p in store_products:
    pid = p["id"]
    wp = wp_products.get(pid, {})
    name = html.unescape(p["name"])
    desc_text = strip_html(p["description"])
    short_text = strip_html(p["short_description"])
    attr_text = html.unescape(attributes_text(p))
    desc_folded = fold(desc_text + " " + short_text + " " + attr_text)

    image_ids = [im["id"] for im in p["images"]]
    unique_image_ids = list(dict.fromkeys(image_ids))
    image_names = [p["images"][image_ids.index(i)]["name"] for i in unique_image_ids]
    image_classes = [classify_image_name(n) for n in image_names]
    image_formats = [p["images"][image_ids.index(i)]["src"].rsplit(".", 1)[-1].lower() for i in unique_image_ids]
    alt_empty = sum(1 for im in p["images"] if not (im.get("alt") or "").strip())
    images_owned_by_other_post = [
        i for i in unique_image_ids if media_by_id.get(i, {}).get("post") not in (pid, None)
    ]

    # The Store API omits the default category (id 15, "Ofertas Mimos"), so use the WP core terms.
    cat_slugs = [category_slug_by_id[c] for c in wp.get("product_cat", []) if c in category_slug_by_id]
    tag_names = [html.unescape(t["name"]) for t in p["tags"]]
    brand_names = [html.unescape(b["name"]) for b in p["brands"]]

    doc_sentences = set(fold(s) for s in sentences(desc_text + " " + short_text))
    boiler = [s for s in doc_sentences if sentence_freq[s] >= 3]
    boilerplate_ratio = round(len(boiler) / len(doc_sentences), 2) if doc_sentences else None

    price = int(p["prices"]["price"] or 0) / 100
    regular = int(p["prices"]["regular_price"] or 0) / 100
    weight = float(p["weight"]) if p["weight"] else None
    dims = p["dimensions"] or {}
    dims_missing = [k for k in ("length", "width", "height") if not dims.get(k)]
    net_g = net_content_grams(name)

    slug = p["slug"]
    slug_flags = []
    if re.search(r"-\d+$", slug):
        slug_flags.append("numeric_suffix(slug_collision)")
    if re.search(r"copia|copy|duplicad", slug):
        slug_flags.append("copy_marker")
    if len(slug) > 75:
        slug_flags.append("too_long")

    title_flags = []
    if len(name) > 70:
        title_flags.append("longer_than_70_chars")
    if name.count("|") >= 2:
        title_flags.append("pipe_keyword_stuffing")
    if STORE_NAME_RE.search(fold(name)):
        title_flags.append("store_name_in_title")
    if re.search(r",\s*(?:koreia|kpop|coreia)", fold(name)):
        title_flags.append("keyword_list_in_title")
    if count_emoji(name):
        title_flags.append("emoji_in_title")
    if re.search(r"\bsabores\b|\bvarios sabores\b", fold(name)):
        title_flags.append("ambiguous_multi_flavour_title")
    if re.search(r"koreia|ceral\b", fold(name)):
        title_flags.append("spelling_error")

    checks = {k: bool(rx.search(desc_folded)) for k, rx in CHECKS.items()}

    rows.append({
        "id": pid,
        "name": name,
        "slug": slug,
        "permalink": p["permalink"],
        "created": wp.get("date"),
        "modified": wp.get("modified"),
        "type": p["type"],
        "sku": p["sku"].strip(),
        "sku_missing": not p["sku"].strip(),
        "sku_duplicated": bool(p["sku"].strip()) and sku_counter[p["sku"].strip()] > 1,
        "price_brl": price,
        "regular_price_brl": regular,
        "on_sale": p["on_sale"],
        "price_zero": price == 0,
        "stock_class": p["stock_availability"]["class"],
        "stock_text": p["stock_availability"]["text"],
        "low_stock_remaining": p["low_stock_remaining"],
        "is_purchasable": p["is_purchasable"],
        "images_count": len(unique_image_ids),
        "images_repeated_entries": len(image_ids) - len(unique_image_ids),
        "image_names": image_names,
        "image_name_classes": image_classes,
        "image_formats": image_formats,
        "images_alt_empty": alt_empty,
        "images_owned_by_other_post": images_owned_by_other_post,
        "featured_image_shared_with_other_products": bool(p["images"]) and featured_counter[p["images"][0]["id"]] > 1,
        "description_chars": len(desc_text),
        "description_words": len(desc_text.split()),
        "short_description_chars": len(short_text),
        "description_missing": len(desc_text) == 0,
        "description_thin": 0 < len(desc_text.split()) < 60,
        "short_description_missing": len(short_text) == 0,
        "description_identical_to_other_product": bool(desc_text)
        and desc_hash_counter[hashlib.sha1(fold(desc_text).encode()).hexdigest()] > 1,
        "boilerplate_ratio": boilerplate_ratio,
        "emoji_title": count_emoji(name),
        "emoji_description": count_emoji(desc_text),
        "emoji_short_description": count_emoji(short_text),
        "checkmark_bullets": desc_text.count("✅") + desc_text.count("✔"),
        "title_chars": len(name),
        "title_flags": title_flags,
        "slug_flags": slug_flags,
        "categories": cat_slugs,
        "only_generic_categories": bool(cat_slugs) and set(cat_slugs) <= GENERIC_CATEGORY_SLUGS,
        "in_offers_category_without_sale": "ofertas-mimos" in cat_slugs and not p["on_sale"],
        "tags": tag_names,
        "brands": brand_names,
        "brand_missing": not brand_names,
        "brand_generic": "Genérico" in brand_names,
        "attributes_count": len(p["attributes"]),
        "attribute_names": [html.unescape(a["name"]) for a in p["attributes"]],
        "attributes_are_global": any(a.get("taxonomy") for a in p["attributes"]),
        "weight_kg": weight,
        "weight_missing": weight is None,
        "dimensions_missing": dims_missing,
        "net_content_from_title_g_or_ml": net_g,
        "weight_below_net_content": bool(weight and net_g and weight * 1000 < net_g * 0.9),
        **{f"has_{k}": v for k, v in checks.items()},
    })

rows.sort(key=lambda r: r["id"])

# =============================================================================
# Duplicate candidates and variant families
# =============================================================================

cores = {r["id"]: title_core(r["name"]) for r in rows}
by_id = {r["id"]: r for r in rows}


def variant_value(title):
    m = VARIANT_RE.search(html.unescape(title))
    if not m:
        return None
    return fold(m.group(1)).strip(" |-")


def variant_tokens(title):
    v = variant_value(title)
    if not v:
        return set()
    v = re.sub(r"\b(?:de|com|sem|acucar|zero|importad[oa]|\d+(?:ml|g|l)?)\b", " ", v)
    return set(w for w in re.sub(r"[^a-z0-9 ]", " ", v).split() if len(w) > 1)


desc_hash = {
    r["id"]: hashlib.sha1(fold(strip_html(next(p for p in store_products if p["id"] == r["id"])["description"])).encode()).hexdigest()
    for r in rows
}

pairs = []
for a, b in combinations(rows, 2):
    sim = jaccard(cores[a["id"]], cores[b["id"]])
    va, vb = variant_tokens(a["name"]), variant_tokens(b["name"])
    variant_compatible = (not va and not vb) or bool(va & vb)
    same_image = sorted(set(a["image_names"]) & set(b["image_names"]))
    same_sku = bool(a["sku"]) and a["sku"] == b["sku"]
    same_desc = desc_hash[a["id"]] == desc_hash[b["id"]]
    strong = bool(sim >= 0.5 and variant_compatible and (va or vb or sim >= 0.75))
    if strong or same_image or same_sku or same_desc:
        pairs.append({
            "a": a["id"], "b": b["id"],
            "a_name": a["name"], "b_name": b["name"],
            "title_similarity": round(sim, 2),
            "variant_compatible": variant_compatible,
            "likely_same_item": strong,
            "shared_image_files": same_image,
            "same_sku": same_sku,
            "identical_description": same_desc,
            "a_variant": variant_value(a["name"]), "b_variant": variant_value(b["name"]),
            "a_created": a["created"], "b_created": b["created"],
            "a_price": a["price_brl"], "b_price": b["price_brl"],
            "a_stock": a["stock_class"], "b_stock": b["stock_class"],
        })

# Union-find over "likely same item" pairs only, so flavour families do not merge.
parent = {r["id"]: r["id"] for r in rows}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for pr in pairs:
    if pr["likely_same_item"]:
        parent[find(pr["a"])] = find(pr["b"])
clusters = defaultdict(list)
for r in rows:
    clusters[find(r["id"])].append(r["id"])
clusters = [sorted(v) for v in clusters.values() if len(v) > 1]
clusters.sort(key=lambda c: (-len(c), c[0]))

# Variant families: same title core once the variant value is removed.
family = defaultdict(list)
for r in rows:
    title = html.unescape(r["name"])
    stripped = VARIANT_RE.sub(" ", title)
    key = " ".join(sorted(title_core(stripped)))
    family[key].append(r["id"])
variant_families = [
    {"family_key": k, "product_ids": v, "names": [by_id[i]["name"] for i in v],
     "prices": sorted({by_id[i]["price_brl"] for i in v})}
    for k, v in family.items() if len(v) > 1
]
variant_families.sort(key=lambda f: -len(f["product_ids"]))

# =============================================================================
# Taxonomy audit
# =============================================================================


def near_duplicate_terms(terms):
    out = []
    names = [(t["id"], fold(t["name"])) for t in terms]
    for (ia, na), (ib, nb) in combinations(names, 2):
        sa, sb = na.rstrip("s"), nb.rstrip("s")
        if sa == sb or (len(sa) > 3 and (sa in sb or sb in sa) and abs(len(sa) - len(sb)) <= 9):
            out.append([ia, na, ib, nb])
    return out


brand_names_folded = {fold(b["name"]) for b in brands}
category_names_folded = {fold(c["name"]) for c in categories}
size_tag_re = re.compile(r"^\d+(?:[.,]\d+)?\s?(?:ml|l|g|kg|cm|mm|v|litros|folhas|unidades|cores|pecas|pares|paginas|bags|latas|compartimentos|fases|em 1)$|^\d+x\d+mm$|^\d+d$")

taxonomy = {
    "categories": {
        "total": len(categories),
        "empty": [c["name"] for c in categories if c["count"] == 0],
        "hierarchical": any(c["parent"] for c in categories),
        "without_description": sum(1 for c in categories if not c.get("description")),
        "counts": {c["name"]: c["count"] for c in categories},
    },
    "tags": {
        "total": len(tags),
        "used": sum(1 for t in tags if t["count"] > 0),
        "orphan_zero_count": sum(1 for t in tags if t["count"] == 0),
        "orphan_names": sorted(html.unescape(t["name"]) for t in tags if t["count"] == 0),
        "size_or_quantity_tags": sorted(html.unescape(t["name"]) for t in tags if size_tag_re.match(fold(t["name"]))),
        "tags_duplicating_brands": sorted(html.unescape(t["name"]) for t in tags if fold(t["name"]) in brand_names_folded),
        "tags_duplicating_categories": sorted(html.unescape(t["name"]) for t in tags if fold(t["name"]) in category_names_folded or fold(t["name"]) + "s" in category_names_folded),
        "near_duplicate_pairs": near_duplicate_terms(tags),
    },
    "brands": {
        "total": len(brands),
        "empty": [html.unescape(b["name"]) for b in brands if b["count"] == 0],
        "counts": {html.unescape(b["name"]): b["count"] for b in brands},
        "near_duplicate_pairs": near_duplicate_terms(brands),
    },
    "products_per_category_count": Counter(len(r["categories"]) for r in rows),
}

# Overlap between catch-all categories and specific ones.
overlap = Counter()
for r in rows:
    for a, b in combinations(sorted(r["categories"]), 2):
        overlap[f"{a} + {b}"] += 1
taxonomy["category_pair_overlap"] = dict(overlap.most_common())

# =============================================================================
# Media audit
# =============================================================================

used_by_products = defaultdict(list)
for p in store_products:
    for im in {im["id"] for im in p["images"]}:
        used_by_products[im].append(p["id"])

media_rows = []
for m in media:
    name = m["slug"]
    base = m["source_url"].rsplit("/", 1)[-1]
    media_rows.append({
        "id": m["id"],
        "date": m["date"],
        "file": base,
        "mime": m["mime_type"],
        "parent_post": m["post"],
        "name_class": classify_image_name(base.rsplit(".", 1)[0]),
        "alt_empty": not (m.get("alt_text") or "").strip(),
        "used_by_published_products": used_by_products.get(m["id"], []),
        "reupload_suffix": bool(re.search(r"-\d+\.(?:png|jpe?g|webp|gif)$", base)),
    })

media_audit = {
    "total_in_database": media_probe["media_total_in_database"],
    "visible_publicly": len(media),
    "hidden_attached_to_non_public_posts": media_probe["media_total_in_database"] - len(media),
    "unattached_parent_0": sum(1 for m in media_rows if not m["parent_post"]),
    "not_used_by_any_published_product": [m["id"] for m in media_rows if not m["used_by_published_products"]],
    "used_by_multiple_products": {m["id"]: m["used_by_published_products"] for m in media_rows if len(m["used_by_published_products"]) > 1},
    "alt_text_empty": sum(1 for m in media_rows if m["alt_empty"]),
    "name_class_counts": Counter(m["name_class"] for m in media_rows),
    "mime_counts": Counter(m["mime"] for m in media_rows),
    "reupload_suffix_files": [m["file"] for m in media_rows if m["reupload_suffix"]],
    "uploads_per_day": dict(sorted(Counter(m["date"][:10] for m in media_rows).items())),
    "rows": media_rows,
}

# =============================================================================
# Summary
# =============================================================================


def pct(n, d):
    return round(100 * n / d, 1) if d else 0.0


N = len(rows)
summary = {
    "published_products": N,
    "product_types": Counter(r["type"] for r in rows),
    "sku_missing": sum(r["sku_missing"] for r in rows),
    "sku_duplicated": sum(r["sku_duplicated"] for r in rows),
    "out_of_stock": sum(r["stock_class"] == "out-of-stock" for r in rows),
    "products_without_images": sum(r["images_count"] == 0 for r in rows),
    "products_with_single_image": sum(r["images_count"] == 1 for r in rows),
    "products_with_repeated_image_entries": sum(r["images_repeated_entries"] > 0 for r in rows),
    "products_with_non_descriptive_image_names": sum(any(c != "descriptive" for c in r["image_name_classes"]) for r in rows),
    "products_with_shopee_hash_images": sum("shopee_cdn_hash" in r["image_name_classes"] for r in rows),
    "products_with_junk_image_names": sum("junk_name" in r["image_name_classes"] for r in rows),
    "image_provenance_by_product": {
        cls: sum(cls in r["image_name_classes"] for r in rows)
        for cls in ("shopee_cdn_hash", "mercadolivre_cdn_copy", "amazon_cdn_copy", "ai_generated_image", "screenshot",
                    "whatsapp_export", "promo_banner", "junk_name", "short_or_unclear", "descriptive")
    },
    "image_files_shared_by_multiple_products": sum(1 for v in image_users.values() if len(v) > 1),
    "products_with_all_alt_empty": sum(r["images_alt_empty"] == r["images_count"] + r["images_repeated_entries"] for r in rows if r["images_count"]),
    "products_using_images_uploaded_for_other_posts": sum(bool(r["images_owned_by_other_post"]) for r in rows),
    "description_missing": sum(r["description_missing"] for r in rows),
    "description_thin_under_60_words": sum(r["description_thin"] for r in rows),
    "short_description_missing": sum(r["short_description_missing"] for r in rows),
    "description_identical_to_other_product": sum(r["description_identical_to_other_product"] for r in rows),
    "products_with_emoji_in_description": sum(r["emoji_description"] > 0 for r in rows),
    "emoji_total_in_descriptions": sum(r["emoji_description"] + r["emoji_short_description"] for r in rows),
    "products_with_emoji_in_title": sum(r["emoji_title"] > 0 for r in rows),
    "products_with_attributes": sum(r["attributes_count"] > 0 for r in rows),
    "brand_missing": sum(r["brand_missing"] for r in rows),
    "brand_generic": sum(r["brand_generic"] for r in rows),
    "only_generic_categories": sum(r["only_generic_categories"] for r in rows),
    "in_offers_category_without_sale": sum(r["in_offers_category_without_sale"] for r in rows),
    "weight_missing": sum(r["weight_missing"] for r in rows),
    "dimensions_incomplete": sum(bool(r["dimensions_missing"]) for r in rows),
    "weight_below_net_content": sum(r["weight_below_net_content"] for r in rows),
    "title_longer_than_70": sum("longer_than_70_chars" in r["title_flags"] for r in rows),
    "title_with_store_name": sum("store_name_in_title" in r["title_flags"] for r in rows),
    "title_pipe_stuffing": sum("pipe_keyword_stuffing" in r["title_flags"] for r in rows),
    "slug_numeric_suffix": sum("numeric_suffix(slug_collision)" in r["slug_flags"] for r in rows),
    "slug_too_long": sum("too_long" in r["slug_flags"] for r in rows),
    "content_checks_present": {k: sum(r[f"has_{k}"] for r in rows) for k in CHECKS},
    "duplicate_candidate_pairs": len(pairs),
    "likely_duplicate_pairs": sum(p["likely_same_item"] for p in pairs),
    "duplicate_candidate_clusters": len(clusters),
    "variant_families": len(variant_families),
    "products_in_variant_families": sum(len(f["product_ids"]) for f in variant_families),
    "creation_batches_by_day": dict(sorted(Counter((r["created"] or "")[:10] for r in rows).items())),
}
summary["percentages"] = {
    k: pct(summary[k], N)
    for k in ("sku_missing", "out_of_stock", "products_with_single_image", "products_with_non_descriptive_image_names",
              "description_thin_under_60_words", "short_description_missing", "products_with_emoji_in_description",
              "brand_missing", "only_generic_categories", "title_longer_than_70")
}

# =============================================================================
# Write outputs
# =============================================================================

OUT.mkdir(parents=True, exist_ok=True)


def write_json(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=list), encoding="utf-8")


write_json("product_scorecard.json", rows)
write_json("duplicate_candidates.json", {"pairs": pairs, "clusters": clusters})
write_json("variant_families.json", variant_families)
write_json("taxonomy_audit.json", taxonomy)
write_json("media_audit.json", media_audit)
write_json("summary.json", summary)

csv_fields = [k for k in rows[0].keys()]
with open(OUT / "product_scorecard.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=csv_fields)
    w.writeheader()
    for r in rows:
        w.writerow({k: ("; ".join(map(str, v)) if isinstance(v, list) else v) for k, v in r.items()})

print(json.dumps(summary, ensure_ascii=False, indent=1, default=list))
