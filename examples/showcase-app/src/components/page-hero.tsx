import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

/** The interior-page header: shared across Studio, Work and Contact. */
export function PageHero({ eyebrow, title, description, children, className }: PageHeroProps) {
  return (
    <section className={cn("border-b border-border bg-secondary/40", className)}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 pt-16 pb-14 sm:pt-20">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">{eyebrow}</p>
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
    </section>
  );
}
