import { describe, expect, it } from "vitest";
import { readSse } from "./sse";

const encoder = new TextEncoder();

function streamOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(chunks: readonly (string | Uint8Array)[]): Promise<string[]> {
  const events: string[] = [];
  await readSse(streamOf(chunks), (data) => {
    events.push(data);
  });
  return events;
}

describe("readSse", () => {
  it("dispatches one event per blank line", async () => {
    await expect(collect(["data: one\n\ndata: two\n\n"])).resolves.toEqual(["one", "two"]);
  });

  it("keeps an event split across chunks and inside a field name", async () => {
    await expect(collect(["da", "ta: hel", "lo\n", "\n"])).resolves.toEqual(["hello"]);
  });

  it("joins multi-line data and ignores comments and other fields", async () => {
    const frame = "event: delta\nid: 7\nretry: 100\n: ping\ndata: first\ndata: second\n\n";
    await expect(collect([frame])).resolves.toEqual(["first\nsecond"]);
  });

  it("tolerates CRLF, including a CRLF split across chunks", async () => {
    await expect(collect(["data: a\r\n\r\ndata: b\r", "\n\r", "\n"])).resolves.toEqual(["a", "b"]);
  });

  it("dispatches a final event without a trailing blank line", async () => {
    await expect(collect(["data: last"])).resolves.toEqual(["last"]);
    await expect(collect(["data: last\n"])).resolves.toEqual(["last"]);
  });

  it("passes [DONE] through and strips one optional space after data:", async () => {
    await expect(collect(["data:[DONE]\n\ndata: [DONE]\n\n"])).resolves.toEqual([
      "[DONE]",
      "[DONE]",
    ]);
  });

  it("keeps an empty data field as an empty payload", async () => {
    await expect(collect(["data:\n\n"])).resolves.toEqual([""]);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const bytes = encoder.encode("data: hällo\n\n");
    await expect(collect([bytes.slice(0, 8), bytes.slice(8)])).resolves.toEqual(["hällo"]);
  });

  it("rejects when the reader throws", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("aborted"));
      },
    });
    await expect(readSse(failing, () => {})).rejects.toThrow("aborted");
  });
});
