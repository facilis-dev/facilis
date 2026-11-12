import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-6", className)}>
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">{eyebrow}</p>
        <h2 className="font-serif text-3xl leading-tight tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
      </div>
      {action === undefined ? null : <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
