// The Release Preview's schema-plan and API diff sections (SPEC §11.3, D-158). Pure
// presentation over the view model — the panel owns git and network work. The other three
// sections (security, breaking, warnings) live in ReleasePreviewInsights.tsx to stay under
// 300 lines.
import { rt, type ReleaseMessageKey } from "@/facilis/release-i18n";
import { changedRouteLabel, routeLabel, type ReleasePreviewView } from "@/facilis/release-preview-model";
import type { ApiRouteRef, SchemaPlanProblem, SchemaPlanProblemCode } from "@/facilis/release-engine";
import { Empty, RiskBadge, Section } from "./ReleasePreviewChrome";
import {
  BreakingSection,
  SecuritySection,
  WarningSection,
} from "./ReleasePreviewInsights";

export interface ReleaseDiffProps {
  readonly view: ReleasePreviewView;
  readonly linksDisabled: boolean;
  readonly onOpenSchema: () => void;
  readonly onOpenFile: (path: string) => void;
}

export function ReleaseDiffSections({
  view,
  linksDisabled,
  onOpenSchema,
  onOpenFile,
}: ReleaseDiffProps) {
  return (
    <div className="space-y-2">
      <PlanSection view={view} linksDisabled={linksDisabled} onOpenSchema={onOpenSchema} />
      <ApiSection view={view} linksDisabled={linksDisabled} onOpenFile={onOpenFile} />
      <SecuritySection view={view} />
      <BreakingSection view={view} />
      <WarningSection view={view} />
    </div>
  );
}

const PROBLEM_LABELS: Record<SchemaPlanProblemCode, ReleaseMessageKey> = {
  unsupported_declaration: "releasePreview.planProblem.unsupported_declaration",
  unsupported_change: "releasePreview.planProblem.unsupported_change",
  policy_unsafe: "releasePreview.planProblem.policy_unsafe",
};

/** Machine code through t(), plus the declaration's identifiers (never prose). */
function problemMessage(problem: SchemaPlanProblem): string {
  const location =
    problem.table === undefined
      ? ""
      : " (" + problem.table + (problem.column === undefined ? "" : "." + problem.column) + ")";
  return rt(PROBLEM_LABELS[problem.code], { construct: problem.construct ?? "" }) + location;
}

/**
 * The generated tag -> tag plan (D-158/D-159). A plan with problems fails closed: the
 * panel renders the machine codes and no SQL, because no SQL ships until they are resolved.
 */
function PlanSection({
  view,
  linksDisabled,
  onOpenSchema,
}: {
  view: ReleasePreviewView;
  linksDisabled: boolean;
  onOpenSchema: () => void;
}) {
  const plan = view.plan;
  if (plan.problems.length > 0) {
    return (
      <Section title={rt("releasePreview.plan.title")} count={plan.problems.length}>
        <div
          data-testid="release-plan-failed"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-1.5"
        >
          <p className="text-[11px] font-medium text-destructive">
            {rt("releasePreview.plan.failedClosed")}
          </p>
          <ul className="mt-1 space-y-0.5">
            {plan.problems.map((problem, index) => (
              <li
                key={problem.code + ":" + index}
                data-testid="release-plan-problem"
                className="break-words font-mono text-[10px] text-destructive"
              >
                {problemMessage(problem)}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    );
  }
  return (
    <Section title={rt("releasePreview.plan.title")} count={plan.batches.length}>
      {plan.batches.length === 0 ? (
        <Empty text={rt("releasePreview.plan.empty")} />
      ) : (
        <>
          <ul className="space-y-1">
            {plan.batches.map((batch) => (
              <li
                key={batch.id}
                data-testid="release-batch"
                className="rounded-md border bg-background/40 p-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <RiskBadge risk={batch.risk} />
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {batch.id}
                  </span>
                </div>
                {batch.requires !== undefined && batch.requires.length > 0 && (
                  <p className="mt-0.5 break-words font-mono text-[10px] text-warning">
                    {rt("releasePreview.plan.requires", { requirements: batch.requires.join(", ") })}
                  </p>
                )}
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1.5 font-mono text-[10px] text-foreground/80">
                  {batch.sql}
                </pre>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={linksDisabled}
            onClick={onOpenSchema}
            className="px-1 text-[10px] text-muted-foreground hover:text-primary hover:underline disabled:opacity-60"
          >
            {rt("releasePreview.codeLive.open")}
          </button>
        </>
      )}
    </Section>
  );
}

function ApiSection({
  view,
  linksDisabled,
  onOpenFile,
}: {
  view: ReleasePreviewView;
  linksDisabled: boolean;
  onOpenFile: (path: string) => void;
}) {
  const { added, removed, changed } = view.api;
  const total = added.length + removed.length + changed.length;
  return (
    <Section title={rt("releasePreview.api.title")} count={total}>
      {total === 0 ? (
        <Empty text={rt("releasePreview.api.empty")} />
      ) : (
        <>
          <RouteGroup
            label={rt("releasePreview.api.added")}
            routes={added}
            linksDisabled={linksDisabled}
            onOpenFile={onOpenFile}
          />
          <RouteGroup
            label={rt("releasePreview.api.removed")}
            routes={removed}
            linksDisabled={linksDisabled}
            onOpenFile={onOpenFile}
          />
          {changed.length > 0 && <ChangedRoutes view={view} />}
        </>
      )}
    </Section>
  );
}

function ChangedRoutes({ view }: { view: ReleasePreviewView }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground">
        {rt("releasePreview.api.changed")}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {view.api.changed.map((change) => (
          <li key={routeLabel(change.after)} className="font-mono text-[10px]">
            <span className="text-muted-foreground">{changedRouteLabel(change).before}</span>
            <span className="text-muted-foreground"> → </span>
            <span>{changedRouteLabel(change).after}</span>
            <span className="ml-1 text-muted-foreground">
              ({rt("releasePreview.api.fields", { fields: change.fields.join(", ") })})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteGroup({
  label,
  routes,
  linksDisabled,
  onOpenFile,
}: {
  label: string;
  routes: readonly ApiRouteRef[];
  linksDisabled: boolean;
  onOpenFile: (path: string) => void;
}) {
  if (routes.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <ul className="mt-0.5 flex flex-wrap gap-1">
        {routes.map((route) => {
          const sourceFile = route.sourceFile;
          return (
            <li key={routeLabel(route)}>
              <button
                type="button"
                disabled={linksDisabled || sourceFile === undefined}
                title={
                  sourceFile === undefined
                    ? undefined
                    : rt("releasePreview.open", { path: sourceFile })
                }
                onClick={() => {
                  if (sourceFile !== undefined) onOpenFile(sourceFile);
                }}
                className="rounded border px-1 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-60"
              >
                {routeLabel(route)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
