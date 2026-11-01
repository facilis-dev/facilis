import type { ReactNode } from "react";
import { cx } from "./class-names.ts";
import "./auth-shell.css";

export type AuthShellProps = {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Centred card for the auth routes (login, register, recovery). The card itself is the
 * layout: it stays router- and session-free so the project renders it directly in a route.
 */
export function AuthShell({ title, subtitle, footer, children, className }: AuthShellProps) {
  return (
    <div className={cx("fc-auth", className)}>
      <h1 className="fc-auth__title">{title}</h1>
      {subtitle === undefined ? null : <p className="fc-auth__subtitle">{subtitle}</p>}
      <div className="fc-auth__content">{children}</div>
      {footer === undefined ? null : <div className="fc-auth__footer">{footer}</div>}
    </div>
  );
}
