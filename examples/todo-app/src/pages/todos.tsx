import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Page,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { api, errorMessageKey } from "../lib/api.ts";
import { dueDateFromInput, formatDueDate, isOverdue, localTimeZone } from "../lib/dates.ts";
import { hasPermission, useSession } from "../lib/session.tsx";
import { useLocale } from "../lib/i18n.tsx";

interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
}

type TodosState =
  | { status: "loading" }
  | { status: "error"; messageKey: string }
  | { status: "ready"; todos: readonly Todo[] };

export function TodosPage() {
  const { session } = useSession();
  const { locale } = useLocale();
  const timeZone = useMemo(() => localTimeZone(), []);
  const canWrite = hasPermission(session, "todos:write");

  const [state, setState] = useState<TodosState>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    try {
      const body: { title: string; dueDate?: string } = { title: trimmed };
      if (dueDate.length > 0) body.dueDate = dueDateFromInput(dueDate, timeZone);
      await api("/api/todos", { method: "POST", body: JSON.stringify(body) });
      setTitle("");
      setDueDate("");
      toast.success(t("todos.created"));
      await reloadList();
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
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

  async function handleDelete(todo: Todo) {
    setBusyId(todo.id);
    try {
      await api("/api/todos/" + todo.id, { method: "DELETE" });
      toast.success(t("todos.deleted"));
      await reloadList();
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page title={t("todos.title")} description={t("todos.description")}>
      <form className="app-todos-form" onSubmit={(event) => void handleCreate(event)}>
        <Field label={t("todos.new")} className="app-todos-form__title">
          <Input
            ref={titleInput}
            type="text"
            placeholder={t("todos.title.placeholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t("todos.dueDate")} className="app-todos-form__date">
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Button type="submit" disabled={!canWrite || creating || title.trim().length === 0}>
          {t("todos.add")}
        </Button>
      </form>

      {state.status === "loading" ? (
        <div className="app-loading">
          <Spinner label={t("common.loading")} />
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

      {state.status === "ready" && state.todos.length === 0 ? (
        <EmptyState
          title={t("todos.empty.title")}
          description={t("todos.empty.description")}
          action={
            <Button onClick={() => titleInput.current?.focus()}>{t("todos.empty.action")}</Button>
          }
        />
      ) : null}

      {state.status === "ready" && state.todos.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("todos.column.done")}</TableHead>
              <TableHead>{t("todos.column.title")}</TableHead>
              <TableHead>{t("todos.column.due")}</TableHead>
              <TableHead>{t("todos.column.status")}</TableHead>
              <TableHead>{t("todos.column.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.todos.map((todo) => {
              const due = formatDueDate(todo.dueDate, { locale, timeZone });
              const overdue = !todo.done && isOverdue(todo.dueDate, { timeZone });
              return (
                <TableRow key={todo.id}>
                  <TableCell>
                    <Checkbox
                      checked={todo.done}
                      disabled={!canWrite || busyId === todo.id}
                      aria-label={
                        todo.done
                          ? t("todos.mark_open", { title: todo.title })
                          : t("todos.mark_done", { title: todo.title })
                      }
                      onChange={() => void handleToggle(todo)}
                    />
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        todo.done ? "app-todo-title app-todo-title--done" : "app-todo-title"
                      }
                    >
                      {todo.title}
                    </span>
                  </TableCell>
                  <TableCell>{due ?? t("todos.no_due_date")}</TableCell>
                  <TableCell>
                    {todo.done ? (
                      <Badge tone="success">{t("todos.status.done")}</Badge>
                    ) : overdue ? (
                      <Badge tone="error">{t("todos.overdue")}</Badge>
                    ) : (
                      <Badge tone="neutral">{t("todos.status.open")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={!canWrite || busyId === todo.id}
                      onClick={() => void handleDelete(todo)}
                    >
                      {t("todos.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </Page>
  );
}
