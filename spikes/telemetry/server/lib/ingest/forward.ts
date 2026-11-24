const FORWARD_TIMEOUT_MS = 3000;

export interface ForwardResult {
  readonly ok: boolean;
  readonly status: number;
}

/** Forward the scrubbed payload to the operator's collector; the app returns no data. */
export async function forwardToCollector(
  collectorUrl: string,
  payload: unknown,
): Promise<ForwardResult> {
  try {
    const response = await fetch(collectorUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-spike-source": "ingestion" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
