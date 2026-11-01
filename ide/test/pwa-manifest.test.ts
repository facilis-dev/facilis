import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pngSize = (rel: string) => {
  const bytes = readFileSync(new URL(rel, import.meta.url));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const manifest = JSON.parse(read("../public/manifest.json")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

describe("web app manifest", () => {
  it("carries the fields Chrome needs to offer the install", () => {
    expect(manifest.name).toBe("facilis.dev");
    expect(manifest.short_name).toBe("facilis.dev");
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("ships 192 and 512 PNG icons whose declared size matches the file", () => {
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.purpose ?? "any").toBe("any");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize("../public/" + icon.src.replace(/^\//, ""))).toEqual({ width, height });
    }
  });

  it("is linked from the page that is installed", () => {
    expect(read("../index.html")).toContain('rel="manifest" href="/manifest.json"');
  });
});
