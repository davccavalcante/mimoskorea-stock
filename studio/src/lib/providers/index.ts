import "server-only";
import { ConfigError, env } from "@/lib/env";
import { downloadImage } from "@/lib/pipeline/images";
import type { CatalogProvider } from "./catalog";
import { GeminiProvider } from "./gemini";
import type { LlmProvider } from "./llm";
import { MemoryCatalog, MockLlm, MockSearchProvider, mockImage } from "./mock";
import { ExaProvider, type ResearchProvider, TavilyProvider } from "./search";
import { WooCommerceProvider } from "./woocommerce";

// =============================================================================
// Provider wiring from environment
// =============================================================================

export type Providers = {
  llm: LlmProvider;
  research: ResearchProvider[];
  catalog: CatalogProvider;
  fetchImage: (url: string) => Promise<Buffer>;
  visionModel: string;
};

let memoryCatalog: MemoryCatalog | null = null;

export function getProviders(): Providers {
  const e = env();
  const fetchReal = (url: string) =>
    downloadImage(url, {
      maxBytes: e.IMAGE_MAX_BYTES,
      allowPrivate: e.ALLOW_PRIVATE_NETWORK_FETCH,
    });

  let catalog: CatalogProvider;
  if (e.STUDIO_CATALOG === "memory") {
    memoryCatalog ??= new MemoryCatalog();
    catalog = memoryCatalog;
  } else {
    if (!e.WP_USERNAME || !e.WP_APPLICATION_PASSWORD) {
      throw new ConfigError(
        "Configure WP_USERNAME e WP_APPLICATION_PASSWORD no arquivo .env.local para conectar ao WooCommerce.",
      );
    }
    catalog = new WooCommerceProvider(e.WC_BASE_URL, e.WP_USERNAME, e.WP_APPLICATION_PASSWORD);
  }

  if (e.STUDIO_PROVIDERS === "mock") {
    return {
      llm: new MockLlm(),
      research: [new MockSearchProvider()],
      catalog,
      fetchImage: (url) => (new URL(url).hostname === "mock.studio.local" ? mockImage(url) : fetchReal(url)),
      visionModel: "mock",
    };
  }

  if (!e.GEMINI_API_KEY) throw new ConfigError("Configure GEMINI_API_KEY no arquivo .env.local.");
  const research: ResearchProvider[] = [];
  if (e.TAVILY_API_KEY) research.push(new TavilyProvider(e.TAVILY_API_KEY));
  if (e.EXA_API_KEY) research.push(new ExaProvider(e.EXA_API_KEY));
  if (!research.length) throw new ConfigError("Configure TAVILY_API_KEY e/ou EXA_API_KEY no arquivo .env.local.");

  return {
    llm: new GeminiProvider(
      e.GEMINI_API_KEY,
      e.GEMINI_MODEL,
      e.GEMINI_TIMEOUT_MS,
      e.GEMINI_FALLBACK_MODELS.split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      (message) => console.warn(`[gemini] ${message}`),
    ),
    research,
    catalog,
    fetchImage: fetchReal,
    visionModel: e.GEMINI_VISION_MODEL,
  };
}
