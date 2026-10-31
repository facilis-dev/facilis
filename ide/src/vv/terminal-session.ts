// The terminal runtime: the Console tab and the interactive shells. Owns the
// xterm entries, their Process Worker lifecycle and the kernel protocol; the
// controller keeps the panel/tab snapshot (via TerminalHost) and the run phases.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { KernelBridge } from "./kernel";
import { createXterm, termThemeFor, type UiTheme } from "./terminal-theme";

const ESC = "\x1b[";

export interface TerminalMeta {
  id: string;
  label: string;
  kind: "console" | "shell";
  alive: boolean;
}

/** One xterm tab: its terminal, fit addon and Process Worker state. */
export interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  kind: "console" | "shell";
  label: string;
  demo: string | null;
  cwd: string | null;
  run: string | null; // explicit VV_RUN (created/opened project run shells)
  pid: number | null;
  alive: boolean;
  started: boolean;
  opened: boolean;
  openedAt: number;
  pendingInput: string[];
}

/** A snapshot patch owned by the terminal panel. */
export interface TerminalPatch {
  terminals?: TerminalMeta[];
  activeTermId?: string | null;
  panelTab?: "console" | "terminal" | "ports";
  panelCollapsed?: boolean;
}

/** What the terminal runtime needs from the controller. */
export interface TerminalHost {
  patch(patch: TerminalPatch): void;
  activeTermId(): string | null;
  panelTab(): "console" | "terminal" | "ports";
  activeFolderRoot(): string | null;
  theme(): UiTheme;
}

export interface ShellTerminalOptions {
  defer?: boolean;
  demo?: string | null;
  label?: string | null;
  activate?: boolean;
  cwd?: string | null;
  run?: string | null;
}

export class TerminalSession {
  private readonly bridge: KernelBridge;
  private readonly host: TerminalHost;
  private entries = new Map<string, TermEntry>();
  private order: string[] = [];
  private seq = 0;

  constructor(bridge: KernelBridge, host: TerminalHost) {
    this.bridge = bridge;
    this.host = host;
    this.newConsole();
  }

  /** The entry for a tab, for the controller's mount/fit/clear plumbing. */
  entry(id: string): TermEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  consoleWrite(chunk: string) {
    this.entries.get("console")?.term.write(chunk);
  }
  consoleLine(text: string, color?: string) {
    this.entries
      .get("console")
      ?.term.write((color ? `${ESC}${color}m${text}${ESC}0m` : text) + "\r\n");
  }

  /** The Console tab: kernel stdout/stderr and our own narration. */
  newConsole() {
    const { term, fit } = createXterm(this.host.theme());
    this.entries.set("console", {
      term,
      fit,
      kind: "console",
      label: "Console",
      demo: null,
      cwd: null,
      run: null,
      pid: null,
      alive: true,
      started: true,
      opened: false,
      openedAt: 0,
      pendingInput: [],
    });
    this.order.push("console");
  }

  // Create a shell terminal tab (defer = spawn the Process Worker lazily, off the
  // cold-boot burst; explicit New Terminal / Run start it right away). `activate`
  // = switch the panel to this terminal (false for the background boot shell).
  // `cwd`/`run` = start the shell in a project dir and (optionally) auto-run its
  // dev command (created/opened projects).
  newShellTerminal({
    defer = false,
    demo = null,
    label = null,
    activate = true,
    cwd = null,
    run = null,
  }: {
    defer?: boolean;
    demo?: string | null;
    label?: string | null;
    activate?: boolean;
    cwd?: string | null;
    run?: string | null;
  } = {}): string {
    const id = "sh" + ++this.seq;
    const { term, fit } = createXterm(this.host.theme());
    const entry: TermEntry = {
      term,
      fit,
      kind: "shell",
      label: label || "sh " + this.seq,
      demo,
      cwd,
      run,
      pid: null,
      alive: true,
      started: false,
      opened: false,
      openedAt: 0,
      pendingInput: [],
    };
    this.entries.set(id, entry);
    this.order.push(id);
    term.onData((data) => {
      if (!entry.started) {
        this.startShell(id);
        entry.pendingInput.push(data);
        return;
      }
      this.bridge.post("term-input", { terminalId: id, chunk: data });
    });
    // Adopt as the active shell if none is selected yet (keeps the Terminal tab
    // pointing at a real shell even for the background boot terminal).
    if (this.host.activeTermId() === null) this.host.patch({ activeTermId: id });
    this.sync();
    if (activate) this.switchTerminal(id);
    if (defer) {
      if (typeof requestIdleCallback === "function")
        requestIdleCallback(() => this.startShell(id), { timeout: 2500 });
      else setTimeout(() => this.startShell(id), 1500);
    } else {
      this.startShell(id);
    }
    return id;
  }

  /** Spawn the Process Worker for a shell launched with `defer`. */
  private startShell(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.kind !== "shell" || entry.started) return;
    entry.started = true;
    entry.openedAt = performance.now();
    const cwd = entry.cwd ?? this.host.activeFolderRoot() ?? undefined;
    this.bridge.post("term-open", {
      terminalId: id,
      demo: entry.demo,
      cwd,
      run: entry.run ?? undefined,
    });
  }

  switchTerminal(id: string) {
    const t0 = this.entries.get(id);
    if (!t0) return;
    // The console has its own panel tab; shells live under the Terminal tab.
    const patch: TerminalPatch =
      t0.kind === "console"
        ? { panelTab: "console", panelCollapsed: false }
        : { panelTab: "terminal", activeTermId: id, panelCollapsed: false };
    this.host.patch(patch);
    // Fit + focus once React has flipped visibility.
    requestAnimationFrame(() => {
      const t = this.entries.get(id);
      if (!t) return;
      try {
        t.fit.fit();
      } catch {
        /* not visible */
      }
      t.term.focus();
    });
  }

  setPanelTab(tab: "console" | "terminal" | "ports") {
    this.host.patch({ panelTab: tab, panelCollapsed: false });
    if (tab === "console" || tab === "terminal") {
      const id = tab === "console" ? "console" : this.host.activeTermId();
      requestAnimationFrame(() => {
        if (!id) return;
        const t = this.entries.get(id);
        if (!t) return;
        try {
          t.fit.fit();
        } catch {
          /* hidden */
        }
        t.term.focus();
      });
    }
  }

  /** Close a shell tab. Returns the shell to activate next; null when none is
   *  left (the controller then points the panel back at the Console); undefined
   *  when there is nothing to close (unknown id or the Console itself). */
  /** Close a shell tab, switching to the next shell (or the Console) if it was
   *  the active one. The Console itself cannot be closed. */
  closeTerminal(id: string) {
    const t = this.entries.get(id);
    if (!t || t.kind === "console") return;
    this.bridge.post("term-close", { terminalId: id });
    t.term.dispose();
    this.entries.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.host.activeTermId() === id) {
      const nextShell =
        [...this.order].reverse().find((x) => this.entries.get(x)?.kind === "shell") ?? null;
      if (nextShell) this.switchTerminal(nextShell);
      else this.host.patch({ activeTermId: null, panelTab: "console" });
    }
    this.sync();
  }

  // ── kernel events ───────────────────────────────────────────────────────
  /** `term-ready`: remember the pid and replay input typed before it spawned. */
  onProcessReady(id: string, pid: number, deliver: (terminalId: string, chunk: string) => void) {
    const t = this.entries.get(id);
    if (!t) return;
    t.pid = pid;
    for (const chunk of t.pendingInput) deliver(id, chunk);
    t.pendingInput.length = 0;
  }

  /** `term-out`: write output; returns the boot time on the first chunk (ms),
   *  so the controller can log how long the Process Worker took. */
  writeTo(id: string, chunk: string): number {
    const t = this.entries.get(id);
    if (!t) return 0;
    const bootMs = t.openedAt ? performance.now() - t.openedAt : 0;
    if (t.openedAt) t.openedAt = 0;
    t.term.write(chunk);
    return bootMs;
  }

  /** `term-exit`: write the exit line and mark the shell dead. Returns the demo
   *  id the shell belonged to, so the controller can drop its server entry. */
  markExited(id: string, code: number): { demo: string | null } | null {
    const t = this.entries.get(id);
    if (!t) return null;
    t.term.write(`\r\n\x1b[90m[process exited — code ${code}]\x1b[0m\r\n`);
    t.alive = false;
    return { demo: t.demo };
  }

  /** Re-publish the tab strip after entries/labels/liveness changed. */
  sync() {
    this.host.patch({
      terminals: this.order.map((id) => {
        const t = this.entries.get(id)!;
        return { id, label: t.label, kind: t.kind, alive: t.alive };
      }),
    });
  }

  /** Switch every live terminal to the resolved theme. */
  applyTheme(theme: UiTheme) {
    for (const { term } of this.entries.values()) term.options.theme = termThemeFor(theme);
  }
}
