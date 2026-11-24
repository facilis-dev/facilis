/**
 * Forward the scrubbed OTLP/JSON payload to the operator's collector (D-203 §3); the app
 * returns no data. The per-signal path mirrors export.ts: the config carries only the
 * collector base URL. No browser-supplied credential is ever forwarded — collector access
 * control is the operator's, and the backend export carries no auth header either.
 */
const TRACES_PATH = "/v1/traces";
const FORWARD_TIMEOUT_MS = 3000;

export interface ForwardResult {
  readonly ok: boolean;
  readonly status: number;
}

export async function forwardToCollector(
  endpoint: string,
  payload: unknown,
): Promise<ForwardResult> {
  try {
    const response = await fetch(endpoint + TRACES_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
