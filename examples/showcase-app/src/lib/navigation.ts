/** The site's primary navigation: the header and footer both render this list. */
export const NAV_ITEMS = [
  { to: "/", key: "nav.home" },
  { to: "/features", key: "nav.features" },
  { to: "/showcase", key: "nav.showcase" },
  { to: "/contact", key: "nav.contact" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
