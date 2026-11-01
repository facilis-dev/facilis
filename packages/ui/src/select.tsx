import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./select.css";

export type SelectProps = ComponentProps<"select">;

/** Native select: children are the option elements, passed through untouched. */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cx("fc-select", className)} {...props}>
      {children}
    </select>
  );
}
