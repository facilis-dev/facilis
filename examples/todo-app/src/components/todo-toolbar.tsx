import { t } from "@facilis/core/i18n";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

export type StatusFilter = "all" | "open" | "done";

export const DEFAULT_FILTER: StatusFilter = "all";

export function isStatusFilter(value: string): value is StatusFilter {
  return value === "all" || value === "open" || value === "done";
}

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "todos.filter.all",
  open: "todos.filter.open",
  done: "todos.filter.done",
};

export type TodoToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  filter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
  onNew: () => void;
};

/** Search + status filter + the "new todo" action above the table. */
export function TodoToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onNew,
}: TodoToolbarProps) {
  const items = {
    all: t(FILTER_LABELS.all),
    open: t(FILTER_LABELS.open),
    done: t(FILTER_LABELS.done),
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-56">
        <Input
          type="search"
          value={query}
          placeholder={t("todos.search.placeholder")}
          aria-label={t("todos.search.label")}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <Select
        items={items}
        value={filter}
        onValueChange={(next) => {
          if (next !== null && isStatusFilter(next)) onFilterChange(next);
        }}
      >
        <SelectTrigger aria-label={t("todos.filter.label")} className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((value) => (
            <SelectItem key={value} value={value}>
              {t(FILTER_LABELS[value])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="secondary" size="sm" onClick={onNew}>
        {t("todos.new")}
      </Button>
    </div>
  );
}
