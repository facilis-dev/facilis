import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

/** Decorative placeholder block, so it stays out of the accessibility tree. */
function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("shimmer block rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
