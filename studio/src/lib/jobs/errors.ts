import "server-only";
import { z } from "zod";
import { ConfigError, env } from "@/lib/env";
import { HttpError } from "@/lib/net/http";
import { SyncRejectedError } from "@/lib/pipeline/sync";
import { LlmOutputError } from "@/lib/providers/llm";
import { friendlyStoreError } from "@/lib/providers/woocommerce";
import type { ErrorCode } from "@/lib/types";

// =============================================================================
// Error classification
// =============================================================================
// The operator sees one short sentence in Portuguese and a matching piece of
// advice (chosen by the code on the client). The raw technical message is kept
// collapsed for whoever maintains the system, with secrets removed.

export type ClassifiedError = { code: ErrorCode; message: string; detail: string };

const SERVICES: Array<[RegExp, string]> = [
  [/(^|\.)tavily\.com$/i, "Tavily (pesquisa)"],
  [/(^|\.)exa\.ai$/i, "Exa (pesquisa)"],
  [/(^|\.)googleapis\.com$/i, "Gemini (inteligência artificial)"],
];

function serviceName(host: string | null): string {
  if (!host) return "um serviço externo";
  try {
    if (new URL(env().WC_BASE_URL).host === host) return "loja";
  } catch {
    // invalid configuration is reported elsewhere
  }
  for (const [pattern, name] of SERVICES) if (pattern.test(host)) return name;
  return host;
}

/** Remove configured secrets and key-like query parameters from a technical message. */
export function redact(text: string): string {
  let out = text;
  try {
    const e = env();
    for (const secret of [e.GEMINI_API_KEY, e.TAVILY_API_KEY, e.EXA_API_KEY, e.WP_APPLICATION_PASSWORD]) {
      if (secret && secret.length >= 8) out = out.split(secret).join("***");
    }
  } catch {
    // env not readable: still apply the generic rules below
  }
  return out
    .replace(/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, "$1***")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/g, "$1 ***")
    .slice(0, 1500);
}

function rawDetail(error: unknown): string {
  if (error instanceof LlmOutputError) return `${error.message}\n${error.raw.slice(0, 600)}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function byStatus(status: number, service: string, detail: string): Omit<ClassifiedError, "detail"> {
  if (status === 0)
    return { code: "network", message: `Sem conexão com ${service}. Confira a internet e tente de novo.` };
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(detail))) {
    return { code: "credentials", message: `${service} recusou a chave de acesso.` };
  }
  // 432/433: Tavily plan or pay-as-you-go limit reached.
  if ([402, 429, 432, 433].includes(status) || /quota|credits|rate.?limit|usage limit/i.test(detail)) {
    return { code: "quota", message: `${service} atingiu o limite de uso ou está sem créditos.` };
  }
  if (status >= 500 || status === 408 || /high demand|overloaded/i.test(detail)) {
    return {
      code: "network",
      message: `${service} está sobrecarregado ou instável agora. Tente de novo em alguns minutos.`,
    };
  }
  return { code: "unknown", message: `${service} recusou o pedido (HTTP ${status}).` };
}

export function classifyError(error: unknown): ClassifiedError {
  const detail = redact(rawDetail(error));
  if (error instanceof SyncRejectedError) return { code: "store", message: error.message, detail };
  if (error instanceof ConfigError) return { code: "config", message: error.message, detail };
  if (error instanceof LlmOutputError || error instanceof z.ZodError) {
    return {
      code: "ai",
      message: "A inteligência artificial devolveu uma resposta fora do formato esperado.",
      detail,
    };
  }
  if (error instanceof HttpError) {
    const service = serviceName(error.host);
    if (service === "loja") {
      const message = friendlyStoreError(error);
      if (error.status === 401 || error.status === 403) return { code: "credentials", message, detail };
      if (error.status === 0) return { code: "network", message, detail };
      return { code: "store", message, detail };
    }
    return { ...byStatus(error.status, service, detail), detail };
  }
  // Errors thrown by the Gemini SDK carry a numeric HTTP status.
  const e = error as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status !== null) return { ...byStatus(status, "Gemini (inteligência artificial)", detail), detail };
  if (/timeout|timed out|abort|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(detail)) {
    return { code: "network", message: "Um serviço externo demorou demais ou ficou fora do ar.", detail };
  }
  return { code: "unknown", message: "Aconteceu um erro inesperado.", detail };
}
