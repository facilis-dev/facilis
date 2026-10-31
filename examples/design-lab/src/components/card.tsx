import type { ReactNode } from "react";
import { IconTrend } from "../icons.tsx";

export type CardProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Removes body padding for edge-to-edge content such as tables. */
  flush?: boolean;
};

export function Card({
  title,
  description,
  actions,
  children,
  footer,
  className,
  flush,
}: CardProps) {
  return (
    <section
      className={
        "lab-card" + (flush ? " lab-card--flush" : "") + (className ? " " + className : "")
      }
    >
      {title === undefined && actions === undefined ? null : (
        <header className="lab-card__header">
          <div>
            {title === undefined ? null : <h2 className="lab-card__title">{title}</h2>}
            {description === undefined ? null : <p className="lab-card__desc">{description}</p>}
          </div>
          {actions === undefined ? null : <div className="lab-card__actions">{actions}</div>}
        </header>
      )}
      <div className="lab-card__body">{children}</div>
      {footer === undefined ? null : <footer className="lab-card__footer">{footer}</footer>}
    </section>
  );
}

export type StatCardProps = {
  label: string;
  value: string;
  meta?: string;
  trend?: { readonly direction: "up" | "down"; readonly value: string };
  progress?: number;
  icon?: ReactNode;
};

export function StatCard({ label, value, meta, trend, progress, icon }: StatCardProps) {
  return (
    <article className="lab-stat">
      <div className="lab-stat__head">
        <span className="lab-stat__label">{label}</span>
        {icon === undefined ? null : <span className="lab-stat__icon">{icon}</span>}
      </div>
      <p className="lab-stat__value">{value}</p>
      {progress === undefined ? null : (
        <div
          className="lab-meter"
          role="progressbar"
          aria-label={label}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: progress + "%" }} />
        </div>
      )}
      {meta === undefined ? null : (
        <p className="lab-stat__meta">
          {trend === undefined ? null : (
            <span className={"lab-trend lab-trend--" + trend.direction}>
              <IconTrend
                size={12}
                className={trend.direction === "down" ? "lab-icon--down" : undefined}
              />
              {trend.value}
            </span>
          )}
          {meta}
        </p>
      )}
    </article>
  );
}
