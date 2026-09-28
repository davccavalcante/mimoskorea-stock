import "server-only";
import { mentionsAny } from "@/lib/pipeline/verify";
import type { ResearchProvider, SearchHit } from "@/lib/providers/search";
import { fold } from "@/lib/text/normalize";
import type { Identity, Source } from "@/lib/types";

// =============================================================================
// Research: reference page + multi-provider web search, merged and ranked
// =============================================================================

export type ResearchLog = {
  provider: string;
  operation: string;
  detail: string;
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref|srsltid|spm|sp_atk|xptdk|mkt_|tracking)/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Read the operator's reference link with the first provider that succeeds. */
export async function readReference(
  url: string,
  providers: ResearchProvider[],
  log: (l: ResearchLog) => void,
): Promise<SearchHit | null> {
  for (const provider of providers) {
    try {
      const [hit] = await provider.extract([url]);
      if (hit && hit.text.trim().length > 80) {
        log({
          provider: provider.name,
          operation: "extract",
          detail: `${hit.text.length} caracteres, ${hit.images.length} imagens`,
        });
        return { ...hit, origin: "reference" };
      }
      log({
        provider: provider.name,
        operation: "extract",
        detail: "página vazia ou bloqueada",
      });
    } catch (error) {
      log({
        provider: provider.name,
        operation: "extract",
        detail: `falhou: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return null;
}

/** Variant name plus aliases (English / native language) given by the identify step. */
export function variantAliases(identity: Identity): string[] {
  return [identity.variant, ...(identity.variantAliases ?? [])].filter((v): v is string => Boolean(v?.trim()));
}

/** Does the text name the exact variant (whole words, any alias, any script)? null when there is no variant. */
export function mentionsVariant(identity: Identity, text: string): boolean | null {
  const aliases = variantAliases(identity);
  if (!aliases.length) return null;
  return mentionsAny(text, aliases);
}

/** Unicode-aware term presence (Latin, Hangul, Kana, Han). */
function hasTerm(hay: string, term: string | null | undefined): boolean {
  if (!term) return false;
  const words = fold(term)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

function relevance(identity: Identity, hit: SearchHit): number {
  const hay = fold(`${hit.title} ${hit.text.slice(0, 8000)}`);
  let score = 0;
  if (hasTerm(hay, identity.brand)) score += 2;
  if (hasTerm(hay, identity.line)) score += 2;
  if (hasTerm(hay, identity.nativeName)) score += 3;
  if (hasTerm(hay, identity.productType)) score += 1;
  if (mentionsVariant(identity, hay)) score += 3;
  if (identity.netContent && hay.replace(/\s/g, "").includes(fold(identity.netContent).replace(/\s/g, ""))) score += 1;
  if (identity.gtin && hay.includes(identity.gtin)) score += 5;
  if (hit.text.length > 1500) score += 1;
  return score;
}

export async function webResearch(args: {
  identity: Identity;
  reference: SearchHit | null;
  providers: ResearchProvider[];
  maxSources: number;
  log: (l: ResearchLog) => void;
}): Promise<Source[]> {
  const { identity, reference, providers, maxSources, log } = args;
  const queries = [...identity.searchQueries];
  if (identity.gtin) queries.unshift(identity.gtin);

  const calls = providers.flatMap((provider) =>
    queries.slice(0, 5).map((query, i) => ({
      provider,
      query,
      locale: (i === 0 ? "pt-BR" : "global") as "pt-BR" | "global",
    })),
  );

  const results = await mapLimit(calls, 4, async ({ provider, query, locale }) => {
    try {
      const hits = await provider.search(query, { maxResults: 6, locale });
      log({
        provider: provider.name,
        operation: "search",
        detail: `"${query}" -> ${hits.length} resultados`,
      });
      return hits;
    } catch (error) {
      log({
        provider: provider.name,
        operation: "search",
        detail: `"${query}" falhou: ${error instanceof Error ? error.message : String(error)}`,
      });
      return [];
    }
  });

  // Merge by canonical URL (keep the longest text, union of images).
  const merged = new Map<string, SearchHit>();
  for (const hit of results.flat()) {
    const key = canonicalUrl(hit.url);
    if (reference && key === canonicalUrl(reference.url)) continue;
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...hit, images: [...hit.images] });
    else {
      if (hit.text.length > prev.text.length) prev.text = hit.text;
      prev.images = [...new Set([...prev.images, ...hit.images])];
    }
  }

  const scored = [...merged.values()]
    .map((hit) => ({ hit, score: relevance(identity, hit) }))
    .sort((a, b) => b.score - a.score);
  const kept = scored.filter((r) => r.score >= 3);
  // Keep the best native-language page (manufacturer sites) even below the threshold.
  const native = scored.find(
    (r) => /[\u3131-\ud79d\u3040-\u30ff\u4e00-\u9fff]/.test(r.hit.text.slice(0, 3000)) && r.score >= 2,
  );
  if (native && !kept.includes(native)) kept.push(native);
  for (const r of scored.filter((x) => !kept.includes(x)).slice(0, 8)) {
    log({ provider: "research", operation: "discard", detail: `${r.hit.url} (relevância ${r.score})` });
  }
  const ranked = kept.slice(0, reference ? maxSources - 1 : maxSources).map((r) => r.hit);

  const ordered = reference ? [reference, ...ranked] : ranked;
  return ordered.map((hit, i) => ({
    id: `S${i + 1}`,
    url: hit.url,
    title: hit.title,
    domain: domainOf(hit.url),
    origin: hit.origin,
    text: hit.text,
    images: hit.images,
  }));
}
