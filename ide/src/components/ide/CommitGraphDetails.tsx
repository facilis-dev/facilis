// The commit-graph inspector (D-088): the selected commit's message, author, date, full
// hash and the branches pointing at it. A branch badge checks that branch out through the
// SCM session — the same operation as the panel's branch menu, with the same error channel.

import X from "~icons/lucide/x";
import GitBranch from "~icons/lucide/git-branch";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { CommitGraphNode } from "@/facilis/commit-graph-model";
import { laneColor } from "./CommitGraphCanvas";
import { useIde } from "./useIde";

export function CommitGraphDetails({
  root,
  node,
  onClose,
}: {
  root: string;
  node: CommitGraphNode;
  onClose: () => void;
}) {
  const { c } = useIde();
  const data = node.data;
  return (
    <aside
      data-testid="commit-graph-details"
      className="flex w-64 shrink-0 flex-col border-l bg-sidebar text-xs"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("commitGraph.details")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("commitGraph.detailsClose")}
          title={t("commitGraph.detailsClose")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="flex items-start gap-1.5">
          <span
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ background: laneColor(data.lane) }}
          />
          <span className="min-w-0 break-words font-medium">{data.message}</span>
        </div>
        <Field label={t("commitGraph.detailsOid")}>
          <span className="font-mono break-all select-all">{data.oid}</span>
        </Field>
        <Field label={t("commitGraph.detailsAuthor")}>{data.author || "—"}</Field>
        <Field label={t("commitGraph.detailsDate")}>
          {data.timestamp > 0 ? new Date(data.timestamp * 1000).toLocaleString() : "—"}
        </Field>
        <Field label={t("commitGraph.detailsBranches")}>
          {data.branches.length === 0 ? (
            <span className="text-muted-foreground">{t("commitGraph.detailsNone")}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {data.branches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  title={t("commitGraph.openBranch", { branch })}
                  className="flex items-center gap-0.5 rounded border px-1 hover:bg-accent"
                  onClick={() => void c.scm.checkoutBranch(root, branch)}
                >
                  <GitBranch className="size-2.5" />
                  {branch}
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
