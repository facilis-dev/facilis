// The Release Preview's prerender-surface section (D-202, issue #84): the per-page
// render-mode flags and their diff across the lens's two refs. Pure presentation over the
// pure diff model; rendered even when the schema/API diff is empty, because a release can
// change only the prerender allowlist.

import { rt } from "@/facilis/release-i18n";
import type {
  PageRenderState,
  PrerenderSurfaceDiff,
  PrerenderSurfaceRow,
} from "@/facilis/release-prerender";
import { cn } from "@/lib/utils";
import { Empty, Section } from "./ReleasePreviewChrome";

function ModeChip({ state }: { state: PageRenderState | null }) {
  if (state === null) {
    return (
      <span className="shrink-0 text-[9px] text-muted-foreground">
        {rt("releasePreview.prerender.absent")}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1 text-[9px]",
        state.mode === "prerender"
          ? "border-success/40 bg-success/10 text-success"
          : "border-border text-muted-foreground",
      )}
    >
      {rt(
        state.mode === "prerender"
          ? "releasePreview.prerender.mode.prerender"
          : "releasePreview.prerender.mode.client",
      )}
    </span>
  );
}

function blocked(state: PageRenderState | null): boolean {
  return state !== null && state.declared && !state.eligible;
}

function Row({ row }: { row: PrerenderSurfaceRow }) {
  const changed =
    row.before === null ||
    row.after === null ||
    row.before.mode !== row.after.mode ||
    row.before.declared !== row.after.declared ||
    row.before.eligible !== row.after.eligible;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-1 rounded border px-1.5 py-0.5",
        changed ? "border-warning/40" : "border-border/60",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{row.path}</span>
      <ModeChip state={row.before} />
      <span className="text-[9px] text-muted-foreground">→</span>
      <ModeChip state={row.after} />
      {(blocked(row.before) || blocked(row.after)) && (
        <span className="text-[9px] text-warning">{rt("releasePreview.prerender.blocked")}</span>
      )}
    </li>
  );
}

export function ReleasePreviewPrerender({ diff }: { diff: PrerenderSurfaceDiff | null }) {
  const changes = diff === null ? 0 : diff.added.length + diff.removed.length + diff.changed.length;
  const summary =
    diff === null
      ? []
      : [
          diff.added.length > 0
            ? rt("releasePreview.prerender.added", { count: diff.added.length })
            : null,
          diff.removed.length > 0
            ? rt("releasePreview.prerender.removed", { count: diff.removed.length })
            : null,
          diff.changed.length > 0
            ? rt("releasePreview.prerender.changed", { count: diff.changed.length })
            : null,
        ].filter((part): part is string => part !== null);
  return (
    <div data-testid="release-prerender-section">
      <Section title={rt("releasePreview.prerender.title")} count={changes}>
        {diff === null ? (
          <Empty text={rt("releasePreview.prerender.unavailable")} />
        ) : diff.rows.length === 0 ? (
          <Empty text={rt("releasePreview.prerender.empty")} />
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground">
              {rt("releasePreview.prerender.hint")}
            </p>
            {summary.length > 0 && <p className="text-[10px]">{summary.join(" · ")}</p>}
            <ul className="space-y-0.5">
              {diff.rows.map((row) => (
                <Row key={row.path} row={row} />
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
