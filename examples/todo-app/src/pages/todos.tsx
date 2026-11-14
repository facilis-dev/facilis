import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@facilis.dev/core/i18n";
import type { TodoFile } from "../components/todo-files.tsx";
import { TodoForm, type TodoDraft } from "../components/todo-form.tsx";
import { TodoTable, type Todo } from "../components/todo-table.tsx";
import { DEFAULT_FILTER, TodoToolbar, type StatusFilter } from "../components/todo-toolbar.tsx";
import { WeeklyChart, type WeekBucket } from "../components/weekly-chart.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { Page } from "../components/ui/page.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { api, errorMessageKey, uploadFile } from "../lib/api.ts";
import { dueDateFromDate } from "../lib/dates.ts";
import { hasPermission, useSession } from "../lib/session.tsx";

type TodosState =
  | { status: "loading" }
  | { status: "error"; messageKey: string }
  | { status: "ready"; todos: readonly Todo[] };

const SKELETON_ROWS = [0, 1, 2, 3];

interface TodoStats {
  buckets: readonly WeekBucket[];
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

  // The chart is supplementary: when the aggregation fails the list still renders.
  const [buckets, setBuckets] = useState<readonly WeekBucket[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<TodoStats>("/api/todos/stats")
      .then((stats) => {
        if (!cancelled) setBuckets(stats.buckets);
      })
      .catch(() => {
        if (!cancelled) setBuckets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleUpload(todo: Todo, file: File) {
    setBusyId(todo.id);
    try {
      await uploadFile("/api/todos/" + todo.id + "/files", file);
      toast.success(t("todos.files.uploaded"));
      await reloadList();
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveFile(todo: Todo, file: TodoFile) {
    setBusyId(todo.id);
    try {
      await api("/api/todos/" + todo.id + "/files/" + file.id, { method: "DELETE" });
      toast.success(t("todos.files.removed"));
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
        <div className="flex flex-col gap-2" role="status" aria-label={t("common.loading")}>
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <Alert variant="destructive" className="justify-between">
          <span>{t(state.messageKey)}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </Alert>
      ) : null}

      {state.status === "ready" ? (
        <>
          <TodoToolbar
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            onNew={() => titleInput.current?.focus()}
          />

          {todos.length > 0 && buckets !== null && buckets.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("todos.chart.title")}</CardTitle>
                <CardDescription>{t("todos.chart.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <WeeklyChart buckets={buckets} />
              </CardContent>
            </Card>
          ) : null}

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
              onUpload={(todo, file) => void handleUpload(todo, file)}
              onRemoveFile={(todo, file) => void handleRemoveFile(todo, file)}
            />
          ) : null}
        </>
      ) : null}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("todos.delete.title")}</DialogTitle>
            <DialogDescription>
              {pendingDelete === null
                ? null
                : t("todos.delete.description", { title: pendingDelete.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busyId !== null}
              onClick={() => void confirmDelete()}
            >
              {t("todos.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
