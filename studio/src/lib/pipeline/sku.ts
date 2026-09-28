import { fold } from "@/lib/text/normalize";
import { measures } from "@/lib/text/similarity";
import type { Identity } from "@/lib/types";

// =============================================================================
// Deterministic SKU
// =============================================================================
// Same product -> same SKU, so a second registration of the same item is caught
// by the SKU lookup even when the operator types a different name.
// Pattern: TYPE-BRAND-LINE-VARIANT-SIZE-HASH, e.g. SOJ-LOT-CHCH-MOR-360ML-1K9Q

function code(text: string | null | undefined, letters = 3): string {
  if (!text) return "";
  const words = fold(text)
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !["de", "da", "do", "com", "sem", "sabor", "cor", "e"].includes(w));
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, letters).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w.slice(0, words.length > 1 ? 2 : letters))
    .join("")
    .toUpperCase();
}

/** FNV-1a 32-bit, base36: short, deterministic and dependency-free. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

export function buildSku(identity: Identity): string {
  const size = measures(identity.netContent ?? "")[0];
  const sizePart = size
    ? `${Number.isInteger(size.value) ? size.value : size.value.toFixed(1)}${size.unit.toUpperCase()}`
    : "";
  const pack = identity.packCount && identity.packCount > 1 ? `${identity.packCount}UN` : "";
  const parts = [
    code(identity.productType),
    code(identity.brand),
    code(identity.line),
    code(identity.variant),
    sizePart,
    pack,
  ].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  // The readable prefix can collide ("Morango" vs "Morango Silvestre"); the hash of the full
  // normalised identity cannot, and stays identical for the same product.
  const key = [
    identity.brand,
    identity.line,
    identity.productType,
    identity.variant,
    identity.netContent,
    identity.packCount,
  ]
    .map((v) => fold(String(v ?? "")).replace(/[^a-z0-9]+/g, ""))
    .join("|");
  const prefix = unique.join("-").slice(0, 34).replace(/-+$/g, "") || "SKU";
  return `${prefix}-${shortHash(key)}`;
}
