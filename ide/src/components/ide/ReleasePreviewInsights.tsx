// The Release Preview's security, breaking-change and warning sections (SPEC §11.3).
// Pure presentation over the view model; kept apart from ReleasePreviewSections.tsx so each
// file stays under the 300-line limit.
//
// The engine ships its breaking/warning comments as prose; the panel renders them through
// t() keys instead, using the engine's structured fields (kind/table/count), so every
// user-facing sentence stays in the catalogue (D-043).

import { rt, type ReleaseMessageKey } from "@/facilis/release-i18n";
import type { ReleasePreviewView } from "@/facilis/release-preview-model";
import type { BreakingChange, ReleaseWarning } from "@/facilis/release-engine";
import { Empty, Section } from "./ReleasePreviewChrome";

const DIRECTION_LABELS: Record<"narrowed" | "broadened" | "unknown", ReleaseMessageKey> = {
  broadened: "releasePreview.security.direction.broadened",
  narrowed: "releasePreview.security.direction.narrowed",
  unknown: "releasePreview.security.direction.unknown",
};

export function SecuritySection({ view }: { view: ReleasePreviewView }) {
  const { policiesAdded, policiesDropped, policiesChanged, rlsDisabled } = view.security;
  const total =
    policiesAdded.length + policiesDropped.length + policiesChanged.length + rlsDisabled.length;
  return (
    <Section title={rt("releasePreview.security.title")} count={total}>
      {total === 0 ? (
        <Empty text={rt("releasePreview.security.empty")} />
      ) : (
        <ul className="space-y-0.5 text-[10px]">
          <PolicyLine
            label={rt("releasePreview.security.policiesAdded")}
            value={policiesAdded.map((policy) => policy.name).join(", ")}
          />
          <PolicyLine
            label={rt("releasePreview.security.policiesDropped")}
            value={policiesDropped.map((policy) => policy.name).join(", ")}
          />
          <PolicyLine
            label={rt("releasePreview.security.policiesChanged")}
            value={policiesChanged
              .map(
                (change) =>
                  change.table +
                  "." +
                  change.policy +
                  " (" +
                  rt(DIRECTION_LABELS[change.direction]) +
                  ")",
              )
              .join(", ")}
          />
          <PolicyLine
            label={rt("releasePreview.security.rlsDisabled")}
            value={rlsDisabled.map((entry) => entry.table).join(", ")}
          />
        </ul>
      )}
    </Section>
  );
}

function PolicyLine({ label, value }: { label: string; value: string }) {
  if (value.length === 0) return null;
  return (
    <li className="flex gap-1.5">
      <span className="shrink-0 font-medium text-muted-foreground">{label}:</span>
      <span className="min-w-0 break-words font-mono">{value}</span>
    </li>
  );
}

export function BreakingSection({ view }: { view: ReleasePreviewView }) {
  return (
    <Section title={rt("releasePreview.breaking.title")} count={view.breaking.length}>
      {view.breaking.length === 0 ? (
        <Empty text={rt("releasePreview.breaking.empty")} />
      ) : (
        <ul className="space-y-1">
          {view.breaking.map((change, index) => (
            <li
              key={change.kind + ":" + change.table + ":" + index}
              data-testid="release-breaking"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-1.5 text-[11px]"
            >
              <p className="font-medium text-destructive">{breakingMessage(change)}</p>
              {change.routes.length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {rt("releasePreview.breaking.routes", {
                    routes: change.routes
                      .map((route) => route.method + " " + route.path)
                      .join(", "),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function breakingMessage(change: BreakingChange): string {
  switch (change.kind) {
    case "dropped_table_in_use":
      return rt("releasePreview.breaking.dropped_table_in_use", {
        table: change.table,
        count: change.routes.length,
      });
    case "dropped_column_in_use":
      return rt("releasePreview.breaking.dropped_column_in_use", {
        table: change.table,
        column: change.column ?? "",
        count: change.routes.length,
      });
    case "widened_type_mismatch":
      return rt("releasePreview.breaking.widened_type_mismatch", {
        table: change.table,
        column: change.column ?? "",
      });
  }
}

export function WarningSection({ view }: { view: ReleasePreviewView }) {
  return (
    <Section title={rt("releasePreview.warnings.title")} count={view.warnings.length}>
      {view.warnings.length === 0 ? (
        <Empty text={rt("releasePreview.warnings.empty")} />
      ) : (
        <ul className="space-y-0.5">
          {view.warnings.map((warning, index) => (
            <li
              key={warning.kind + ":" + index}
              data-testid="release-warning"
              className="text-[11px] text-foreground/80"
            >
              {warningMessage(warning)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function warningMessage(warning: ReleaseWarning): string {
  switch (warning.kind) {
    case "pending_migrations_on_target":
      return rt("releasePreview.warning.pending_migrations_on_target", {
        path: warning.related ?? "",
      });
    case "destructive_without_backfill":
      return rt("releasePreview.warning.destructive_without_backfill", {
        table: warning.related ?? "",
      });
    case "policy_broadened":
      return rt("releasePreview.warning.policy_broadened", { policy: warning.related ?? "" });
  }
}
