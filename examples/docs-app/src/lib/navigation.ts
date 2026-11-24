/** The site's primary navigation: the header and footer both render this list. */
export const NAV_ITEMS = [
  { to: "/", key: "nav.home" },
  { to: "/docs", key: "nav.docs" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
