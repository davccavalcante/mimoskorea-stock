import "server-only";

// =============================================================================
// JSON over HTTP with timeouts, bounded retries and readable errors
// =============================================================================

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: BodyInit;
  timeoutMs?: number;
  retries?: number;
  /** Extract an error message from a provider-specific error body. */
  errorMessage?: (body: unknown) => string | undefined;
};

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const { method = "GET", headers = {}, body, rawBody, timeoutMs = 30_000, retries = 2, errorMessage } = options;
  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      if (attempt <= retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(`Falha de rede ao acessar ${new URL(url).host}: ${reason}`, 0, null, null);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (res.ok) {
      const type = res.headers.get("content-type") ?? "";
      if (text && !type.includes("json")) {
        // WordPress with "plain" permalinks answers REST POSTs with the home page (HTTP 200, text/html).
        throw new HttpError(
          `${new URL(url).host} respondeu HTML em vez de JSON. No WordPress, ative links permanentes (Configurações > Links permanentes > Nome do post).`,
          res.status,
          text.slice(0, 300),
          null,
        );
      }
      return { data: data as T, headers: res.headers };
    }

    const retryAfter = Number(res.headers.get("retry-after")) || null;
    if (RETRYABLE.has(res.status) && attempt <= retries) {
      await sleep(retryAfter ? Math.min(retryAfter, 30) * 1000 : 750 * 2 ** attempt);
      continue;
    }
    const detail =
      errorMessage?.(data) ?? (typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data)?.slice(0, 300));
    throw new HttpError(
      `${method} ${new URL(url).host}${new URL(url).pathname} -> HTTP ${res.status}: ${detail}`,
      res.status,
      data,
      retryAfter,
    );
  }
}
