// The D-198 boot gate: a project whose @facilis.dev/* exact pins are below the built-in
// per-package minimums must not silently boot.
//
// The controller's runProject calls frameworkRunGate BEFORE the dev server starts. On a
// below-minimum pin set the gate refuses to boot and owns a blocking prompt (an external
// store FrameworkGateDialog reads, like device-health). The explicit update action applies
// the framework-minimum recipe through the D-070 upgrade engine — plan, re-check, write,
// npm-install postflight, marker last — and only then boots. A failure leaves the project
// unbooted with the engine's rollback semantics; a decline refuses with a clear message.
// file:/workspace: pins (dev-local, D-196) and projects without framework deps pass.

import { toast } from "sonner";
import { environmentVersion, frameworkPackageMinimums } from "@/deploy/current";
import { t } from "@/i18n";
import type { KernelMessage } from "@/vv/kernel";
import { readAppManifest } from "./app-status";
import { checkFrameworkPins, parsePackageJson, type FrameworkPin } from "./package-minimums";
import { FRAMEWORK_MINIMUM_TARGET, UPDATE_RECIPES } from "./update-recipes";
import { applyUpgrade, UpgradeError, type UpgradeIo } from "./upgrade/apply";
import { planUpgrade, projectPath } from "./upgrade/plan";

/** The slice of the kernel bridge the gate needs; structural so tests can fake it. */
export interface GateBridge {
  request(type: string, extra?: Record<string, unknown>): Promise<KernelMessage>;
  post(type: string, extra?: Record<string, unknown>): void;
  on(type: string, handler: (m: KernelMessage) => void): () => void;
}

export interface FrameworkGateDeps {
  bridge: GateBridge;
  /** Boot the project (the controller's run body) once the pins satisfy the minimums. */
  start: () => void;
}

export interface FrameworkGateState {
  root: string;
  below: FrameworkPin[];
  phase: "prompt" | "applying" | "error";
  /** Localized failure detail when phase is "error". */
  error: string | null;
}

let state: FrameworkGateState | null = null;
let active: FrameworkGateDeps | null = null;
const listeners = new Set<() => void>();

export function subscribeFrameworkGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFrameworkGate(): FrameworkGateState | null {
  return state;
}

function emit(next: FrameworkGateState | null): void {
  state = next;
  for (const listener of listeners) listener();
}

/** VFS read for the engine: null when absent or unreadable, never a throw. */
function vfsRead(bridge: GateBridge): (absolutePath: string) => Promise<string | null> {
  return async (absolutePath) => {
    try {
      const m = await bridge.request("vv-read", { path: absolutePath });
      return m.ok === true && typeof m.contents === "string" ? m.contents : null;
    } catch {
      return null;
    }
  };
}

let installSeq = 0;

/**
 * The npm-install postflight, through the kernel's generic spawn channel: the same
 * vendored npm the run shell uses, without opening a terminal tab. Resolves on exit 0;
 * otherwise the tail of the output names the failure for the dialog.
 */
function installDependencies(bridge: GateBridge, root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const execId = "framework-update-" + ++installSeq;
    let tail = "";
    const offOut = bridge.on("proc-out", (m) => {
      if (m.execId === execId && typeof m.chunk === "string") tail = (tail + m.chunk).slice(-2000);
    });
    const offExit = bridge.on("proc-exit", (m) => {
      if (m.execId !== execId) return;
      offOut();
      offExit();
      if (Number(m.code) === 0) resolve();
      else reject(new Error("npm install exited " + String(m.code) + (tail ? ": " + tail : "")));
    });
    bridge.post("proc-spawn", { execId, command: "npm", args: ["install"], cwd: root });
  });
}

/**
 * The boot gate itself: read the project's package.json, check its pins, and either boot
 * or raise the blocking prompt. A missing/invalid package.json passes — admission handles
 * invalid projects elsewhere.
 */
export async function frameworkRunGate(
  bridge: GateBridge,
  root: string,
  start: () => void,
): Promise<void> {
  const deps: FrameworkGateDeps = { bridge, start };
  const read = vfsRead(bridge);
  const pkg = parsePackageJson(await read(projectPath(root, "package.json")));
  const pins = checkFrameworkPins(pkg, frameworkPackageMinimums);
  if (pins.status === "ok") {
    deps.start();
    return;
  }
  active = deps;
  emit({ root, below: pins.below, phase: "prompt", error: null });
}

/** The prompt's explicit update action: apply the recipe, install, then boot. */
export async function acceptFrameworkUpdate(): Promise<void> {
  const current = state;
  const deps = active;
  if (current === null || deps === null || current.phase === "applying") return;
  emit({ ...current, phase: "applying", error: null });
  const read = vfsRead(deps.bridge);
  const io: UpgradeIo = {
    read,
    write: async (path, contents) => {
      const m = await deps.bridge.request("vv-write", { path, contents });
      if (m.ok !== true) throw new Error("vv-write failed: " + path);
    },
    remove: async (path) => {
      const m = await deps.bridge.request("vv-rm", { path });
      if (m.ok !== true) throw new Error("vv-rm failed: " + path);
    },
  };
  try {
    const manifest = await readAppManifest(async (path) => (await read(path)) ?? "", current.root);
    const plan = await planUpgrade({
      root: current.root,
      projectVersion: manifest?.environmentVersion ?? null,
      currentVersion: environmentVersion,
      recipes: UPDATE_RECIPES,
      requiredTargets: FRAMEWORK_MINIMUM_TARGET === null ? [] : [FRAMEWORK_MINIMUM_TARGET],
      read,
    });
    // The marker keeps the project's environment version: this step upgrades framework
    // pins, not the environment. A marker-less project adopts this build's version.
    await applyUpgrade({
      root: current.root,
      changes: plan.changes,
      targetVersion: manifest?.environmentVersion ?? environmentVersion,
      io,
      postflight: () => installDependencies(deps.bridge, current.root),
    });
  } catch (error) {
    // UpgradeError semantics: the engine rolled back (or could not); either way the
    // project stays unbooted and the dialog says which.
    const key =
      error instanceof UpgradeError
        ? error.rolledBack
          ? "updates.framework.failedRolledBack"
          : "updates.framework.failedNoRollback"
        : "updates.framework.failed";
    emit({ ...current, phase: "error", error: t(key) });
    return;
  }
  emit(null);
  active = null;
  deps.start();
}

/** Decline the update: refuse to boot, with a message that says how to proceed. */
export function declineFrameworkUpdate(): void {
  if (state === null) return;
  emit(null);
  active = null;
  toast.error(t("updates.framework.declined"));
}

/** Close the error state without booting (the project stays refused until Run again). */
export function dismissFrameworkGate(): void {
  emit(null);
  active = null;
}
