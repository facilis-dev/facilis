import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export type PageProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Page shell: route title/description header, then the route content. */
export function Page({ title, description, actions, children, className }: PageProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description === undefined ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
