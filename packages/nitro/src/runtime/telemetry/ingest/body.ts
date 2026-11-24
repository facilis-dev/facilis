/**
 * 1 MiB body cap (spec §8.8, the same cap defineAuthorizedHandler applies): rejected from
 * content-length when it is declared, and again from a streamed counter so a chunked or
 * lying client cannot slip past it.
 */
import type { HeaderReader } from "../../http-guard.ts";

export interface BodySource {
  readonly headers: HeaderReader;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type BodyReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false };

export async function readBodyCapped(
  request: BodySource,
  maxBytes: number,
): Promise<BodyReadResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    return { ok: false };
  }
  const stream = request.body;
  if (stream === null) {
    return { ok: true, text: "" };
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, text: text + decoder.decode() };
}
