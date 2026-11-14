import { t } from "@facilis.dev/core/i18n";
import { formatDueDate } from "../lib/dates.ts";

export interface WeekBucket {
  /** ISO date of the week's Monday. */
  weekStart: string;
  count: number;
}

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 96;
/** The axis sits above the box bottom, leaving room for the labels below it. */
export const BASELINE = 72;

function weekLabel(bucket: WeekBucket): string {
  return formatDueDate(bucket.weekStart) ?? bucket.weekStart;
}

/**
 * Created-per-week bars, no chart dependency: one <svg>, role tokens for fill and axis, and
 * the numbers in a <title> per bar so the chart is readable by assistive tech (PATTERNS §4.4).
 */
export function WeeklyChart({ buckets }: { buckets: readonly WeekBucket[] }) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const slot = VIEW_WIDTH / Math.max(1, buckets.length);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <figure className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={t("todos.chart.aria", { n: total })}
        viewBox={"0 0 " + VIEW_WIDTH + " " + VIEW_HEIGHT}
        preserveAspectRatio="none"
        className="h-24 w-full"
      >
        {buckets.map((bucket, index) => {
          const height = (bucket.count / max) * (BASELINE - 12);
          return (
            <rect
              key={bucket.weekStart}
              x={index * slot + slot * 0.2}
              y={BASELINE - height}
              width={slot * 0.6}
              height={Math.max(height, 2)}
              rx={2}
              className={bucket.count === 0 ? "fill-muted" : "fill-primary"}
            >
              <title>{weekLabel(bucket) + " — " + bucket.count}</title>
            </rect>
          );
        })}
        <line x1="0" y1={BASELINE} x2={VIEW_WIDTH} y2={BASELINE} className="stroke-border" />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{first === undefined ? "" : weekLabel(first)}</span>
        <span>{last === undefined ? "" : weekLabel(last)}</span>
      </div>
    </figure>
  );
}
