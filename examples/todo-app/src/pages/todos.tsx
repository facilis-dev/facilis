import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Page,
  Select,
  Skeleton,
  TableToolbar,
  toast,
} from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { api, errorMessageKey } from "../lib/api.ts";
import { dueDateFromDate } from "../lib/dates.ts";
import { hasPermission, useSession } from "../lib/session.tsx";
import { TodoForm, type TodoDraft } from "../components/todo-form.tsx";
import { TodoTable, type Todo } from "../components/todo-table.tsx";

type TodosState =
  | { status: "loading" }
  | { status: "error"; messageKey: string }
  | { status: "ready"; todos: readonly Todo[] };

type StatusFilter = "all" | "open" | "done";

const DEFAULT_FILTER: StatusFilter = "all";
const SKELETON_ROWS = [0, 1, 2, 3];

function isStatusFilter(value: string): value is StatusFilter {
  return value === "all" || value === "open" || value === "done";
}

export function TodosPage() {
  const { session } = useSession();
  const canWrite = hasPermission(session, "todos:write");

  const [state, setState] = useState<TodosState>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>(DEFAULT_FILTER);
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  const reloadList = useCallback(async () => {
    try {
      setState({ status: "ready", todos: await api<readonly Todo[]>("/api/todos") });
    } catch (error) {
      setState({ status: "error", messageKey: errorMessageKey(error) });
    }
  }, []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    await reloadList();
  }, [reloadList]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(draft: TodoDraft): Promise<boolean> {
    setCreating(true);
    try {
      const body: { title: string; dueDate?: string } = { title: draft.title };
      if (draft.dueDate !== null) body.dueDate = dueDateFromDate(draft.dueDate);
      await api("/api/todos", { method: "POST", body: JSON.stringify(body) });
      toast.success(t("todos.created"));
      await reloadList();
      return true;
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(todo: Todo) {
    setBusyId(todo.id);
    try {
      await api("/api/todos/" + todo.id, {
        method: "PATCH",
        body: JSON.stringify({ done: !todo.done }),
      });
      toast.success(t("todos.updated"));
      await reloadList();
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (pendingDelete === null) return;
    setBusyId(pendingDelete.id);
    try {
      await api("/api/todos/" + pendingDelete.id, { method: "DELETE" });
      toast.success(t("todos.deleted"));
      setPendingDelete(null);
      await reloadList();
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  const todos = state.status === "ready" ? state.todos : [];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTodos = todos.filter((todo) => {
    const matchesQuery =
      normalizedQuery.length === 0 || todo.title.toLowerCase().includes(normalizedQuery);
    const matchesFilter = filter === "all" || (filter === "done" ? todo.done : !todo.done);
    return matchesQuery && matchesFilter;
  });
  const filtersActive = normalizedQuery.length > 0 || filter !== DEFAULT_FILTER;

  return (
    <Page title={t("todos.title")} description={t("todos.description")}>
      <TodoForm
        canWrite={canWrite}
        creating={creating}
        titleInput={titleInput}
        onCreate={handleCreate}
      />

      {state.status === "loading" ? (
        <div className="app-skeleton" role="status" aria-label={t("common.loading")}>
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} height="3rem" />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <Alert tone="error">
          <span>{t(state.messageKey)}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </Alert>
      ) : null}

      {state.status === "ready" ? (
        <>
          <TableToolbar
            className="app-todos-toolbar"
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder={t("todos.search.placeholder")}
            searchLabel={t("todos.search.label")}
            filters={
              <Select
                className="app-filter"
                aria-label={t("todos.filter.label")}
                value={filter}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isStatusFilter(next)) setFilter(next);
                }}
              >
                <option value="all">{t("todos.filter.all")}</option>
                <option value="open">{t("todos.filter.open")}</option>
                <option value="done">{t("todos.filter.done")}</option>
              </Select>
            }
            actions={
              <Button variant="secondary" size="sm" onClick={() => titleInput.current?.focus()}>
                {t("todos.new")}
              </Button>
            }
          />

          {todos.length === 0 ? (
            <EmptyState
              title={t("todos.empty.title")}
              description={t("todos.empty.description")}
              action={
                <Button onClick={() => titleInput.current?.focus()}>
                  {t("todos.empty.action")}
                </Button>
              }
            />
          ) : null}

          {todos.length > 0 && filtersActive && visibleTodos.length === 0 ? (
            <EmptyState
              title={t("todos.filtered.title")}
              description={t("todos.filtered.description")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setFilter(DEFAULT_FILTER);
                  }}
                >
                  {t("todos.filtered.action")}
                </Button>
              }
            />
          ) : null}

          {visibleTodos.length > 0 ? (
            <TodoTable
              todos={visibleTodos}
              canWrite={canWrite}
              busyId={busyId}
              onToggle={(todo) => void handleToggle(todo)}
              onRequestDelete={setPendingDelete}
            />
          ) : null}
        </>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t("todos.delete.title")}
        description={
          pendingDelete === null
            ? undefined
            : t("todos.delete.description", { title: pendingDelete.title })
        }
        closeLabel={t("common.close")}
        footer={
          <div className="app-dialog-actions">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busyId !== null}
              onClick={() => void confirmDelete()}
            >
              {t("todos.delete")}
            </Button>
          </div>
        }
      />
    </Page>
  );
}
