import type { ReactNode } from "react";
import { cx } from "./class-names.ts";

export type PageProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Neutral page shell: header with the route title, optional description and actions, then the
 * page content. It owns no navigation or session markup — layouts compose that around it.
 */
export function Page({ title, description, actions, children, className }: PageProps) {
  return (
    <div className={cx("fc-page", className)}>
      <header className="fc-page__header">
        <div className="fc-page__heading">
          <h1 className="fc-page__title">{title}</h1>
          {description === undefined ? null : <p className="fc-page__description">{description}</p>}
        </div>
        {actions === undefined ? null : <div className="fc-page__actions">{actions}</div>}
      </header>
      <div className="fc-page__content">{children}</div>
    </div>
  );
}
