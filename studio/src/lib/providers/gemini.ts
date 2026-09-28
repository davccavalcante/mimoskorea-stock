import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { LlmOutputError, type LlmProvider, type LlmRequest, type LlmResult } from "./llm";

// =============================================================================
// Gemini (Interactions API, @google/genai 2.x)
// =============================================================================
// - interactions.create is the recommended API since June 2026.
// - gemini-3.x ignores temperature/top_p; control effort with thinking_level.
// - store:false keeps prompts and scraped pages out of Google's interaction log.
// - timeout and maxRetries must be passed per call (client-level options do
//   not apply to interactions).

// JSON Schema keywords accepted by Gemini structured output. Anything else is
// removed: unknown keywords are either rejected or silently ignored, and a
// silently ignored constraint gives a false sense of safety (Zod validates the
// answer anyway).
const SCHEMA_KEYWORDS = new Set([
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
  "$id",
  "$defs",
  "$ref",
  "$anchor",
]);

/** Keys whose value is a map of sub-schemas (their own keys are names, not keywords). */
const SCHEMA_MAPS = new Set(["properties", "$defs"]);

// Zod adds these bounds to every z.number().int(); they carry no information.
const SAFE_INT = Number.MAX_SAFE_INTEGER;

export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "exclusiveMinimum" && typeof value === "number") {
      out.minimum = value;
      continue;
    }
    if (key === "exclusiveMaximum" && typeof value === "number") {
      out.maximum = value;
      continue;
    }
    if (key === "const" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      out.enum = [value];
      continue;
    }
    if (!SCHEMA_KEYWORDS.has(key)) continue;
    if ((key === "minimum" && value === -SAFE_INT) || (key === "maximum" && value === SAFE_INT)) continue;
    if (SCHEMA_MAPS.has(key) && value && typeof value === "object") {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, sanitizeSchema(sub)]));
    } else if (key === "additionalProperties" && typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = sanitizeSchema(value);
    }
  }
  return out;
}

/** Convert a Zod schema to the JSON Schema accepted by response_format. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" });
  return sanitizeSchema(json) as Record<string, unknown>;
}

/** Wall-clock limit per operation (a hung call must not freeze the operator's screen). */
const TIMEOUTS_MS: Record<string, number> = { identify: 60_000, images: 90_000, write: 300_000 };

/**
 * Parse the model's JSON. Some models wrap it in a Markdown fence (```json)
 * or add a sentence around it despite the JSON response format.
 */
export function parseModelJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        // fall through to the brace scan
      }
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new SyntaxError("Resposta sem JSON");
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("; ");
}

/** HTTP status of an SDK error (the SDK uses `status` or `statusCode` depending on the error class). */
export function errorStatus(error: unknown): number | null {
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  return status;
}

/** Overloaded or rate-limited model: worth retrying later or on another model. */
export function isOverloaded(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /high demand|overloaded|unavailable|resource.?exhausted|try again later/i.test(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before retrying the SAME model, or null to move on now.
 * "limit: 20 requests per day" -> null (the quota is gone until tomorrow);
 * "Please retry in 23s" -> 24 s when short enough; 503 -> 5 s.
 */
export function retryWaitMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/per day|daily|limit: 0 /i.test(message)) return null;
  const retryIn = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(message);
  if (retryIn) {
    const seconds = Number(retryIn[1]);
    return seconds <= 30 ? Math.ceil(seconds + 1) * 1000 : null;
  }
  return errorStatus(error) === 429 ? 10_000 : 5_000;
}

function describeLimit(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/per day|daily/i.test(message)) return "cota diária esgotada";
  if (errorStatus(error) === 429) return "limite de uso";
  return "sobrecarregado";
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly defaultModel: string,
    private readonly timeoutMs: number,
    /** Models tried in order when the main one is overloaded (HTTP 503/429). */
    private readonly fallbackModels: string[] = [],
    private readonly onFallback: (message: string) => void = () => {},
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Try the requested model, then the fallbacks. On busy days Google answers
   * 503 "high demand"; on the Free Tier it also answers 429 when the daily or
   * per-minute quota is used up. A daily quota skips to the next model at
   * once; a short per-minute limit or a 503 waits and retries once.
   */
  async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const first = request.model ?? this.defaultModel;
    const models = [first, ...this.fallbackModels.filter((m) => m && m !== first)];
    let lastError: unknown = null;
    for (const [index, model] of models.entries()) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await this.generateWith(model, request);
        } catch (error) {
          if (!isOverloaded(error)) throw error;
          lastError = error;
          const wait = retryWaitMs(error);
          if (attempt === 2 || wait === null) break;
          await sleep(wait);
        }
      }
      const next = models[index + 1];
      if (next)
        this.onFallback(`${model} indisponível em ${request.operation} (${describeLimit(lastError)}); usando ${next}`);
    }
    throw lastError;
  }

  private async generateWith<T>(model: string, request: LlmRequest<T>): Promise<LlmResult<T>> {
    const schema = toResponseSchema(request.schema);
    let prompt = request.prompt;
    let lastRaw = "";
    let lastProblem = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      // Each image is preceded by its own label, so indices can never drift.
      const input = request.images?.length
        ? [
            { type: "text" as const, text: prompt },
            ...request.images.flatMap((img, index) => [
              { type: "text" as const, text: `Image index ${index}:` },
              { type: "image" as const, data: img.base64, mime_type: img.mimeType },
            ]),
          ]
        : prompt;

      const interaction = await this.ai.interactions.create(
        {
          model,
          system_instruction: request.system,
          input,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema,
          },
          generation_config: { thinking_level: request.thinking ?? "medium" },
          store: false,
        },
        { timeout: Math.min(this.timeoutMs, TIMEOUTS_MS[request.operation] ?? this.timeoutMs), maxRetries: 0 },
      );

      if (interaction.status && interaction.status !== "completed") {
        throw new LlmOutputError(`Gemini terminou com status "${interaction.status}" em ${request.operation}`, "");
      }

      lastRaw = interaction.output_text ?? "";
      let parsedJson: unknown;
      try {
        parsedJson = parseModelJson(lastRaw);
      } catch {
        lastProblem = "resposta não é JSON válido";
        prompt = `${request.prompt}\n\nATENÇÃO: sua resposta anterior não era JSON válido. Responda somente com JSON válido no schema pedido.`;
        continue;
      }
      const parsed = request.schema.safeParse(parsedJson);
      if (parsed.success) {
        const u = interaction.usage;
        const usage = u
          ? `${model}: ${u.total_input_tokens ?? 0} in / ${u.total_output_tokens ?? 0} out / ${u.total_thought_tokens ?? 0} thinking tokens`
          : `${model}: n/d`;
        return { data: parsed.data, model, usage };
      }
      lastProblem = describeIssues(parsed.error);
      prompt = `${request.prompt}\n\nATENÇÃO: sua resposta anterior não respeitou o schema (${lastProblem}). Corrija e responda somente com JSON válido.`;
    }
    throw new LlmOutputError(
      `${model} devolveu uma resposta inválida em ${request.operation}: ${lastProblem}`,
      lastRaw.slice(0, 20_000),
    );
  }
}
