/**
 * The framework-owned prerender pass (D-202 §1, Arm C — the #80 spike's proven shape):
 * after the client build, an SSR bundle is built and imported IN THE SAME REALM (no worker,
 * no headless browser, no native binary), the allowlist is rendered with `react-dom/static`
 * over loopback public data, and per-route HTML + the XSS-escaped state island + sitemap +
 * the shell fallback are written. A declared-but-ineligible route or an error data response
 * fails the build; an error body is never written as a page.
 *
 * Trigger timing: the static template runs in the client's `closeBundle`; full-stack runs
 * in a post `buildApp` hook ordered after Nitro's own (which builds the client and then
 * `.output`), the one point where the shell is captured AND the data server exists. The
 * shell is captured from the client's index.html asset before Nitro relocates it to its
 * renderer template.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";

import { prerenderBuildErrors, type Analysis } from "@facilis.dev/analyze";

import { fetchPublicData, pagePublicGets } from "./prerender-data.ts";
import { writePrerenderStamp } from "./prerender-dev.ts";
import {
  PRERENDER_ENTRY_INPUT,
  prerenderEntryPlugin,
  prerenderEntrySource,
} from "./prerender-entry.ts";
import { formatPrerenderBuildError } from "./prerender-gate.ts";
import {
  assemblePrerenderDocument,
  routeOutputPath,
  sitemapXml,
} from "./prerender-html.ts";

export interface PrerenderDeclaration {
  readonly routes: readonly string[];
  readonly origin?: string;
}

export interface PrerenderEngineOptions {
  /** Full-stack boots the built Nitro server for data; static pages carry no API calls. */
  readonly mode: "full-stack" | "static";
  /** The shared cached analysis (no second analyzer run). */
  readonly getAnalysis: () => Analysis | undefined;
  /** Static-template declaration (the prerender() plugin options). */
  readonly getDeclaration?: () => PrerenderDeclaration;
}

export interface PrerenderEngine {
  /** Captures the client shell; runs the pass after the build (see timing note above). */
  readonly plugin: Plugin;
}

interface RenderModule {
  render: (
    route: string,
    data: Record<string, unknown>,
  ) => Promise<{ head: string; body: string }>;
}

export const PRERENDER_ENGINE_PLUGIN_NAME = "facilis:prerender-engine";

export function facilisPrerenderEngine(options: PrerenderEngineOptions): PrerenderEngine {
  let root = process.cwd();
  let fallbackOutDir = resolve(root, "dist");
  let shellHtml = "";
  let clientOutDir = "";
  let done = false;

  const declarationOf = (analysis: Analysis): PrerenderDeclaration => {
    if (options.getDeclaration !== undefined) return options.getDeclaration();
    const config = analysis.config.prerender;
    return { routes: config.routes, origin: config.origin ?? undefined };
  };

  const run = async (): Promise<void> => {
    if (done || shellHtml === "") return;
    done = true;
    const analysis = options.getAnalysis();
    if (analysis === undefined) {
      throw new Error("[facilis] prerender: the project analysis is unavailable");
    }
    const declaration = declarationOf(analysis);
    const outDir = clientOutDir === "" ? fallbackOutDir : clientOutDir;
    if (declaration.routes.length === 0) {
      // Off by default; the shell fallback is still part of the build output contract.
      writeOutput(outDir, "shell.html", shellHtml);
      writePrerenderStamp(root, { outDir, routes: [], origin: null, builtAt: Date.now() });
      return;
    }
    for (const failure of prerenderBuildErrors(analysis.prerender)) {
      throw new Error(formatPrerenderBuildError(failure));
    }
    const facts = declaration.routes
      .map((route) => analysis.prerender.find((fact) => fact.declared && fact.path === route))
      .filter((fact) => fact !== undefined);

    const ssrOutDir = resolve(outDir, ".prerender");
    const { build } = await import("vite");
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      plugins: [prerenderEntryPlugin(prerenderEntrySource({ root }))],
      build: {
        ssr: true,
        outDir: ssrOutDir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          input: { entry: PRERENDER_ENTRY_INPUT },
          output: { entryFileNames: "entry.mjs" },
        },
      },
    });
    // Dynamic ESM import of the built chunk in-process (spike-proven over the VM's VFS).
    const entry = (await import(pathToFileURL(resolve(ssrOutDir, "entry.mjs")).href)) as RenderModule;

    try {
      const data =
        options.mode === "full-stack"
          ? await fetchPublicData(
              resolve(root, ".output/server/index.mjs"),
              [...new Set(facts.flatMap((fact) => pagePublicGets(analysis, fact)))],
            )
          : {};
      for (const fact of facts) {
        const gets = pagePublicGets(analysis, fact);
        const island: Record<string, unknown> = {};
        for (const path of gets) island[path] = data[path];
        const { head, body } = await entry.render(fact.path, island);
        const document = assemblePrerenderDocument({
          shell: shellHtml,
          head,
          body,
          island,
          origin: declaration.origin,
          route: fact.path,
        });
        writeOutput(outDir, routeOutputPath(fact.path), document);
      }
      if (declaration.origin !== undefined) {
        writeOutput(outDir, "sitemap.xml", sitemapXml(declaration.origin, declaration.routes));
      }
      writeOutput(outDir, "shell.html", shellHtml);
      writePrerenderStamp(root, {
        outDir,
        routes: declaration.routes,
        origin: declaration.origin ?? null,
        builtAt: Date.now(),
      });
    } finally {
      rmSync(ssrOutDir, { recursive: true, force: true });
    }
  };

  const plugin: Plugin = {
    name: PRERENDER_ENGINE_PLUGIN_NAME,
    apply: "build",
    // post: capture index.html after vite:build-html has emitted it.
    enforce: "post",
    configResolved(config) {
      root = config.root;
      // The per-environment build.outDir may stay relative; anchor it at the project root.
      fallbackOutDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_bundleOptions, bundle) {
      const environmentName = this.environment?.name ?? "client";
      if (environmentName !== "client") return;
      const html = bundle["index.html"];
      if (html !== undefined && html.type === "asset") {
        shellHtml = String(html.source);
        clientOutDir = resolve(root, this.environment?.config.build.outDir ?? fallbackOutDir);
      }
    },
    // Full-stack: Nitro's buildApp hook (order post) builds the client and then .output;
    // this plugin's enforce post puts its own post buildApp after Nitro's, the one point
    // where the shell is captured AND the data server exists. Vite plugin hooks never run
    // in the nitro environment itself, so closeBundle cannot be the full-stack trigger.
    buildApp: {
      order: "post",
      async handler() {
        if (options.mode === "full-stack") await run();
      },
    },
    async closeBundle() {
      if (options.mode !== "static") return;
      const environmentName = this.environment?.name ?? "client";
      if (environmentName !== "client") return;
      try {
        await run();
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
  };

  return { plugin };
}

function writeOutput(outDir: string, relativePath: string, content: string): void {
  const file = resolve(outDir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
