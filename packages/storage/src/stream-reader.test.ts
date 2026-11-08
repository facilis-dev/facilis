import { describe, expect, it } from "vitest";

import { StreamReader } from "./stream-reader.ts";
import { StorageError } from "./types.ts";

function sourceOf(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

describe("StreamReader", () => {
  it("skips empty source chunks for exact reads", async () => {
    const reader = new StreamReader(
      sourceOf([
        new Uint8Array(0),
        new Uint8Array([1, 2]),
        new Uint8Array(0),
        new Uint8Array([3, 4]),
      ]),
    );
    expect(await reader.readExactly(4)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(await reader.readByte()).toBeNull();
  });

  it("skips empty source chunks for bounded reads", async () => {
    const reader = new StreamReader(
      sourceOf([new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(0)]),
    );
    expect(await reader.readAtMost(2)).toEqual(Buffer.from([1, 2]));
    expect(await reader.readAtMost(2)).toEqual(Buffer.from([3]));
    expect(await reader.readAtMost(2)).toEqual(Buffer.alloc(0));
  });

  it("throws instead of returning partially uninitialised bytes", async () => {
    await expect(
      new StreamReader(sourceOf([new Uint8Array([1])])).readExactly(2),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("unshifts a lookahead byte", async () => {
    const reader = new StreamReader(sourceOf([new Uint8Array([1, 2])]));
    const byte = await reader.readByte();
    if (byte === null) throw new Error("expected a byte");
    reader.unshift(byte);
    expect(await reader.readExactly(2)).toEqual(Buffer.from([1, 2]));
  });
});
