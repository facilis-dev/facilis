/** Environment-independent response envelope used by pure builders and route adapters. */
export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export function jsonResult(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResult {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

/** Adapter from the pure builders to a web Response (Nitro v3/h3 v2 accept it). */
export function toResponse(result: HttpResult): Response {
  const headers = new Headers(result.headers);
  if (result.body === undefined) return new Response(null, { status: result.status, headers });
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}

/** Request URLs are origin-relative in Nitro; a dummy base only lets URL parse them. */
export function parseRequestUrl(rawUrl: string): URL {
  return new URL(rawUrl, "http://localhost");
}
