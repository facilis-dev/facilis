// The Release Preview panel body (SPEC §11.3, D-086): the three git lenses, the code↔live
// card, the risk summary and the typed diff. Pure presentation over the load result and the
// view model; the panel owns git/network work and keeps this out of its own 300-line budget.

import Database from "~icons/lucide/database";
import RefreshCw from "~icons/lucide/refresh-cw";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rt, type ReleaseMessageKey } from "@/facilis/release-i18n";
import {
  WORKTREE_REF,
  type ReleaseLensId,
  type ReleaseLensPreset,
  type ReleasePreviewView,
} from "@/facilis/release-preview-model";
import type { ReleaseLensLoad, ReleaseLoadProblem } from "@/facilis/release-preview-load";
import type { GitRef, RiskClass } from "@/facilis/release-engine";
import { RiskBadge, Section } from "./ReleasePreviewChrome";
import { ReleaseDiffSections } from "./ReleasePreviewSections";

export type CodeLiveState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly drift: number }
  | { readonly status: "unreachable" };

export interface ReleasePreviewContentProps {
  readonly lens: ReleaseLensId;
  readonly presets: readonly ReleaseLensPreset[];
  readonly load: ReleaseLensLoad | null;
  readonly view: ReleasePreviewView | null;
  readonly loading: boolean;
  readonly codeLive: CodeLiveState;
  readonly linksDisabled: boolean;
  readonly onSelectLens: (lens: ReleaseLensId) => void;
  readonly onOpenSchema: () => void;
  readonly onOpenFile: (path: string) => void;
  readonly onRetry: () => void;
}

const LENS_LABELS: Record<ReleaseLensId, ReleaseMessageKey> = {
  working: "releasePreview.lens.working",
  remote: "releasePreview.lens.remote",
  tag: "releasePreview.lens.tag",
};

const LENS_HINTS: Record<ReleaseLensId, ReleaseMessageKey> = {
  working: "releasePreview.lens.working.hint",
  remote: "releasePreview.lens.remote.hint",
  tag: "releasePreview.lens.tag.hint",
};

const LENS_TEST_IDS: Record<ReleaseLensId, string> = {
  working: "release-lens-working",
  remote: "release-lens-remote",
  tag: "release-lens-tag",
};

const RISK_ORDER: readonly RiskClass[] = ["safe", "careful", "destructive", "breaking"];

export function ReleasePreviewContent({
  lens,
  presets,
  load,
  view,
  loading,
  codeLive,
  linksDisabled,
  onSelectLens,
  onOpenSchema,
  onOpenFile,
  onRetry,
}: ReleasePreviewContentProps) {
  return (
    <div data-testid="release-preview-content" className="space-y-2">
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={rt("releasePreview.title")}>
        {presets.map((preset) => {
          const unavailable = preset.reason !== null;
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={LENS_TEST_IDS[preset.id]}
              onClick={() => onSelectLens(preset.id)}
              // While a load is in flight the inventories are stale, so only the
              // already-known unavailability disables a lens.
              disabled={unavailable && !loading}
              aria-pressed={lens === preset.id}
              title={rt(LENS_HINTS[preset.id])}
              className={cn(
                "rounded-md border px-1 py-1 text-[10px] font-medium transition-colors",
                lens === preset.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
                unavailable && "opacity-50",
              )}
            >
              {rt(LENS_LABELS[preset.id])}
            </button>
          );
        })}
      </div>
      <CodeLiveCard state={codeLive} onOpenSchema={onOpenSchema} />
      {loading && load === null && (
        <p className="flex items-center gap-1.5 px-1 py-1 text-[11px] text-muted-foreground">
          <RefreshCw className="size-3.5 animate-spin" />
          {rt("releasePreview.loading")}
        </p>
      )}
      {load !== null && load.problem !== null && (
        <Problem problem={load.problem} problemRef={load.problemRef} onRetry={onRetry} />
      )}
      {view !== null && load?.problem === null && (
        <PreviewBody view={view} linksDisabled={linksDisabled} onOpenSchema={onOpenSchema} onOpenFile={onOpenFile} />
      )}
    </div>
  );
}

function PreviewBody({
  view,
  linksDisabled,
  onOpenSchema,
  onOpenFile,
}: {
  view: ReleasePreviewView;
  linksDisabled: boolean;
  onOpenSchema: () => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="px-1 font-mono text-[10px] text-muted-foreground">
        {rt("releasePreview.compare", {
          from: refLabel(view.from),
          to: refLabel(view.to),
        })}
      </p>
      <RiskSummary view={view} />
      {view.empty ? (
        <p className="px-1 py-1 text-[11px] text-muted-foreground">
          {rt("releasePreview.empty", { from: refLabel(view.from), to: refLabel(view.to) })}
        </p>
      ) : (
        <ReleaseDiffSections
          view={view}
          linksDisabled={linksDisabled}
          onOpenSchema={onOpenSchema}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}

function refLabel(ref: GitRef): string {
  return ref.ref === WORKTREE_REF ? rt("releasePreview.worktree") : ref.ref;
}

function RiskSummary({ view }: { view: ReleasePreviewView }) {
  const summary = view.summary;
  return (
    <Section title={rt("releasePreview.summary.title")}>
      <div className="flex flex-wrap gap-2">
        {RISK_ORDER.map((risk) => (
          <span key={risk} className="inline-flex items-center gap-1">
            <RiskBadge risk={risk} />
            <span className="font-mono text-[10px]">{view.counts[risk]}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {rt("releasePreview.summary.schema", {
          addedTables: summary.addedTables,
          droppedTables: summary.droppedTables,
          addedColumns: summary.addedColumns,
          droppedColumns: summary.droppedColumns,
          addedPolicies: summary.addedPolicies,
          droppedPolicies: summary.droppedPolicies,
        })}
      </p>
    </Section>
  );
}

function CodeLiveCard({
  state,
  onOpenSchema,
}: {
  state: CodeLiveState;
  onOpenSchema: () => void;
}) {
  return (
    <section className="rounded-md border bg-background/40 p-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <Database className="size-3.5 shrink-0 text-brand" />
        {rt("releasePreview.codeLive.title")}
      </div>
      {state.status === "loading" ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {rt("releasePreview.codeLive.loading")}
        </p>
      ) : state.status === "unreachable" ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {rt("releasePreview.codeLive.unreachable")}
        </p>
      ) : state.drift === 0 ? (
        <p className="mt-0.5 text-[10px] text-success">{rt("releasePreview.codeLive.synced")}</p>
      ) : (
        <button
          type="button"
          onClick={onOpenSchema}
          title={rt("releasePreview.codeLive.open")}
          className="mt-0.5 text-left text-[10px] text-warning hover:underline"
        >
          {rt("releasePreview.codeLive.drift", { count: state.drift })}
        </button>
      )}
    </section>
  );
}

function Problem({
  problem,
  problemRef,
  onRetry,
}: {
  problem: ReleaseLoadProblem;
  problemRef: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
      <p className="flex items-start gap-1.5 font-medium text-warning">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>{problemMessage(problem, problemRef)}</span>
      </p>
      {problem !== "no-project" && (
        <Button variant="ghost" size="xs" className="mt-1" onClick={onRetry}>
          {rt("releasePreview.retry")}
        </Button>
      )}
    </div>
  );
}

function problemMessage(problem: ReleaseLoadProblem, ref: string | null): string {
  switch (problem) {
    case "no-project":
      return rt("releasePreview.problem.no-project");
    case "no-head":
      return rt("releasePreview.unavailable.no-head");
    case "remote-missing":
      return rt("releasePreview.unavailable.remote-missing");
    case "tag-missing":
      return rt("releasePreview.unavailable.tag-missing");
    case "ref-missing":
      return rt("releasePreview.problem.ref-missing", { ref: ref ?? "" });
    case "snapshot-missing":
      return rt("releasePreview.problem.snapshot-missing", { ref: ref ?? "" });
    case "engine":
      return rt("releasePreview.problem.engine");
  }
}
