import { cx } from "./class-names.ts";
import "./skeleton.css";

export type SkeletonProps = {
  width?: string;
  height?: string;
  /** Pill radius, for avatar/status placeholders. */
  circle?: boolean;
  className?: string;
};

/** Decorative placeholder block, so it stays out of the accessibility tree. */
export function Skeleton({ width, height, circle = false, className }: SkeletonProps) {
  return (
    <span
      className={cx("fc-skeleton", circle && "fc-skeleton--circle", className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
