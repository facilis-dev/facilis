import { NavLink } from "react-router-dom";
import { docTree, type DocEntry, type DocSection } from "../lib/docs.ts";
import { t } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

/**
 * The sidebar is generated from the content tree (issue #163): directories become
 * collapsible sections, an index page leads its section, and frontmatter order sets the
 * reading order. Adding a content file updates this nav without editing React code.
 */
export function DocsSidebar() {
  return (
    <nav aria-label={t("sidebar.label")}>
      <SidebarList section={docTree()} />
    </nav>
  );
}

function SidebarLink({ entry }: { entry: DocEntry }) {
  return (
    <li>
      <NavLink
        to={entry.route}
        end
        className={({ isActive }) =>
          cn(
            "block rounded-md px-3 py-1.5 text-sm transition-colors",
            isActive
              ? "bg-accent/10 font-medium text-accent"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )
        }
      >
        {entry.title}
      </NavLink>
    </li>
  );
}

function SidebarList({ section }: { section: DocSection }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {section.index !== null ? <SidebarLink entry={section.index} /> : null}
      {section.pages.map((entry) => (
        <SidebarLink key={entry.route} entry={entry} />
      ))}
      {section.sections.map((child) => (
        <li key={child.key}>
          {/* details keeps the collapse native and hydration-safe: no client state to sync. */}
          <details open className="group">
            <summary className="cursor-pointer list-none rounded-md px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-foreground uppercase select-none hover:bg-muted">
              {child.label}
            </summary>
            <div className="mt-0.5 ml-2 border-l border-border pl-2">
              <SidebarList section={child} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
