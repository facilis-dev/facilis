// The Python language service (Pyodide + jedi/black), brought up lazily the
// first time a .py file exists in the editor and not before: Pyodide is ~30 MB,
// so a session spent in .ts must not fetch it. Split out of controller.ts
// (D-019/D-042).

import type * as Monaco from "monaco-editor";
import { stateLabel } from "../../../vendor/vivari/packages/runtime/builtins/python-lsp.js";
import type { KernelBridge } from "./kernel";
import { languageFor } from "./editor-languages";

/** What the Python provider needs from the controller. */
export interface EditorPythonHost {
  bridge: KernelBridge;
  monaco(): typeof Monaco | null;
  /** Workspace root paths (jedi resolves imports relative to the owning root). */
  roots(): string[];
  openFileAt(path: string, line: number, column: number): void;
  /** Transient status-bar message. */
  status(text: string): void;
  /** The editor-status store's pythonService label. */
  setServiceState(label: string | null): void;
}

export class EditorPython {
  private readonly host: EditorPythonHost;
  private off: (() => void) | null = null;
  private state = "";

  constructor(host: EditorPythonHost) {
    this.host = host;
  }

  /** Bring the Python service up when a .py file first appears. */
  ensure(abs: string) {
    if (this.off) return;
    const monaco = this.host.monaco();
    if (!monaco || languageFor(abs) !== "python") return;
    this.off = () => {}; // claim the slot before the await
    void import("./python-language").then(({ registerPythonLanguage }) => {
      this.off = registerPythonLanguage(monaco, {
        request: async (root, req) => {
          const m = await this.host.bridge.request("vv-py-lsp", { root, req });
          return { ok: !!m.ok, result: m.result ?? null, error: String(m.error ?? "") };
        },
        // The workspace folder the file sits in — jedi resolves `import helper`
        // relative to it. Longest match, so a root nested inside another wins.
        rootFor: (path: string) => {
          let best = "";
          for (const rootPath of this.host.roots()) {
            const r = rootPath.replace(/\/+$/, "");
            if ((path === r || path.startsWith(r + "/")) && r.length > best.length) best = r;
          }
          return best || "/";
        },
        notify: (message: string) => this.host.status(message),
        openFileAt: (path: string, line: number, column: number) =>
          void this.host.openFileAt(path, line, column),
        setState: (state: string, detail?: string) => this.setState(state, detail),
      });
    });
    // The boot itself is reported by the worker over the bridge, not guessed at
    // here — the studio does not know how far along a 30 MB fetch is.
    this.host.bridge.on("py-lsp-state", (m: Record<string, unknown>) =>
      this.setState(String(m.state ?? ""), String(m.detail ?? "")),
    );
  }

  private setState(state: string, detail?: string) {
    const label = stateLabel(state, detail);
    if (label === this.state) return;
    this.state = label ?? "";
    this.host.setServiceState(label);
  }
}
