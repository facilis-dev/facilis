// The notebook's toolbar: run/interrupt/restart commands and the kernel status
// disclosure. Split out of NotebookView.tsx (issue #221) because the view is frozen by
// the file-length ratchet and the keyboard work needed room there.
import { useState } from "react";
import Play from "~icons/lucide/play";
import Square from "~icons/lucide/square";
import RotateCcw from "~icons/lucide/rotate-ccw";
import FastForward from "~icons/lucide/fast-forward";
import Eraser from "~icons/lucide/eraser";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { NotebookHandle } from "@/vv/controller";
import { stripAnsi } from "@/vv/notebook/render.js";

const STATUS_LABEL: Record<string, string> = {
  off: "no kernel",
  starting: "starting…",
  idle: "idle",
  busy: "busy",
  dead: "kernel exited",
};

export function NotebookToolbar({ handle }: { handle: NotebookHandle }) {
  "use no memo"; // the kernel log is an array the session pushes into — see NotebookView's header
  const { doc, session } = handle;
  const [logOpen, setLogOpen] = useState(false);
  const status = session.status;
  const busy = status === "busy";

  return (
    <div className="shrink-0 border-b">
      <div className="flex h-9 items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handle.runSelected()}
          title="Run cell (⇧↵)"
        >
          <Play className="size-3.5" /> Run
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handle.runAll()}
          title="Run every cell, top to bottom"
        >
          <FastForward className="size-3.5" /> Run all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!busy}
          onClick={() => handle.interrupt()}
          // Disabled rather than hidden when idle, because "why is this greyed
          // out" is a better question than the one an idle interrupt would raise:
          // at an idle prompt the signal kills the interpreter instead of raising
          // KeyboardInterrupt, so it must not be sent.
          title={busy ? "Interrupt the running cell (SIGINT)" : "Nothing is running"}
        >
          <Square className="size-3.5" /> Interrupt
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handle.restart()}
          title="Throw the interpreter away and start a new one"
        >
          <RotateCcw className="size-3.5" /> Restart
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => doc.clearAllOutputs()}
          title="Clear every cell's output"
        >
          <Eraser className="size-3.5" /> Clear
        </Button>

        <div className="flex-1" />

        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          onClick={() => setLogOpen((v) => !v)}
          title="What the kernel process printed outside the notebook protocol"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              status === "idle" && "bg-success",
              status === "busy" && "bg-warning",
              status === "starting" && "bg-warning/60",
              status === "dead" && "bg-destructive",
              status === "off" && "bg-muted-foreground/50",
            )}
          />
          <span>
            Python{session.info ? ` ${session.info.python}` : ""} — {STATUS_LABEL[status] ?? status}
          </span>
        </button>
      </div>
      {logOpen && (
        <div className="max-h-40 overflow-y-auto border-t bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {session.log.length === 0 ? (
            <span>Nothing yet. Pyodide's loader and any kernel-level error appear here.</span>
          ) : (
            session.log.map((line, i) => <div key={i}>{stripAnsi(line)}</div>)
          )}
        </div>
      )}
    </div>
  );
}
