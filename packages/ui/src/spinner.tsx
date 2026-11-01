import { cx } from "./class-names.ts";
import "./spinner.css";

export type SpinnerProps = { label?: string };

/**
 * Loading indicator. With a label it is a polite status for assistive tech; without one it is
 * purely decorative and hidden from the accessibility tree. The spin animation is disabled by
 * the prefers-reduced-motion rule in theme.css.
 */
export function Spinner({ label }: SpinnerProps) {
  if (label === undefined) {
    return <span className={cx("fc-spinner")} aria-hidden="true" />;
  }

  return <span className={cx("fc-spinner")} role="status" aria-label={label} />;
}
