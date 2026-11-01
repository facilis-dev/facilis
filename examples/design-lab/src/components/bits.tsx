import { Input, Select } from "@facilis/ui";
import { IconChevron, IconSearch } from "../icons.tsx";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Deterministic tint index: the same person keeps the same avatar colour across screens. */
function toneOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash + (char.codePointAt(0) ?? 0)) % 5;
  return hash;
}

export type AvatarProps = {
  name: string;
  size?: "sm" | "md" | "lg";
};

export function Avatar({ name, size = "md" }: AvatarProps) {
  return (
    <span
      className={"lab-avatar lab-avatar--" + size}
      data-tone={toneOf(name)}
      role="img"
      aria-label={name}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: readonly string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="lab-avatar-stack">
      {shown.map((name) => (
        <Avatar key={name} name={name} size="sm" />
      ))}
      {extra > 0 ? (
        <span className="lab-avatar lab-avatar--sm lab-avatar--more">+{extra}</span>
      ) : null}
    </span>
  );
}

export type SegmentedOption = { readonly id: string; readonly label: string };

export type SegmentedControlProps = {
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
};

export function SegmentedControl({ options, value, onChange, label }: SegmentedControlProps) {
  return (
    <div className="lab-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="lab-segmented__btn"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type PaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

export function Pagination({ page, pageCount, total, pageSize, onPageChange }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

  return (
    <div className="lab-pagination">
      <p className="lab-pagination__summary">
        Showing{" "}
        <span className="lab-tabular">
          {from}–{to}
        </span>{" "}
        of <span className="lab-tabular">{total}</span>
      </p>
      <div className="lab-pagination__pages">
        <button
          type="button"
          className="lab-page-btn"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <IconChevron className="lab-icon--left" />
        </button>
        {pages.map((number) => (
          <button
            key={number}
            type="button"
            className="lab-page-btn"
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPageChange(number)}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          className="lab-page-btn"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <IconChevron className="lab-icon--right" />
        </button>
      </div>
    </div>
  );
}

export type TableToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  statusOptions: readonly SegmentedOption[];
  view: string;
  onViewChange: (value: string) => void;
  viewOptions: readonly SegmentedOption[];
};

/** Search + status filter + view switch. Sits above a table inside a flush card. */
export function TableToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  statusOptions,
  view,
  onViewChange,
  viewOptions,
}: TableToolbarProps) {
  return (
    <div className="lab-toolbar">
      <div className="lab-toolbar__search">
        <IconSearch />
        <Input
          type="search"
          value={search}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="lab-input--search"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <Select
        className="lab-toolbar__select"
        aria-label="Filter by status"
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
      >
        {statusOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      <span className="lab-toolbar__spacer" />
      <SegmentedControl
        label="Project view"
        options={viewOptions}
        value={view}
        onChange={onViewChange}
      />
    </div>
  );
}
