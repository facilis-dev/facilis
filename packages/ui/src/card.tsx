import type { ReactNode } from "react";
import { cx } from "./class-names.ts";
import "./card.css";

export type CardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Removes body padding for edge-to-edge content such as a flush table. */
  flush?: boolean;
  className?: string;
};

/**
 * Surface container: canvas -> card -> overlay. The header is optional and only renders when
 * one of its slots is set, so an empty card never leaves a stray title row.
 */
export function Card({
  title,
  description,
  actions,
  children,
  footer,
  flush = false,
  className,
}: CardProps) {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;

  return (
    <section className={cx("fc-card", flush && "fc-card--flush", className)}>
      {hasHeader ? (
        <header className="fc-card__header">
          <div className="fc-card__heading">
            {title === undefined ? null : <h2 className="fc-card__title">{title}</h2>}
            {description === undefined ? null : (
              <p className="fc-card__description">{description}</p>
            )}
          </div>
          {actions === undefined ? null : <div className="fc-card__actions">{actions}</div>}
        </header>
      ) : null}
      <div className="fc-card__body">{children}</div>
      {footer === undefined ? null : <footer className="fc-card__footer">{footer}</footer>}
    </section>
  );
}
