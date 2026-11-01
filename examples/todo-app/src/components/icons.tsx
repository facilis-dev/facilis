/**
 * Inline currentColor icons for the app shell. They live in the app (not the kit) because
 * they only exist for this product's navigation and actions; the kit owns the controls.
 */

import type { ReactNode } from "react";

type IconProps = { readonly className?: string };

function frame(children: ReactNode, className?: string) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconList({ className }: IconProps = {}) {
  return frame(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>,
    className,
  );
}

export function IconSun({ className }: IconProps = {}) {
  return frame(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>,
    className,
  );
}

export function IconMoon({ className }: IconProps = {}) {
  return frame(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />, className);
}

export function IconLogOut({ className }: IconProps = {}) {
  return frame(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>,
    className,
  );
}
