import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils.ts";

/** One loading indicator; a label turns it into a polite status for assistive tech. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <LoaderCircle
      className={cn("size-5 animate-spin text-muted-foreground", className)}
      role={label === undefined ? undefined : "status"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}
