import "server-only";
import type { z } from "zod";

// =============================================================================
// LLM provider contract
// =============================================================================

export type LlmImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
};

export type LlmRequest<T> = {
  /** Short operation name for logs and the job usage trail. */
  operation: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: LlmImage[];
  thinking?: "low" | "medium" | "high";
  /** Override the default model (e.g. a vision model). */
  model?: string;
};

export type LlmResult<T> = { data: T; model: string; usage: string };

export interface LlmProvider {
  readonly name: string;
  generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}

export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "LlmOutputError";
  }
}
