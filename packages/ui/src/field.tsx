import { cloneElement, useId, type AriaAttributes, type ReactElement } from "react";
import { cx } from "./class-names.ts";
import "./field.css";

/**
 * The props Field knows how to inject into its single child control. A value the control
 * already sets wins, because cloneElement copies the computed value only when the child prop
 * is absent (see the nullish fallbacks below).
 */
type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
  className?: string;
};

/**
 * Label plus control wiring. The id is generated once with useId so label/for, the control id
 * and the hint/error ids stay stable across a client render and match during hydration.
 */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const controlId = children.props.id ?? id + "control";
  const hintId = hint === undefined ? undefined : id + "hint";
  const errorId = error === undefined ? undefined : id + "error";

  // Keep an explicit aria-describedby on the control and append hint/error after it.
  const describedBy = [children.props["aria-describedby"], hintId, errorId]
    .filter((part): part is string => part !== undefined)
    .join(" ");

  const control = cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": children.props["aria-invalid"] ?? (error === undefined ? undefined : true),
  });

  return (
    <div className={cx("fc-field", className)}>
      <label className="fc-field__label" htmlFor={controlId}>
        {label}
      </label>
      {control}
      {hintId === undefined ? null : (
        <p className="fc-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {errorId === undefined ? null : (
        <p className="fc-field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
