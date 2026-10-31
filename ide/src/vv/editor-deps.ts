// Dependency type declarations (node_modules **/*.d.ts + package.json) fed to
// the TypeScript language service as extra libs, so imports of installed
// packages resolve with real types. The bulk VFS scan happens in the kernel
// worker; this module only harvests and registers. Split out of controller.ts
// (D-019/D-042).

import type * as Monaco from "monaco-editor";
import type { KernelBridge } from "./kernel";
import { baseName } from "./path-utils";

/** What the harvester needs from the controller. */
export interface EditorDepsHost {
  bridge: KernelBridge;
  monaco(): typeof Monaco | null;
  /** Every open workspace root. */
  roots(): string[];
  consoleLine(text: string, color?: string): void;
  /** Register the libs (and restart the TS worker so they are visible). */
  applyExtraLibs(libs: { filePath: string; content: string }[]): void;
}

export class EditorDeps {
  private readonly host: EditorDepsHost;
  private libsByRoot = new Map<string, Map<string, string>>(); // root -> (uri -> content)
  private sigs = new Map<string, string>(); // root -> last node_modules fingerprint
  private warnedNoNodeModules = new Set<string>(); // roots already noted as lacking deps
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0; // supersede in-flight refreshes

  constructor(host: EditorDepsHost) {
    this.host = host;
  }

  /** Debounced: re-runs after installs (every fs change re-indexes a folder). */
  schedule() {
    if (!this.host.monaco()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 1200);
  }

  private async load() {
    const monaco = this.host.monaco();
    if (!monaco) return;
    const seq = ++this.seq;
    const roots = new Set(this.host.roots());
    let changed = false;
    // Forget libs for roots that are no longer open.
    for (const r of Array.from(this.libsByRoot.keys())) {
      if (!roots.has(r)) {
        this.libsByRoot.delete(r);
        this.sigs.delete(r);
        changed = true;
      }
    }
    // Harvest each root, passing its last node_modules fingerprint so an unchanged
    // tree short-circuits in the worker (no file reads).
    for (const root of roots) {
      const res = await this.host.bridge.request("vv-collect-dts", {
        root,
        sig: this.sigs.get(root) ?? "",
      });
      if (seq !== this.seq) return; // a newer refresh superseded us
      if (!res.ok) continue;
      const sig = typeof res.sig === "string" ? res.sig : "";
      this.sigs.set(root, sig);
      // sig === "" ⟺ no node_modules on disk yet. Nudge the user once (types come
      // from installed packages — nothing to resolve until deps are installed).
      if (sig === "") {
        if (!this.warnedNoNodeModules.has(root)) {
          this.warnedNoNodeModules.add(root);
          this.host.consoleLine(
            `[intellisense] ${baseName(root)}: no node_modules yet — run \`npm install\` for dependency types`,
            "33",
          );
        }
        continue;
      }
      this.warnedNoNodeModules.delete(root);
      if (res.unchanged) continue;
      const map = new Map<string, string>();
      for (const f of (res.files as { path: string; content: string }[]) ?? []) {
        // toString(TRUE) = skip encoding. Monaco's Uri.toString() percent-encodes
        // '@' → '%40', but TS's module resolver looks up '@types/…'/'@scope/…'
        // with a LITERAL '@'. Encoded keys never match the resolver's queries, so
        // every @types-backed import (react, react-dom, jsx-runtime) fails. Keep
        // '@' literal so extra-lib keys line up with what the worker asks for.
        map.set(monaco.Uri.file(f.path).toString(true), f.content);
      }
      this.libsByRoot.set(root, map);
      changed = true;
      this.host.consoleLine(
        `[intellisense] ${baseName(root)}: loaded ${map.size} dependency type file(s)${res.truncated ? " (capped)" : ""}`,
        "36",
      );
    }
    if (!changed) return;
    const libs: { filePath: string; content: string }[] = [];
    for (const map of this.libsByRoot.values()) {
      for (const [filePath, content] of map) libs.push({ filePath, content });
    }
    this.host.applyExtraLibs(libs);
  }
}
