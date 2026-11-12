import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

const alertVariants = cva("flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-muted/50 text-foreground",
      success: "border-primary/30 bg-primary/10 text-primary",
      destructive: "border-destructive/30 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert };
