import { describe, expect, it } from "vitest";

import { readBodyCapped, type BodySource } from "./body.ts";

const CAP = 1024;

function source(body: ReadableStream<Uint8Array> | null, contentLength?: string): BodySource {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return { headers, body };
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("readBodyCapped", () => {
  it("reads a body under the cap", async () => {
    const result = await readBodyCapped(source(streamOf(['{"a":', "1}"])), CAP);
    expect(result).toEqual({ ok: true, text: '{"a":1}' });
  });

  it("rejects a declared content-length over the cap without reading the stream", async () => {
    let readerRequested = false;
    const inner = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([120]));
        controller.close();
      },
    });
    const body = {
      getReader: () => {
        readerRequested = true;
        return inner.getReader();
      },
    } as unknown as ReadableStream<Uint8Array>;
    const result = await readBodyCapped(source(body, String(CAP + 1)), CAP);
    expect(result).toEqual({ ok: false });
    expect(readerRequested).toBe(false);
  });

  it("rejects a chunked body that crosses the cap mid-stream (lying or absent length)", async () => {
    const chunk = "x".repeat(600);
    const result = await readBodyCapped(source(streamOf([chunk, chunk])), CAP);
    expect(result).toEqual({ ok: false });
  });

  it("accepts a body exactly at the cap", async () => {
    const result = await readBodyCapped(source(streamOf(["x".repeat(CAP)])), CAP);
    expect(result.ok).toBe(true);
  });

  it("treats a null body as empty text", async () => {
    expect(await readBodyCapped(source(null), CAP)).toEqual({ ok: true, text: "" });
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("héllo");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    const result = await readBodyCapped(source(body), CAP);
    expect(result).toEqual({ ok: true, text: "héllo" });
  });
});
