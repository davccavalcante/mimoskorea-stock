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

/** Convert a Zod schema to the JSON Schema accepted by response_format. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

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
      const input = request.images?.length
        ? [
            { type: "text" as const, text: prompt },
            ...request.images.map((img) => ({
              type: "image" as const,
              data: img.base64,
              mime_type: img.mimeType,
            })),
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
        { timeout: this.timeoutMs, maxRetries: 3 },
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
