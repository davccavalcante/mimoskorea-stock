import "server-only";
import { requestJson } from "@/lib/net/http";

// =============================================================================
// Web research providers (Tavily + Exa over REST)
// =============================================================================
// REST with fetch instead of the SDKs: explicit timeouts, retry-after aware
// retries, real HTTP status codes and ~40 MB fewer dependencies.
// Casing: Tavily REST is snake_case, Exa REST is camelCase.

export type SearchHit = {
  url: string;
  title: string;
  text: string;
  images: string[];
  origin: "tavily" | "exa" | "reference";
};

export interface ResearchProvider {
  readonly name: "tavily" | "exa" | "mock";
  search(query: string, options: { maxResults: number; locale: "pt-BR" | "global" }): Promise<SearchHit[]>;
  /** Fetch the full content of known URLs (the operator's reference link). */
  extract(urls: string[]): Promise<SearchHit[]>;
}

const MAX_TEXT = 12_000;

const imageUrl = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value && typeof (value as { url: unknown }).url === "string") {
    return (value as { url: string }).url;
  }
  return null;
};

// -----------------------------------------------------------------------------
// Tavily
// -----------------------------------------------------------------------------

type TavilySearchResponse = {
  results: Array<{
    url: string;
    title: string;
    content: string;
    raw_content?: string | null;
    images?: unknown[];
  }>;
  images?: unknown[];
};
type TavilyExtractResponse = {
  results: Array<{
    url: string;
    title?: string;
    raw_content: string;
    images?: string[];
  }>;
  failed_results?: Array<{ url: string; error: string }>;
};

const tavilyError = (body: unknown) => {
  const b = body as { detail?: { error?: string }; error?: string } | null;
  return b?.detail?.error ?? b?.error;
};

export class TavilyProvider implements ResearchProvider {
  readonly name = "tavily" as const;
  constructor(private readonly apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async search(query: string, options: { maxResults: number; locale: "pt-BR" | "global" }): Promise<SearchHit[]> {
    const { data } = await requestJson<TavilySearchResponse>("https://api.tavily.com/search", {
      method: "POST",
      headers: this.headers(),
      body: {
        query,
        search_depth: "advanced",
        topic: "general",
        max_results: options.maxResults,
        include_images: true,
        include_raw_content: "markdown",
        ...(options.locale === "pt-BR" ? { country: "brazil" } : {}),
      },
      timeoutMs: 60_000,
      errorMessage: tavilyError,
    });
    return data.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      text: (r.raw_content || r.content || "").slice(0, MAX_TEXT),
      images: (r.images ?? []).map(imageUrl).filter((u): u is string => Boolean(u)),
      origin: "tavily" as const,
    }));
  }

  async extract(urls: string[]): Promise<SearchHit[]> {
    const { data } = await requestJson<TavilyExtractResponse>("https://api.tavily.com/extract", {
      method: "POST",
      headers: this.headers(),
      body: {
        urls: urls.slice(0, 20),
        extract_depth: "advanced",
        include_images: true,
        format: "markdown",
        timeout: 45,
      },
      timeoutMs: 70_000,
      errorMessage: tavilyError,
    });
    return data.results.map((r) => ({
      url: r.url,
      title: r.title ?? r.url,
      text: (r.raw_content ?? "").slice(0, MAX_TEXT),
      images: (r.images ?? []).filter((u) => typeof u === "string"),
      origin: "tavily" as const,
    }));
  }
}

// -----------------------------------------------------------------------------
// Exa
// -----------------------------------------------------------------------------

type ExaResult = {
  url: string;
  title?: string | null;
  text?: string;
  image?: string;
  extras?: { imageLinks?: string[]; richImageLinks?: Array<{ url: string }> };
};
type ExaResponse = { results: ExaResult[] };

const exaError = (body: unknown) => {
  const b = body as { error?: string | { message?: string } } | null;
  return typeof b?.error === "object" ? b.error?.message : b?.error;
};

function exaHit(r: ExaResult): SearchHit {
  const images = [
    r.image,
    ...(r.extras?.imageLinks ?? []),
    ...(r.extras?.richImageLinks ?? []).map((x) => x.url),
  ].filter((u): u is string => typeof u === "string" && u.length > 0);
  return {
    url: r.url,
    title: r.title || r.url,
    text: (r.text ?? "").slice(0, MAX_TEXT),
    images,
    origin: "exa",
  };
}

export class ExaProvider implements ResearchProvider {
  readonly name = "exa" as const;
  constructor(private readonly apiKey: string) {}

  async search(query: string, options: { maxResults: number; locale: "pt-BR" | "global" }): Promise<SearchHit[]> {
    const { data } = await requestJson<ExaResponse>("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": this.apiKey },
      body: {
        query,
        type: "auto",
        numResults: Math.min(options.maxResults, 10),
        ...(options.locale === "pt-BR" ? { userLocation: "BR" } : {}),
        contents: {
          text: { maxCharacters: 10_000 },
          extras: { imageLinks: 10 },
        },
      },
      timeoutMs: 60_000,
      errorMessage: exaError,
    });
    return data.results.map(exaHit);
  }

  async extract(urls: string[]): Promise<SearchHit[]> {
    const { data } = await requestJson<ExaResponse>("https://api.exa.ai/contents", {
      method: "POST",
      headers: { "x-api-key": this.apiKey },
      body: {
        urls: urls.slice(0, 20),
        text: { maxCharacters: 10_000 },
        extras: { imageLinks: 20 },
        livecrawlTimeout: 15_000,
      },
      timeoutMs: 45_000,
      errorMessage: exaError,
    });
    return data.results.map(exaHit);
  }
}
