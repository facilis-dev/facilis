import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A field's error message, tied to the control it is about (issue #219). Base UI's Field
 * only stamps `aria-invalid` in `@base-ui/react` 1.9.0 — `aria-describedby` is never set —
 * so the id is explicit: `useFormError` hands the control its attributes and returns the
 * message to render beside it.
 *
 * It is not a live region: a validation message appears on every keystroke, and
 * `role="alert"` here would chatter. Asynchronous failures pass `live` instead, where the
 * message appears once and must be announced.
 */
export function FormError(props: {
  id?: string;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={props.id}
      role={props.live === true ? "alert" : undefined}
      className={cn("text-xs text-destructive", props.className)}
    >
      {props.children}
    </p>
  );
}

export interface FormErrorState {
  /** Spread onto the control; empty while the field is valid. */
  controlProps: { "aria-invalid"?: true; "aria-describedby"?: string };
  /** The message to render under the control, or null while the field is valid. */
  node: ReactNode;
}

/** The id, control attributes and message for one field's validation error. */
export function useFormError(message: string | null): FormErrorState {
  const id = useId();
  if (message === null || message === "") return { controlProps: {}, node: null };
  return {
    controlProps: { "aria-invalid": true, "aria-describedby": id },
    node: <FormError id={id}>{message}</FormError>,
  };
}
