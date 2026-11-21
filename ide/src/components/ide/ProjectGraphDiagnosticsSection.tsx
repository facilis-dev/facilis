// The inspector's diagnostics section (issue #69): the messages behind a node's red/amber ring,
// on the existing floating details surface (epic rule 1 — no new panel). Each entry names its
// severity with a glyph AND a label, carries the analyzer's code and message verbatim (analyzer
// content, like the route description of D-129, not IDE chrome), and jumps to the source line.

import OctagonAlert from "~icons/lucide/octagon-alert";
import TriangleAlert from "~icons/lucide/triangle-alert";
import type { Diagnostic } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import { DetailsSection, EmptyNote, SourceJump } from "./ProjectGraphDetailsSection";

export function ProjectGraphDiagnosticsSection({
  diagnostics,
  onOpenFileAt,
}: {
  diagnostics: readonly Diagnostic[];
  onOpenFileAt: (file: string, line: number) => void;
}) {
  return (
    <DetailsSection title={t("projectGraph.diagnostics")}>
      {diagnostics.length === 0 ? (
        <EmptyNote message={t("projectGraph.diagnosticsNone")} />
      ) : (
        <ul data-testid="inspector-diagnostics" className="space-y-1.5">
          {diagnostics.map((entry, index) => (
            <li key={index} className="space-y-0.5">
              <span
                className={
                  "flex items-center gap-1 text-[10px] " +
                  (entry.severity === "error" ? "text-destructive" : "text-warning")
                }
              >
                {entry.severity === "error" ? (
                  <OctagonAlert className="size-3 shrink-0" />
                ) : (
                  <TriangleAlert className="size-3 shrink-0" />
                )}
                {t(("projectGraph.severity." + entry.severity) as MessageKey)}
                <span className="truncate font-mono text-muted-foreground">{entry.code}</span>
              </span>
              <p className="text-[10px] leading-snug">{entry.message}</p>
              {entry.source !== null && (
                <SourceJump source={entry.source} onOpenFileAt={onOpenFileAt} />
              )}
            </li>
          ))}
        </ul>
      )}
    </DetailsSection>
  );
}
