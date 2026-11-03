import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export type AuthShellProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Centred card for the auth routes; router- and session-free so a route renders it directly. */
export function AuthShell({ title, subtitle, footer, children, className }: AuthShellProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle === undefined ? null : (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div>{children}</div>
      {footer === undefined ? null : (
        <div className="border-t border-border pt-4 text-sm text-muted-foreground">{footer}</div>
      )}
    </div>
  );
}
