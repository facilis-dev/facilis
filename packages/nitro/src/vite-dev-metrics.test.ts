import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_METRICS_MARKER } from "./dev-metrics-client.ts";
import { facilis } from "./vite.ts";
import { DEV_METRICS_PLUGIN_NAME, devMetricsEnabled, facilisDevMetrics } from "./vite-dev-metrics.ts";

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "facilis-dev-metrics-"));
  tempRoots.push(root);
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(join(root, "main.js"), "console.log('app');");
  return root;
}

async function distContents(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(await readFile(full, "utf8"));
    }
  };
  await walk(join(root, "dist"));
  return files.join("\n");
}

describe("facilisDevMetrics gating", () => {
  it("is serve-only and wired into facilis()", () => {
    const plugin = facilisDevMetrics();
    expect(plugin.name).toBe(DEV_METRICS_PLUGIN_NAME);
    expect(plugin.apply).toBe("serve");
    const fromFacilis = facilis().find((p) => p.name === DEV_METRICS_PLUGIN_NAME);
    expect(fromFacilis?.apply).toBe("serve");
  });

  it("a production build contains no metrics client (grepped artifact)", async () => {
    const root = await fixture();
    await build({
      root,
      logLevel: "silent",
      plugins: [facilisDevMetrics()],
      build: { outDir: "dist" },
    });
    const artifact = await distContents(root);
    expect(artifact).not.toContain(DEV_METRICS_MARKER);
    expect(artifact).not.toContain("vv-metrics");
  }, 30_000);

  it("serve mode injects the client into index.html", async () => {
    const root = await fixture();
    const server = await createServer({
      root,
      logLevel: "silent",
      plugins: [facilisDevMetrics()],
      server: { middlewareMode: true },
    });
    try {
      const html = await server.transformIndexHtml(
        "/index.html",
        await readFile(join(root, "index.html"), "utf8"),
      );
      expect(html).toContain(DEV_METRICS_MARKER);
      expect(html).toContain("vv-metrics");
    } finally {
      await server.close();
    }
  }, 30_000);

  it("FACILIS_DEV_METRICS=0 removes the injection without touching project code", async () => {
    expect(devMetricsEnabled({})).toBe(true);
    expect(devMetricsEnabled({ FACILIS_DEV_METRICS: "0" })).toBe(false);
    const root = await fixture();
    const server = await createServer({
      root,
      logLevel: "silent",
      plugins: [facilisDevMetrics({ FACILIS_DEV_METRICS: "0" })],
      server: { middlewareMode: true },
    });
    try {
      const original = await readFile(join(root, "index.html"), "utf8");
      const html = await server.transformIndexHtml("/index.html", original);
      // Vite itself injects /@vite/client in serve mode; only our marker must be absent.
      expect(html).not.toContain(DEV_METRICS_MARKER);
      expect(html).not.toContain("vv-metrics");
    } finally {
      await server.close();
    }
  }, 30_000);
});
