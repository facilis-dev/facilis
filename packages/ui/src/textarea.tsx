import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./textarea.css";

export type TextareaProps = ComponentProps<"textarea">;

/** Multi-line text control: native textarea props plus the shared .fc-textarea styling. */
export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cx("fc-textarea", className)} {...props} />;
}
