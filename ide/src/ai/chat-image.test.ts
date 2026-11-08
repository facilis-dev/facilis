import { describe, expect, it } from "vitest";
import type { ImageCompressor } from "./chat-image";
import { MAX_IMAGE_BYTES, MAX_IMAGES, imageDataUrl, isImageFile, readImages } from "./chat-image";

function file(bytes: number, type = "image/png", name = "shot.png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Stands in for the canvas compressor: tags the URL so the tests can see it ran. */
const fake: ImageCompressor = async (pasted) => "compressed:" + pasted.name;

describe("pasted chat images (D-113)", () => {
  it("reads an image as a data URL", async () => {
    expect(await imageDataUrl(file(3))).toBe("data:image/png;base64,AAAA");
  });

  it("accepts the four provider image types and nothing else", () => {
    expect(isImageFile(file(1, "image/png"))).toBe(true);
    expect(isImageFile(file(1, "image/jpeg"))).toBe(true);
    expect(isImageFile(file(1, "image/webp"))).toBe(true);
    expect(isImageFile(file(1, "image/gif"))).toBe(true);
    expect(isImageFile(file(1, "image/svg+xml"))).toBe(false);
    expect(isImageFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBe(false);
  });

  it("drops an image over the size cap", async () => {
    expect(await imageDataUrl(file(MAX_IMAGE_BYTES + 1))).toBeNull();
  });

  it("hands every accepted file to the compressor, in clipboard order", async () => {
    const read = await readImages(
      [file(1, "image/png", "a.png"), file(1, "image/jpeg", "b.jpg")],
      fake,
    );
    expect(read.images).toEqual(["compressed:a.png", "compressed:b.jpg"]);
    expect(read.skipped).toBe(0);
  });

  it("skips unsupported, oversized and undecodable files", async () => {
    const calls: string[] = [];
    const compress: ImageCompressor = async (pasted) => {
      calls.push(pasted.name);
      if (pasted.name === "bad.png") throw new Error("decode failed");
      return "ok:" + pasted.name;
    };
    const read = await readImages(
      [
        file(1, "image/png", "bad.png"),
        new File(["x"], "a.pdf", { type: "application/pdf" }),
        file(MAX_IMAGE_BYTES + 1, "image/png", "huge.png"),
      ],
      compress,
    );
    expect(read.images).toEqual([]);
    expect(read.skipped).toBe(3);
    expect(calls).toEqual(["bad.png"]);
  });

  it("reads at most MAX_IMAGES per message", async () => {
    const read = await readImages(
      Array.from({ length: MAX_IMAGES + 2 }, (_, index) => file(1, "image/png", index + ".png")),
      fake,
    );
    expect(read.images).toHaveLength(MAX_IMAGES);
    expect(read.skipped).toBe(2);
  });
});
