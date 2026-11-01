import type { ReactNode } from "react";
import { Input } from "@facilis/ui";
import { currentUser } from "../data.ts";
import {
  IconBell,
  IconChevron,
  IconFolder,
  IconGrid,
  IconLogo,
  IconSearch,
  IconSettings,
  IconTrend,
  IconUsers,
} from "../icons.tsx";
import { Avatar } from "./bits.tsx";

export type AppShellProps = {
  activeNav: string;
  breadcrumb: readonly string[];
  children: ReactNode;
};

const NAV_ITEMS: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { id: "Overview", label: "Overview", icon: <IconGrid /> },
  { id: "Projects", label: "Projects", icon: <IconFolder /> },
  { id: "Team", label: "Team", icon: <IconUsers /> },
  { id: "Reports", label: "Reports", icon: <IconTrend /> },
  { id: "Settings", label: "Settings", icon: <IconSettings /> },
];

/**
 * Sidebar + topbar shell for the app screens. It is deliberately in the lab (and not in
 * @facilis/ui): navigation knows about the product, the kit only owns the controls.
 */
export function AppShell({ activeNav, breadcrumb, children }: AppShellProps) {
  return (
    <div className="lab-shell">
      <aside className="lab-sidebar">
        <div className="lab-sidebar__brand">
          <span className="lab-logo">
            <IconLogo size={16} />
          </span>
          <span className="lab-sidebar__name">Facilis</span>
        </div>
        <nav className="lab-nav" aria-label="Primary">
          <p className="lab-nav__label">Workspace</p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="lab-nav__item"
              aria-current={item.id === activeNav ? "page" : undefined}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="lab-sidebar__foot">
          <Avatar name={currentUser.name} size="sm" />
          <div className="lab-sidebar__user">
            <p className="lab-sidebar__user-name">{currentUser.name}</p>
            <p className="lab-sidebar__user-email">{currentUser.email}</p>
          </div>
          <button
            type="button"
            className="lab-icon-btn lab-icon-btn--sm"
            aria-label="Account settings"
          >
            <IconSettings />
          </button>
        </div>
      </aside>
      <div className="lab-main">
        <header className="lab-topbar">
          <nav className="lab-breadcrumb" aria-label="Breadcrumb">
            {breadcrumb.map((part, index) => (
              <span className="lab-breadcrumb__part" key={part + index}>
                {index > 0 ? <IconChevron className="lab-icon--right" size={14} /> : null}
                {index === breadcrumb.length - 1 ? (
                  <span className="lab-breadcrumb__current" aria-current="page">
                    {part}
                  </span>
                ) : (
                  <span>{part}</span>
                )}
              </span>
            ))}
          </nav>
          <div className="lab-topbar__tools">
            <div className="lab-topbar__search">
              <IconSearch />
              <Input
                type="search"
                aria-label="Search workspace"
                placeholder="Search workspace…"
                className="lab-input--search"
              />
            </div>
            <span className="lab-notify">
              <button type="button" className="lab-icon-btn" aria-label="Notifications">
                <IconBell />
              </button>
              <span className="lab-notify__dot" />
            </span>
            <Avatar name={currentUser.name} size="sm" />
          </div>
        </header>
        <main className="lab-content">{children}</main>
      </div>
    </div>
  );
}
