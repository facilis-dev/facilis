// The prerender toggle's studio write (D-202 §2, issue #84, SPEC §8 invariant 7).
//
// The declaration goes through the kernel VFS (`vv-write`, the graph-layout-io precedent —
// the kernel worker applies it with writeFiles), never OPFS directly. Full-stack projects
// declare `prerender.routes` in facilis.config.ts; static templates have no config file and
// declare the same allowlist as the `prerender()` plugin option in vite.config.ts. The pure
// editor fails closed on anything ambiguous; this module turns that into a result the panel
// renders, then drops the analysis source cache so the graph refresh reads the new bytes.

import type { IdeController } from "@/vv/controller";
import { invalidateProjectSources } from "./analyze-client";
import { setConfigPrerenderRoute, setVitePrerenderRoute } from "./prerender-declaration";

export type PrerenderWriteResult =
  { readonly ok: true; readonly file: string } | { readonly ok: false; readonly error: string };

const CONFIG_FILE = "facilis.config.ts";
const VITE_FILE = "vite.config.ts";

/**
 * Add or remove one page route in the project's prerender allowlist. The target file is the
 * config when it exists, else the Vite config (the analyzer's own declaration order). A
 * no-op edit (already declared / not declared) succeeds without writing.
 */
export async function writePrerenderDeclaration(
  controller: IdeController,
  root: string,
  route: string,
  enabled: boolean,
): Promise<PrerenderWriteResult> {
  // The core route rules (prerender-config.ts): absolute, param-free, no query/fragment.
  if (!route.startsWith("/") || /[:{}*?#\s\\]/.test(route) || route.includes("//")) {
    return { ok: false, error: "not a prerenderable page path: " + route };
  }
  if (route.length > 1 && route.endsWith("/")) {
    return { ok: false, error: "prerender route must not end with '/': " + route };
  }
  const configPath = root + "/" + CONFIG_FILE;
  const vitePath = root + "/" + VITE_FILE;
  const hasConfig = (await controller.pathInfo(configPath)).exists;
  const target = hasConfig ? configPath : vitePath;
  if (!hasConfig && !(await controller.pathInfo(vitePath)).exists) {
    return { ok: false, error: "no facilis.config.ts or vite.config.ts to declare routes in" };
  }
  const source = await controller.readFileText(target);
  const next = hasConfig
    ? setConfigPrerenderRoute(source, route, enabled)
    : setVitePrerenderRoute(source, route, enabled);
  if (next === null) {
    return {
      ok: false,
      error:
        "the declaration in " +
        (hasConfig ? CONFIG_FILE : VITE_FILE) +
        " cannot be edited safely; edit it manually",
    };
  }
  if (next === source) return { ok: true, file: target };
  const reply = await controller.bridge.request("vv-write", { path: target, contents: next });
  if (reply.ok !== true) {
    return {
      ok: false,
      error: typeof reply.error === "string" ? reply.error : "vv-write failed",
    };
  }
  invalidateProjectSources();
  return { ok: true, file: target };
}
