// Shared shells for the Release Preview's diff lists: the section frame, the empty state and
// the risk badge. Kept in their own module so each diff file stays under the 300-line limit.
import { cn } from "@/lib/utils";
import { rt, type ReleaseMessageKey } from "@/facilis/release-i18n";
import type { RiskClass } from "@/facilis/release-engine";

export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background/30">
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1">
        <p className="truncate text-[11px] font-medium">{title}</p>
        {count !== undefined && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{count}</span>
        )}
      </div>
      <div className="space-y-1 p-2">{children}</div>
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="px-1 py-1 text-[11px] text-muted-foreground">{text}</p>;
}

const RISK_LABELS: Record<RiskClass, ReleaseMessageKey> = {
  safe: "releasePreview.risk.safe",
  careful: "releasePreview.risk.careful",
  destructive: "releasePreview.risk.destructive",
  breaking: "releasePreview.risk.breaking",
};

const RISK_STYLES: Record<RiskClass, string> = {
  safe: "border-success/40 bg-success/10 text-success",
  careful: "border-warning/40 bg-warning/10 text-warning",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
  breaking: "border-destructive bg-destructive/15 text-destructive",
};

export function RiskBadge({ risk }: { risk: RiskClass }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        RISK_STYLES[risk],
      )}
    >
      {rt(RISK_LABELS[risk])}
    </span>
  );
}
