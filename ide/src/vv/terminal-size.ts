// The size half of the shell terminal kernel protocol: the xterm is the source of
// truth for cols/rows, so the shell starts at the grid it has and follows every later
// fit. Split out of terminal-session.ts, which is close to the 300-line limit; the
// "why" lives here so the call sites stay one line each.

import type { Terminal } from "@xterm/xterm";
import type { KernelBridge } from "./kernel";

/** The xterm's grid right now, posted with `term-open` so the shell starts at it
 *  rather than a default 80x24. */
export function terminalSize(term: Terminal): { cols: number; rows: number } {
  return { cols: term.cols, rows: term.rows };
}

/** Post `term-resize` on every fit() that changes the grid. The shell and whatever
 *  runs under it then see new columns/rows and a SIGWINCH, so a TUI redraws to fit.
 *  Before the shell has started there is no pid to resize; the size rides on
 *  `term-open` instead, which is why the caller passes its `started` flag. */
export function wireTerminalResize(
  term: Terminal,
  id: string,
  bridge: KernelBridge,
  started: () => boolean,
): void {
  term.onResize(({ cols, rows }) => {
    if (started()) bridge.post("term-resize", { terminalId: id, cols, rows });
  });
}
