import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * "Nothing here yet" surface. The title is a paragraph, not a heading: the page already owns
 * the heading hierarchy and an empty state must not guess a level.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
