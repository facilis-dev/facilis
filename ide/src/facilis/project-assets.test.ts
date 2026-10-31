import { describe, expect, it } from "vitest";

import { createFacilisTemplate, type FacilisManifest } from "./facilis-template";
import { withTemplateAssets } from "./project-assets";

const template = createFacilisTemplate();
const assets = (template.manifest as FacilisManifest).assets;

describe("template binary assets", () => {
  it("inlines each tarball under the path its file: dependency names", async () => {
    const fetched: string[] = [];
    const payload = await withTemplateAssets(template, template.files, (async (input: string) => {
      fetched.push(input);
      return new Response(new TextEncoder().encode("tgz:" + input), {
        headers: { "content-type": "application/gzip" },
      });
    }) as unknown as typeof fetch);

    expect(payload["package.json"]).toBe(template.files["package.json"]);
    expect(fetched).toHaveLength(assets.length);
    for (const asset of assets) {
      const body = payload[asset.path];
      expect(body, "missing " + asset.path).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(body as Uint8Array)).toContain(asset.asset.slice(-8));
    }
  });

  it("refuses the SPA's 200-with-HTML fallback instead of writing an HTML tarball", async () => {
    const html = (async () =>
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    await expect(withTemplateAssets(template, template.files, html)).rejects.toThrow(/not served/);
  });

  it("leaves a template without assets untouched", async () => {
    const stub = {
      manifest: { id: "blank" } as unknown as FacilisManifest,
      files: { "index.js": "console.log(1);\n" },
    };
    const payload = await withTemplateAssets(stub, stub.files, (() => {
      throw new Error("must not fetch");
    }) as unknown as typeof fetch);
    expect(payload).toBe(stub.files);
  });
});
