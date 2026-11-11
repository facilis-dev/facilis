import { describe, expect, it } from "vitest";

import { createFacilisTemplate, type FacilisManifest } from "./facilis-template";
import { withTemplateAssets } from "./project-assets";

const template = createFacilisTemplate();
const assets = (template.manifest as FacilisManifest).assets;

// A stand-in template carrying one asset, so the machinery stays covered even though the
// Facilis template ships no binary asset any more (D-166).
const probeAsset = { path: "vendor/probe-0.0.0.tgz", asset: "vendor/probe/probe.tgz" };
const probe = {
  manifest: { id: "probe", assets: [probeAsset] } as unknown as FacilisManifest,
  files: { "package.json": "{}\n" },
};

describe("template binary assets", () => {
  it("ships no assets now that the packages install from npm", () => {
    expect(assets).toEqual([]);
  });

  it("inlines a fetched asset under the path its dependency names", async () => {
    const fetched: string[] = [];
    const payload = await withTemplateAssets(probe, probe.files, (async (input: string) => {
      fetched.push(input);
      return new Response(new TextEncoder().encode("tgz:" + input), {
        headers: { "content-type": "application/gzip" },
      });
    }) as unknown as typeof fetch);

    expect(payload["package.json"]).toBe(probe.files["package.json"]);
    // The asset URL is the app-base-prefixed studio path; the project path is the spec's.
    expect(fetched).toEqual([import.meta.env.BASE_URL + probeAsset.asset]);
    const body = payload[probeAsset.path];
    expect(body, "missing " + probeAsset.path).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(body as Uint8Array)).toContain(probeAsset.asset);
  });

  it("refuses the SPA's 200-with-HTML fallback instead of writing an HTML tarball", async () => {
    const html = (async () =>
      new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    await expect(withTemplateAssets(probe, probe.files, html)).rejects.toThrow(/not served/);
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
