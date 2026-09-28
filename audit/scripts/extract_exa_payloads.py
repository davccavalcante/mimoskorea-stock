#!/usr/bin/env python3
"""
Extract JSON payloads from persisted Exa web_fetch results (JSON list or plain text).

The first audit snapshot was captured through the Exa fetch service because the
sandbox proxy blocked mimoskorea.com.br. Each Exa result block looks like:
  # <title>\n URL: <url>\n <body>
This helper splits the blocks and writes one file per URL.

Usage: python3 extract_exa_payloads.py <exa-result-file> <out-prefix>
"""
import json
import re
import sys

src, prefix = sys.argv[1], sys.argv[2]
raw = open(src, encoding="utf-8").read()
try:
    d = json.loads(raw)
    text = "".join(item.get("text", "") for item in d) if isinstance(d, list) else raw
except Exception:
    text = raw
blocks = re.split(r"\n(?=# [^\n]*\nURL: )", "\n" + text)
n = 0
for b in blocks:
    m = re.search(r"URL: (\S+)\n", b)
    if not m:
        continue
    url = m.group(1)
    rest = b[m.end():].lstrip()
    try:
        obj, end = json.JSONDecoder().raw_decode(rest)
        kind = "json"
    except Exception as e:
        obj, kind = rest, "text"
    out = f"{prefix}_{n}.{'json' if kind == 'json' else 'txt'}"
    with open(out, "w", encoding="utf-8") as f:
        if kind == "json":
            json.dump({"url": url, "data": obj}, f, ensure_ascii=False)
        else:
            f.write(url + "\n" + rest)
    size = len(obj) if kind == "json" and isinstance(obj, list) else len(rest)
    print(out, url, kind, size)
    n += 1
