// Monaco's "Tab moves focus" mode (issue #210): a process-wide flag every editor in the IDE
// follows, flipped by the editor action `editor.action.toggleTabFocusMode`.
//
// The state has to live here because the flag cannot be read back. `TabFocus` is internal to
// monaco-editor 0.55.1 (editor/browser/config/tabFocus.js) and the editor option of the same
// name is OR-ed with it in codeEditorWidget.js, so `updateOptions({ tabFocusMode: false })`
// restores nothing and reading the option would lie once the global flag is on. The only
// writable path is the action itself, so this store records what the IDE's command did; the
// palette label and the status-bar announcement both read it.
import { t } from "@/i18n";

/** The editor action that flips the flag: global, so one call covers every Monaco instance. */
export const TAB_FOCUS_ACTION = "editor.action.toggleTabFocusMode";

/** What the command needs from the editor session; IdeController fits it as-is. */
export interface TabFocusActionHost {
  runEditorAction(id: string): void;
}

class TabFocusMode {
  private listeners = new Set<() => void>();
  private on = false;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** A primitive snapshot, so useSyncExternalStore compares by value and cannot loop. */
  getSnapshot = (): boolean => this.on;

  /** Record what the action just produced. Idempotent: no emit when nothing changed. */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const listener of this.listeners) listener();
  }
}

export const tabFocusMode = new TabFocusMode();

/** The palette row's label and the live region's text: the state is the message. */
export function tabFocusModeLabel(on: boolean): string {
  return t(on ? "a11y.tabFocus.on" : "a11y.tabFocus.off");
}

/**
 * Toggle the mode through Monaco's own action, then record it. Pressing Ctrl+M inside an
 * editor flips the flag without passing here — the flag has no change event the IDE can
 * subscribe to — so the store is the command's record, not a mirror of the editor.
 */
export function toggleTabFocusMode(host: TabFocusActionHost): void {
  const next = !tabFocusMode.getSnapshot();
  host.runEditorAction(TAB_FOCUS_ACTION);
  tabFocusMode.set(next);
}
