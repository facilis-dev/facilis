// The in-VM prerender trigger (D-202 §5/§7, issue #85): `vite build` stays the only
// build command, so the action runs the project's `npm run build` through the kernel's
// generic spawn channel (the framework-gate precedent) and mirrors its output into a
// managed terminal tab, runProject-style. An interactive shell would outlive the build
// (no term-exit on command completion), so proc-exit is the completion signal.
// The dev server is never touched: a failed or timed-out build leaves it running.

import { toast } from "sonner";
import { t } from "@/i18n";
import type { IdeController } from "@/vv/controller";
import type { KernelMessage } from "@/vv/kernel";
import { openPageInPreview } from "./graph-open-preview";

/** Structural slices of the controller so tests can fake the run without a kernel. */
export interface PrerenderRunBridge {
  request(type: string, extra?: Record<string, unknown>): Promise<KernelMessage>;
  post(type: string, extra?: Record<string, unknown>): void;
  on(type: string, handler: (m: KernelMessage) => void): () => void;
}

export interface PrerenderRunTerminals {
  newShellTerminal(opts: {
    cwd?: string | null;
    label?: string | null;
    activate?: boolean;
  }): string;
  /** Mirror spawned output into the tab's xterm (the controller's term-out path). */
  writeTo(id: string, chunk: string): unknown;
  closeTerminal(id: string): void;
}

export interface PrerenderRunDeps {
  bridge: PrerenderRunBridge;
  terminals: PrerenderRunTerminals;
  /** Status-bar narration (the controller's StatusMessage.show). */
  status?: (text: string) => void;
}

export type PrerenderRunPhase = "installing" | "building" | "ready" | "failed";

export interface PrerenderRunState {
  root: string;
  phase: PrerenderRunPhase;
  terminalId: string;
  startedAt: number;
  durationMs: number | null;
  /** Declared routes from the build stamp once ready. */
  routes: readonly string[];
  /** Machine code when the framework named one (e.g. "prerender-ineligible"). */
  errorCode: string | null;
  /** Localized failure detail, t()-resolved at emit time. */
  error: string | null;
}

/** SPEC §13 risk row (D-202): the in-VM build must never hang the IDE. A ~50-route
 * full-stack build measured 17.3 s in-VM (smoke-prerender, DEV.md §6.2); the ten-minute
 * budget is a hang guard, not a speed limit. */
export const PRERENDER_BUILD_TIMEOUT_MS = 600_000;

let state: PrerenderRunState | null = null;
const listeners = new Set<() => void>();

export function subscribePrerenderRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPrerenderRun(): PrerenderRunState | null {
  return state;
}

function emit(next: PrerenderRunState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** VFS read: null when absent or unreadable, never a throw (framework-gate pattern). */
async function vfsRead(bridge: PrerenderRunBridge, path: string): Promise<string | null> {
  try {
    const m = await bridge.request("vv-read", { path });
    return m.ok === true && typeof m.contents === "string" ? m.contents : null;
  } catch {
    return null;
  }
}

// The engine's build-error line is fixed by formatPrerenderBuildError (issue #83).
const INELIGIBLE_LINE =
  /\[facilis\] prerender-ineligible: route "([^"]+)" is not prerender-eligible \(([^)]*)\)/;
const FRAMEWORK_LINE = /\[facilis\] (prerender:[^\n]*)/;

/** The graph already owns the localized reason labels (issue #84); reuse them. */
function localizeReasons(raw: string): string {
  return raw
    .split(";")
    .map((part) => {
      const reason = part.trim();
      if (reason.startsWith("private-api:")) {
        return t("projectGraph.prerender.privateApi", {
          route: reason.slice("private-api:".length).trim(),
        });
      }
      if (reason === "auth-guarded") return t("projectGraph.prerender.authGuarded");
      if (reason === "unknown-security") return t("projectGraph.prerender.unknownSecurity");
      if (reason === "dynamic-path") return t("projectGraph.prerender.dynamicPath");
      if (reason === "redirect") return t("projectGraph.prerender.redirect");
      return reason;
    })
    .filter((part) => part.length > 0)
    .join("; ");
}

export interface PrerenderBuildFailure {
  code: string | null;
  message: string;
}

/** A non-zero build exit becomes a framework-code message, never a raw stack. */
export function parseBuildFailure(tail: string, exitCode: number): PrerenderBuildFailure {
  const ineligible = INELIGIBLE_LINE.exec(tail);
  if (ineligible !== null) {
    return {
      code: "prerender-ineligible",
      message: t("prerender.error.ineligible", {
        route: ineligible[1] ?? "",
        reasons: localizeReasons(ineligible[2] ?? ""),
      }),
    };
  }
  const generic = FRAMEWORK_LINE.exec(tail);
  if (generic !== null) {
    return { code: null, message: t("prerender.error.framework", { detail: generic[1] ?? "" }) };
  }
  return { code: null, message: t("prerender.error.vm", { code: exitCode }) };
}

function parseStampRoutes(contents: string | null): readonly string[] {
  if (contents === null) return [];
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null) return [];
    const routes = (parsed as { routes?: unknown }).routes;
    return Array.isArray(routes) ? routes.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

let spawnSeq = 0;

/** One build at a time: a second trigger while running is a toast, not a second VM load. */
export function runPrerenderBuild(deps: PrerenderRunDeps, root: string): Promise<PrerenderRunState> {
  const current = getPrerenderRun();
  if (current !== null && (current.phase === "installing" || current.phase === "building")) {
    toast.error(t("prerender.error.busy"));
    return Promise.resolve(current);
  }
  return startBuild(deps, root);
}

async function startBuild(deps: PrerenderRunDeps, root: string): Promise<PrerenderRunState> {
  // npm leaves this lockfile behind after a successful install; without it the build
  // would die on a missing vite, so install first (the installing phase).
  const installed = await vfsRead(deps.bridge, root + "/node_modules/.package-lock.json");
  const needsInstall = installed === null;
  const command = needsInstall ? "npm install && npm run build" : "npm run build";
  const terminalId = deps.terminals.newShellTerminal({
    cwd: root,
    label: t("prerender.run.terminalLabel"),
    activate: false,
  });
  const execId = "prerender-build-" + ++spawnSeq;
  const startedAt = Date.now();
  let next: PrerenderRunState = {
    root,
    phase: needsInstall ? "installing" : "building",
    terminalId,
    startedAt,
    durationMs: null,
    routes: [],
    errorCode: null,
    error: null,
  };
  emit(next);
  deps.status?.(t(needsInstall ? "prerender.run.installing" : "prerender.run.building"));

  return new Promise<PrerenderRunState>((resolve) => {
    let tail = "";
    let settled = false;
    let offOut: () => void = () => {};
    let offExit: () => void = () => {};
    const finish = (patch: Partial<PrerenderRunState>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offOut();
      offExit();
      next = { ...next, ...patch };
      emit(next);
      resolve(next);
    };
    offOut = deps.bridge.on("proc-out", (m) => {
      if (m.execId !== execId || typeof m.chunk !== "string") return;
      deps.terminals.writeTo(terminalId, m.chunk);
      tail = (tail + m.chunk).slice(-4000);
      // npm install output never carries the vite banner; the build print does.
      if (next.phase === "installing" && /(?:rolldown-)?vite v/.test(tail)) {
        next = { ...next, phase: "building" };
        emit(next);
        deps.status?.(t("prerender.run.building"));
      }
    });
    offExit = deps.bridge.on("proc-exit", (m) => {
      if (m.execId !== execId) return;
      const code = Number(m.code);
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        void vfsRead(deps.bridge, root + "/.facilis/prerender.json").then((contents) => {
          const routes = parseStampRoutes(contents);
          finish({ phase: "ready", durationMs, routes });
          const summary = t("prerender.run.ready", {
            seconds: (durationMs / 1000).toFixed(1),
            count: routes.length,
          });
          deps.status?.(summary);
          toast.success(summary);
        });
        return;
      }
      const failure = parseBuildFailure(tail, code);
      finish({ phase: "failed", durationMs, errorCode: failure.code, error: failure.message });
      deps.status?.(failure.message);
      toast.error(failure.message);
    });
    const timer = setTimeout(() => {
      deps.bridge.post("proc-kill", { execId });
      deps.terminals.closeTerminal(terminalId);
      const message = t("prerender.error.timeout", { seconds: PRERENDER_BUILD_TIMEOUT_MS / 1000 });
      finish({ phase: "failed", durationMs: Date.now() - startedAt, error: message });
      deps.status?.(message);
      toast.error(message);
    }, PRERENDER_BUILD_TIMEOUT_MS);
    deps.bridge.post("proc-spawn", { execId, command: "sh", args: ["-c", command], cwd: root });
  });
}

/** The satellite action: build, then land the page's preview on the real HTML. */
export async function runPrerenderPreview(
  controller: IdeController,
  root: string,
  path: string,
): Promise<void> {
  const result = await runPrerenderBuild(
    {
      bridge: controller.bridge,
      terminals: controller.terminals,
      status: (text) => controller.statusMessage.show(text),
    },
    root,
  );
  if (result.phase === "ready") openPageInPreview(controller, path);
}
