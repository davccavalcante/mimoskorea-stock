import { fold } from "@/lib/text/normalize";
import { measures } from "@/lib/text/similarity";
import type { Identity } from "@/lib/types";

// =============================================================================
// Deterministic SKU
// =============================================================================
// Same product -> same SKU, so a second registration of the same item is caught
// by the SKU lookup even when the operator types a different name.
// Pattern: TYPE-BRAND-LINE-VARIANT-SIZE, e.g. SOJ-LOT-CHU-MOR-360ML

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
  return unique.join("-").slice(0, 40).replace(/-+$/g, "") || "SKU";
}
