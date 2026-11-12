import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  accent: "bg-accent text-accent-foreground hover:bg-accent/90",
  outline: "border border-border bg-transparent text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
} as const;

const SIZES = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  default: "h-10 px-4",
  lg: "h-12 px-6 text-base",
  icon: "size-9",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/** The class recipe, so router links can be styled as buttons without a second component. */
export function buttonClass(options: ButtonClassOptions = {}): string {
  const { variant = "default", size = "default", className } = options;
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={buttonClass({ variant, size, className })}
      {...props}
    />
  );
}
