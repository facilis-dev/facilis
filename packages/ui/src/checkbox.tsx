import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./checkbox.css";

// type is omitted because Checkbox forces type="checkbox": the kit checkbox is a checkbox.
export type CheckboxProps = Omit<ComponentProps<"input">, "type">;

/** Checkbox input; the forced type is applied after the spread so it cannot be overridden. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return <input {...props} type="checkbox" className={cx("fc-checkbox", className)} />;
}
