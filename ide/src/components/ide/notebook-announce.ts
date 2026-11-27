// What a screen reader hears while a cell runs (issue #221). The cell's outputs are
// visual only; without this the sole feedback is a status dot and a log toggle,
// neither of which is announced.
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { NotebookHandle } from "@/vv/controller";

export type RunPhase = "running" | "finished" | "failed" | "stopped";

/** The phase a kernel-status transition announces, or null when it says nothing. */
export function runPhase(previous: string, next: string, failed: boolean): RunPhase | null {
  if (previous === next) return null;
  if (next === "busy") return "running";
  if (previous !== "busy") return null;
  if (next === "dead" || next === "off") return "stopped";
  return failed ? "failed" : "finished";
}

/** The live-region sentence for a phase, naming the cell that ran. */
export function runAnnouncement(phase: RunPhase, cell: string): string {
  switch (phase) {
    case "running":
      return t("notebook.a11y.running", { cell });
    case "finished":
      return t("notebook.a11y.finished", { cell });
    case "failed":
      return t("notebook.a11y.failed", { cell });
    case "stopped":
      return t("notebook.a11y.stopped");
  }
}

/** The sentence to put in the notebook's role="status" region. */
export function useRunAnnouncement(handle: NotebookHandle): string {
  const { doc, session } = handle;
  const [text, setText] = useState("");
  const previousStatus = useRef(session.status);
  const lastRun = useRef<string | null>(null);

  useEffect(() => {
    if (session.running) lastRun.current = session.running.id;
    const id = lastRun.current;
    const cell = id ? doc.cell(id) : null;
    const outputs = cell?.outputs ?? [];
    const failed = outputs.some((output) => output.output_type === "error");
    const phase = runPhase(previousStatus.current, session.status, failed);
    previousStatus.current = session.status;
    if (!phase) return;
    if (!cell) {
      setText(runAnnouncement(phase, ""));
      return;
    }
    const label = t("notebook.cellLabel", {
      index: doc.indexOf(cell.id) + 1,
      total: doc.cells.length,
    });
    setText(runAnnouncement(phase, label));
  }, [doc, session, session.status]);

  return text;
}
