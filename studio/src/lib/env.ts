import "server-only";
import path from "node:path";
import { z } from "zod";

// =============================================================================
// Environment configuration
// =============================================================================
// Every secret and switch lives in .env.local (see .env.example). The schema
// below is the single source of truth: it documents each variable, applies
// defaults and fails fast with a readable message when something is wrong.

/** A missing or invalid setting in .env.local (the operator cannot fix it; the owner can). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const schema = z.object({
  // --- Mode --------------------------------------------------------------------
  /** live = real Gemini/Tavily/Exa; mock = offline fixtures (tests, demos, no keys). */
  STUDIO_PROVIDERS: z.enum(["live", "mock"]).default("mock"),
  /** woocommerce = real REST API; memory = in-process catalog (unit tests only). */
  STUDIO_CATALOG: z.enum(["woocommerce", "memory"]).default("woocommerce"),
  STUDIO_DATA_DIR: z.string().default(".data"),
  /** Optional HTTP Basic protection ("user:password"). Not a login screen. */
  STUDIO_BASIC_AUTH: z.string().optional(),
  /** Host names allowed to reach the app (comma separated; read by src/proxy.ts). */
  STUDIO_ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1,[::1]"),
  /** How many registrations are researched at the same time (the rest wait in line). */
  STUDIO_MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(4).default(2),
  /** New registrations accepted per minute (protects the paid AI and search quotas). */
  STUDIO_MAX_JOBS_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(10),

  // --- Gemini ------------------------------------------------------------------
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_VISION_MODEL: z.string().default("gemini-3.8-flash"),
  /** Upper limit per AI call; each operation also has its own shorter limit (identify 60 s, images 90 s). */
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  // --- Research ----------------------------------------------------------------
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  RESEARCH_MAX_SOURCES: z.coerce.number().int().min(3).max(30).default(12),

  // --- WooCommerce / WordPress -------------------------------------------------
  WC_BASE_URL: z.string().url().default("http://localhost:8080"),
  WP_USERNAME: z.string().optional(),
  WP_APPLICATION_PASSWORD: z.string().optional(),
  WC_STATUS_WHEN_COMPLETE: z.enum(["publish", "pending", "draft"]).default("publish"),
  WC_STATUS_WHEN_INCOMPLETE: z.enum(["pending", "draft"]).default("pending"),
  /** Which SEO plugin receives meta title/description (none = only WooCommerce fields). */
  SEO_PLUGIN: z.enum(["none", "yoast", "rankmath"]).default("none"),

  // --- Store rules -------------------------------------------------------------
  STORE_NAME: z.string().default("Mimos Korea Design"),
  TITLE_MAX_CHARS: z.coerce.number().int().min(40).max(150).default(75),

  // --- Images ------------------------------------------------------------------
  IMAGE_SIZE: z.coerce.number().int().min(600).max(3000).default(1200),
  IMAGE_QUALITY: z.coerce.number().int().min(50).max(100).default(82),
  IMAGE_MAX_COUNT: z.coerce.number().int().min(1).max(10).default(5),
  IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 1024 * 1024),
  /** Allow downloads from private networks (only for local staging/tests). */
  ALLOW_PRIVATE_NETWORK_FETCH: bool.default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigError(`Configuração inválida no arquivo .env.local:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the cache (tests change process.env between cases). */
export function resetEnvCache() {
  cached = null;
}

export function dataDir(...parts: string[]) {
  // Runtime data lives outside the traced bundle on purpose.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().STUDIO_DATA_DIR, ...parts);
}

// =============================================================================
// Readiness report (shown in the header and at /api/health)
// =============================================================================

export type Readiness = {
  mode: Env["STUDIO_PROVIDERS"];
  catalog: Env["STUDIO_CATALOG"];
  gemini: boolean;
  tavily: boolean;
  exa: boolean;
  woocommerceCredentials: boolean;
  problems: string[];
};

export function readiness(): Readiness {
  const e = env();
  const problems: string[] = [];
  if (e.STUDIO_PROVIDERS === "live") {
    if (!e.GEMINI_API_KEY) problems.push("GEMINI_API_KEY ausente");
    if (!e.TAVILY_API_KEY && !e.EXA_API_KEY) problems.push("Informe TAVILY_API_KEY e/ou EXA_API_KEY");
  }
  if (e.STUDIO_CATALOG === "woocommerce" && (!e.WP_USERNAME || !e.WP_APPLICATION_PASSWORD)) {
    problems.push("WP_USERNAME / WP_APPLICATION_PASSWORD ausentes");
  }
  return {
    mode: e.STUDIO_PROVIDERS,
    catalog: e.STUDIO_CATALOG,
    gemini: Boolean(e.GEMINI_API_KEY),
    tavily: Boolean(e.TAVILY_API_KEY),
    exa: Boolean(e.EXA_API_KEY),
    woocommerceCredentials: Boolean(e.WP_USERNAME && e.WP_APPLICATION_PASSWORD),
    problems,
  };
}
