import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * One shared 24px stroke grid, so every icon in the lab has the same weight and optical
 * size. Icons are inline (no icon dependency): the lab is about tokens and composition.
 */
function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Brand mark: an "F" knocked out of a rounded square (evenodd). */
export function IconLogo({ size = 20, ...props }: IconProps) {
  return (
    <Icon size={size} fill="currentColor" stroke="none" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 4v10h2.5v-3.8H14v-2.5h-3.5V9.5H16V7H8Z"
      />
    </Icon>
  );
}

export function IconGrid({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </Icon>
  );
}

export function IconFolder({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
    </Icon>
  );
}

export function IconUsers({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14a5.5 5.5 0 0 1 3 5" />
    </Icon>
  );
}

export function IconSettings({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.3M12 18.9v2.3M4.5 4.5l1.6 1.6M17.9 17.9l1.6 1.6M2.8 12h2.3M18.9 12h2.3M4.5 19.5l1.6-1.6M17.9 6.1l1.6-1.6" />
    </Icon>
  );
}

export function IconSearch({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </Icon>
  );
}

export function IconBell({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconChevron({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function IconCheck({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </Icon>
  );
}

export function IconX({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function IconTrash({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6 7l1 12.5h10L18 7M10 11v5M14 11v5" />
    </Icon>
  );
}

export function IconMore({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} fill="currentColor" stroke="none" {...props}>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </Icon>
  );
}

export function IconSun({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Icon>
  );
}

export function IconMoon({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
    </Icon>
  );
}

export function IconTrend({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="m3 17 6-6 4 4 7.5-7.5" />
      <path d="M16.5 7.5H21v4.5" />
    </Icon>
  );
}

export function IconExternal({ size = 16, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M13 4h7v7M20 4l-8.5 8.5" />
      <path d="M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-13A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4H9" />
    </Icon>
  );
}
