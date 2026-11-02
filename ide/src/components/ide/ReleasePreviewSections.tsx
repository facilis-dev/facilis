// The Release Preview's statement and API diff sections (SPEC §11.3). Pure presentation
// over the view model — the panel owns git and network work. The other three sections
// (security, breaking, warnings) live in ReleasePreviewInsights.tsx to stay under 300 lines.
import { rt } from "@/facilis/release-i18n";
import { changedRouteLabel, routeLabel, type ReleasePreviewView } from "@/facilis/release-preview-model";
import type { ApiRouteRef } from "@/facilis/release-engine";
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
      <StatementSection view={view} linksDisabled={linksDisabled} onOpenSchema={onOpenSchema} />
      <ApiSection view={view} linksDisabled={linksDisabled} onOpenFile={onOpenFile} />
      <SecuritySection view={view} />
      <BreakingSection view={view} />
      <WarningSection view={view} />
    </div>
  );
}

function StatementSection({
  view,
  linksDisabled,
  onOpenSchema,
}: {
  view: ReleasePreviewView;
  linksDisabled: boolean;
  onOpenSchema: () => void;
}) {
  return (
    <Section title={rt("releasePreview.statements.title")} count={view.statements.length}>
      {view.statements.length === 0 ? (
        <Empty text={rt("releasePreview.statements.empty")} />
      ) : (
        <ul className="space-y-1">
          {view.statements.map((statement, index) => (
            <li
              key={statement.kind + ":" + index}
              data-testid="release-statement"
              className="rounded-md border bg-background/40 p-1.5"
            >
              <div className="flex items-center gap-1.5">
                <RiskBadge risk={statement.risk} />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {statement.kind}
                </span>
                {statement.affectedTable !== null && (
                  <button
                    type="button"
                    disabled={linksDisabled}
                    onClick={onOpenSchema}
                    title={rt("releasePreview.codeLive.open")}
                    className="ml-auto max-w-[45%] truncate font-mono text-[10px] text-muted-foreground hover:text-primary hover:underline disabled:opacity-60"
                  >
                    {statement.affectedTable}
                  </button>
                )}
              </div>
              {statement.affectedColumns.length > 0 && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {statement.affectedColumns.join(", ")}
                </p>
              )}
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1.5 font-mono text-[10px] text-foreground/80">
                {statement.sql}
              </pre>
            </li>
          ))}
        </ul>
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
