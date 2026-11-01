import type { ReactNode } from "react";
import { cx } from "./class-names.ts";
import { Input } from "./input.tsx";
import "./table-toolbar.css";

export type TableToolbarProps = {
  /** Controlled search value; the search field only renders when both value and onChange are set. */
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Filter controls, e.g. a Select. */
  filters?: ReactNode;
  /** Right-aligned actions, e.g. a Button. */
  actions?: ReactNode;
  className?: string;
};

/** Search + filter + action slots above a table; the kit owns layout, the app owns controls. */
export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchLabel = "Search",
  filters,
  actions,
  className,
}: TableToolbarProps) {
  const showSearch = search !== undefined && onSearchChange !== undefined;

  return (
    <div className={cx("fc-toolbar", className)}>
      {showSearch ? (
        <div className="fc-toolbar__search">
          <Input
            type="search"
            value={search}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      ) : null}
      {filters === undefined ? null : <div className="fc-toolbar__filters">{filters}</div>}
      <span className="fc-toolbar__spacer" />
      {actions === undefined ? null : <div className="fc-toolbar__actions">{actions}</div>}
    </div>
  );
}
