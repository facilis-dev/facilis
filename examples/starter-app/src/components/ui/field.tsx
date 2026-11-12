import { cloneElement, useId, type AriaAttributes, type ReactElement } from "react";
import { Label } from "./label.tsx";
import { cn } from "../../lib/utils.ts";

/** The props Field injects into its single child control (an existing value wins). */
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

/** Label + control + hint/error wiring; useId keeps label-for and description ids stable. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const controlId = children.props.id ?? id + "control";
  const hintId = hint === undefined ? undefined : id + "hint";
  const errorId = error === undefined ? undefined : id + "error";

  const describedBy = [children.props["aria-describedby"], hintId, errorId]
    .filter((part): part is string => part !== undefined)
    .join(" ");

  const control = cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": children.props["aria-invalid"] ?? (error === undefined ? undefined : true),
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={controlId}>{label}</Label>
      {control}
      {hintId === undefined ? null : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errorId === undefined ? null : (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
