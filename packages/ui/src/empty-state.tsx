import type { ReactNode } from "react";
import { cx } from "./class-names.ts";

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * "Nothing here yet" surface for list and detail pages. The title is a paragraph, not a
 * heading: the page already owns the heading hierarchy and EmptyState must not guess a level.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("fc-empty", className)}>
      <p className="fc-empty__title">{title}</p>
      {description === undefined ? null : <p className="fc-empty__description">{description}</p>}
      {action === undefined ? null : <div className="fc-empty__action">{action}</div>}
    </div>
  );
}
