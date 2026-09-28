import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  collectCandidates,
  hammingDistance,
  type InspectedImage,
  inspectImage,
  processProductImage,
  visionThumbnail,
} from "@/lib/pipeline/images";
import { IMAGES_SYSTEM, imagesPrompt } from "@/lib/pipeline/prompts";
import type { LlmProvider } from "@/lib/providers/llm";
import { stripEmoji } from "@/lib/text/normalize";
import type { Identity, ProcessedImage, Source } from "@/lib/types";

// =============================================================================
// Choose and process the product photos
// =============================================================================

export const ImageReviewSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(["main", "gallery", "reject"]),
      matchesExactVariant: z.boolean(),
      hasOverlayTextOrWatermark: z.boolean(),
      reason: z.string(),
      altText: z.string(),
    }),
  ),
});

export type ImageOptions = {
  size: number;
  quality: number;
  maxCount: number;
  maxBytes: number;
  minSide: number;
  outputDir: string;
  slug: string;
  title: string;
};

type Downloaded = { url: string; data: Buffer; meta: InspectedImage };

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function selectImages(args: {
  identity: Identity;
  sources: Source[];
  llm: LlmProvider;
  visionModel: string;
  fetchImage: (url: string) => Promise<Buffer>;
  options: ImageOptions;
  log: (detail: string) => void;
}): Promise<{ images: ProcessedImage[]; usage: string | null }> {
  const { identity, sources, llm, visionModel, fetchImage, options, log } = args;

  // 1. Download candidates (bounded concurrency, failures are skipped).
  const candidates = collectCandidates(sources, 30);
  log(`${candidates.length} imagens candidatas encontradas nas fontes`);
  const downloaded = (
    await mapLimit(candidates, 6, async (c): Promise<Downloaded | null> => {
      try {
        const data = await fetchImage(c.url);
        const meta = await inspectImage(data);
        if (!meta) return null;
        const minSide = Math.min(meta.width, meta.height);
        const ratio = meta.width / meta.height;
        if (minSide < options.minSide || ratio < 0.5 || ratio > 2) return null;
        return { url: c.url, data, meta };
      } catch {
        return null;
      }
    })
  ).filter((d): d is Downloaded => Boolean(d));

  // 2. Remove near-duplicates (same photo at different sizes or re-uploads).
  const unique: Downloaded[] = [];
  for (const img of downloaded.sort((a, b) => b.meta.width * b.meta.height - a.meta.width * a.meta.height)) {
    if (!unique.some((u) => hammingDistance(u.meta.hash, img.meta.hash) <= 5)) unique.push(img);
  }
  const pool = unique.slice(0, 12);
  log(`${downloaded.length} baixadas, ${pool.length} únicas com qualidade suficiente`);
  if (!pool.length) return { images: [], usage: null };

  // 3. Vision review: exact product and variant, no overlays or watermarks.
  const thumbs = await Promise.all(pool.map((p) => visionThumbnail(p.data)));
  const { data: review, usage } = await llm.generateJson({
    operation: "images",
    system: IMAGES_SYSTEM,
    prompt: imagesPrompt(identity, pool.length),
    schema: ImageReviewSchema,
    images: thumbs.map((t) => ({
      mimeType: "image/jpeg" as const,
      base64: t.toString("base64"),
    })),
    thinking: "low",
    model: visionModel,
  });

  const accepted = review.images
    .filter(
      (r) => r.index < pool.length && r.verdict !== "reject" && r.matchesExactVariant && !r.hasOverlayTextOrWatermark,
    )
    .sort((a, b) => (a.verdict === "main" ? -1 : 0) - (b.verdict === "main" ? -1 : 0))
    .filter((r, i, arr) => arr.findIndex((x) => x.index === r.index) === i)
    .slice(0, options.maxCount);
  log(`${accepted.length} imagens aprovadas pela revisão visual`);

  // 4. Process and store as SEO-named WebP files.
  await mkdir(options.outputDir, { recursive: true });
  const images: ProcessedImage[] = [];
  for (const [i, r] of accepted.entries()) {
    const src = pool[r.index];
    const out = await processProductImage(src.data, {
      size: options.size,
      quality: options.quality,
    });
    const fileName = `${options.slug}${i === 0 ? "" : `-${i + 1}`}.webp`;
    await writeFile(path.join(options.outputDir, fileName), out.data);
    images.push({
      id: `img-${i + 1}`,
      fileName,
      alt: stripEmoji(r.altText).slice(0, 125) || options.title,
      width: out.width,
      height: out.height,
      bytes: out.data.byteLength,
      sourceUrl: src.url,
      role: i === 0 ? "main" : "gallery",
      reason: stripEmoji(r.reason),
    });
  }
  return { images, usage };
}
