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

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("; ");
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly defaultModel: string,
    private readonly timeoutMs: number,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
    const model = request.model ?? this.defaultModel;
    const schema = toResponseSchema(request.schema);
    let prompt = request.prompt;
    let lastRaw = "";

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
        { timeout: Math.min(this.timeoutMs, TIMEOUTS_MS[request.operation] ?? this.timeoutMs), maxRetries: 1 },
      );

      if (interaction.status && interaction.status !== "completed") {
        throw new LlmOutputError(`Gemini terminou com status "${interaction.status}" em ${request.operation}`, "");
      }

      lastRaw = interaction.output_text ?? "";
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(lastRaw);
      } catch {
        prompt = `${request.prompt}\n\nATENÇÃO: sua resposta anterior não era JSON válido. Responda somente com JSON válido no schema pedido.`;
        continue;
      }
      const parsed = request.schema.safeParse(parsedJson);
      if (parsed.success) {
        const u = interaction.usage;
        const usage = u
          ? `${u.total_input_tokens ?? 0} in / ${u.total_output_tokens ?? 0} out / ${u.total_thought_tokens ?? 0} thinking tokens`
          : "n/d";
        return { data: parsed.data, model, usage };
      }
      prompt = `${request.prompt}\n\nATENÇÃO: sua resposta anterior não respeitou o schema (${describeIssues(parsed.error)}). Corrija e responda somente com JSON válido.`;
    }
    throw new LlmOutputError(`Gemini devolveu uma resposta inválida em ${request.operation}`, lastRaw.slice(0, 2000));
  }
}
