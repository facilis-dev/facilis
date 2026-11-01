import type { ComponentProps } from "react";
import { cx } from "./class-names.ts";
import "./input.css";

export type InputProps = ComponentProps<"input">;

/** Single-line text control: native input props plus the shared .fc-input styling. */
export function Input({ className, ...props }: InputProps) {
  return <input className={cx("fc-input", className)} {...props} />;
}
