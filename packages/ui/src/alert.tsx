import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";

export type AlertTone = "info" | "success" | "warning" | "error";

export type AlertProps = ComponentProps<"div"> & { tone?: AlertTone };

// warning/error interrupt, the other tones wait their turn; an explicit role always wins.
const ALERT_ROLES = {
  info: "status",
  success: "status",
  warning: "alert",
  error: "alert",
} as const;

/** Inline status message. The tone selects both the role semantics and the role class. */
export function Alert({ tone = "info", role, className, ...props }: AlertProps) {
  return (
    <div
      role={role ?? ALERT_ROLES[tone]}
      className={cx("fc-alert", "fc-alert--" + tone, className)}
      {...props}
    />
  );
}
