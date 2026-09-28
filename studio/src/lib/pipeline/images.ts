import "server-only";
import sharp from "sharp";
import { fetch as guardedFetch } from "undici";
import { assertPublicHttpUrl, guardedDispatcher } from "@/lib/net/ssrf";
import type { Source } from "@/lib/types";

// =============================================================================
// Product images: collect -> download (safely) -> dedupe -> rank -> process
// =============================================================================

export type ImageCandidate = {
  url: string;
  sourceId: string;
  priority: number;
};

const REJECT_URL =
  /(logo|icon|sprite|favicon|avatar|placeholder|loading|spinner|banner|badge|selo|flag|bandeira|payment|pagamento|frete|whatsapp|facebook|instagram|tiktok|youtube|pixel|tracking|1x1|blank|\.svg(\?|$)|\.gif(\?|$)|^data:)/i;

/** Gather candidate image URLs, reference page first, then sources by rank. */
export function collectCandidates(sources: Source[], max = 30): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  sources.forEach((source, rank) => {
    source.images.forEach((raw, i) => {
      const url = raw.trim();
      if (!/^https?:\/\//i.test(url) || REJECT_URL.test(url)) return;
      const key = url.replace(/[?#].*$/, "").replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, "");
      if (seen.has(key)) return;
      seen.add(key);
      const base = source.origin === "reference" ? 0 : 10 + rank;
      out.push({ url, sourceId: source.id, priority: base + i * 0.1 });
    });
  });
  return out.sort((a, b) => a.priority - b.priority).slice(0, max);
}

// -----------------------------------------------------------------------------
// Download with SSRF protection, manual redirects, size and type limits
// -----------------------------------------------------------------------------

export async function downloadImage(
  rawUrl: string,
  options: { maxBytes: number; allowPrivate: boolean; timeoutMs?: number },
): Promise<Buffer> {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHttpUrl(url, options.allowPrivate);
    const res = await guardedFetch(url, {
      dispatcher: guardedDispatcher(options.allowPrivate),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; MimosCatalogStudio/1.0)",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirecionamento sem destino");
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("image/") || type.includes("svg")) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`Conteúdo não é imagem (${type || "sem tipo"})`);
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > options.maxBytes) throw new Error("Imagem grande demais");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Resposta sem corpo");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel();
        throw new Error("Imagem grande demais");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Redirecionamentos demais");
}

// -----------------------------------------------------------------------------
// Inspection and perceptual hash (dHash, 64 bits) for duplicate removal
// -----------------------------------------------------------------------------
// Decompression bombs: a small file can declare a gigantic canvas. sharp
// refuses anything above LIMIT_PIXELS, and sides above MAX_SIDE are skipped.

const LIMIT_PIXELS = 40_000_000;
const MAX_SIDE = 8000;
const load = (data: Buffer) => sharp(data, { failOn: "none", limitInputPixels: LIMIT_PIXELS });

export type InspectedImage = {
  width: number;
  height: number;
  format: string;
  hash: bigint;
};

export async function inspectImage(data: Buffer): Promise<InspectedImage | null> {
  try {
    const meta = await load(data).metadata();
    if (!meta.width || !meta.height || !meta.format) return null;
    if (meta.width > MAX_SIDE || meta.height > MAX_SIDE || meta.format === "svg") return null;
    const { data: pixels } = await load(data)
      .rotate()
      .flatten({ background: "#ffffff" })
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        hash = (hash << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
      }
    }
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format,
      hash,
    };
  } catch {
    return null;
  }
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Small JPEG preview sent to the vision model. */
export async function visionThumbnail(data: Buffer, size = 448): Promise<Buffer> {
  return load(data)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(size, size, { fit: "inside" })
    .jpeg({ quality: 78 })
    .toBuffer();
}

// -----------------------------------------------------------------------------
// Final processing: square canvas, white background, gentle colour correction,
// sharpening, WebP, metadata stripped.
// -----------------------------------------------------------------------------

export async function processProductImage(
  data: Buffer,
  options: { size: number; quality: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const { size, quality } = options;
  const margin = Math.round(size * 0.05);
  const inner = size - margin * 2;

  // 1. Normalise orientation and transparency, then trim uniform borders.
  let base = load(data).rotate().flatten({ background: "#ffffff" });
  try {
    const trimmed = await base
      .clone()
      .trim({ background: "#ffffff", threshold: 18 })
      .toBuffer({ resolveWithObject: true });
    if (trimmed.info.width >= 64 && trimmed.info.height >= 64) base = load(trimmed.data);
  } catch {
    // Nothing to trim (uniform image) - keep the original.
  }

  // 2. Fit into the square, colour-correct, sharpen, encode WebP.
  const out = await base
    .resize(inner, inner, {
      fit: "contain",
      background: "#ffffff",
      kernel: "lanczos3",
    })
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: "#ffffff",
    })
    .normalise({ lower: 1, upper: 99 })
    .modulate({ saturation: 1.06, brightness: 1.01 })
    .sharpen({ sigma: 0.7 })
    .webp({ quality, effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  return { data: out.data, width: out.info.width, height: out.info.height };
}
