export type FetchFn = typeof fetch;

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  timeoutMs: number;
}

/** Sends a request and parses the JSON reply. Never logs headers or bodies, which carry secrets. */
export async function requestJson<T = Record<string, unknown>>(
  fetchFn: FetchFn,
  provider: string,
  url: string,
  options: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: string | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProviderError(provider, `could not reach ${new URL(url).host} (${reason})`, "network_error");
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(provider, `unexpected reply (HTTP ${response.status}): ${text.slice(0, 200)}`, "bad_response");
  }
  if (!response.ok) {
    throw new ProviderError(provider, `HTTP ${response.status}`, `http_${response.status}`, parsed);
  }
  return parsed as T;
}

/** Formats an amount as bKash and SSLCommerz expect: a string with two decimals. */
export function toAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ProviderError("bd-connector", `amount must be a positive number, got ${amount}`, "invalid_amount");
  }
  return amount.toFixed(2);
}
