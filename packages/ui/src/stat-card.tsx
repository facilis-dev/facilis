import type { ReactNode } from "react";
import { cx } from "./class-names.ts";
import "./stat-card.css";

export type StatTrend = {
  direction: "up" | "down";
  value: string;
};

export type StatCardProps = {
  label: string;
  value: string;
  meta?: string;
  trend?: StatTrend;
  /** 0-100; renders a determinate meter when present. */
  progress?: number;
  icon?: ReactNode;
  className?: string;
};

/** At-a-glance metric card: label, large tabular value, optional trend, meter and icon. */
export function StatCard({ label, value, meta, trend, progress, icon, className }: StatCardProps) {
  const clampedProgress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));

  return (
    <article className={cx("fc-stat", className)}>
      <div className="fc-stat__head">
        <span className="fc-stat__label">{label}</span>
        {icon === undefined ? null : <span className="fc-stat__icon">{icon}</span>}
      </div>
      <p className="fc-stat__value">{value}</p>
      {clampedProgress === undefined ? null : (
        <div
          className="fc-meter"
          role="progressbar"
          aria-label={label}
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="fc-meter__bar" style={{ width: clampedProgress + "%" }} />
        </div>
      )}
      {meta === undefined ? null : (
        <p className="fc-stat__meta">
          {trend === undefined ? null : (
            <span className={cx("fc-trend", "fc-trend--" + trend.direction)}>
              <span aria-hidden="true">{trend.direction === "up" ? "↑" : "↓"}</span>
              {trend.value}
            </span>
          )}
          {meta}
        </p>
      )}
    </article>
  );
}
