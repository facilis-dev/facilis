import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * Native button plus the two axes the kit supports. Variants only select a .fc-btn--* class,
 * so colours and radii stay in theme.css and a project restyles without touching component
 * code (D-055). type defaults to "button" so a kit button never submits a form by accident.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("fc-btn", "fc-btn--" + variant, "fc-btn--" + size, className)}
      {...props}
    />
  );
}
