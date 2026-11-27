import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A dialog's in-flight message (issue #219). The button that started the operation
 * disables itself, so the browser would drop focus to the document; this takes focus
 * (`tabIndex={-1}`) when it mounts, and `role="status"` announces the operation.
 *
 * Cancelling is not something this component decides: the dialogs keep Cancel disabled
 * while the operation genuinely cannot be interrupted, and the form field keeps a tab stop.
 */
export function BusyStatus(props: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      className={cn("text-xs text-muted-foreground outline-none", props.className)}
    >
      {props.children}
    </div>
  );
}
