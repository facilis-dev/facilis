import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./badge.css";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "error" | "info";

export type BadgeProps = ComponentProps<"span"> & { tone?: BadgeTone };

/** Small status chip; the tone only selects a .fc-badge--* role class. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span className={cx("fc-badge", "fc-badge--" + tone, className)} {...props} />;
}
