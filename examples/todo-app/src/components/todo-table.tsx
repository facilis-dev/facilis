import { useMemo } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { formatDueDate, isOverdue, localTimeZone } from "../lib/dates.ts";
import { useLocale } from "../lib/i18n.tsx";

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
}

export type TodoTableProps = {
  todos: readonly Todo[];
  canWrite: boolean;
  busyId: string | null;
  onToggle: (todo: Todo) => void;
  onRequestDelete: (todo: Todo) => void;
};

/** The A data table: checkbox, title, tabular due date, status chip and a delete action. */
export function TodoTable({ todos, canWrite, busyId, onToggle, onRequestDelete }: TodoTableProps) {
  const { locale } = useLocale();
  const timeZone = useMemo(() => localTimeZone(), []);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("todos.column.done")}</TableHead>
          <TableHead scope="col">{t("todos.column.title")}</TableHead>
          <TableHead scope="col">{t("todos.column.due")}</TableHead>
          <TableHead scope="col" className="app-todo-status">
            {t("todos.column.status")}
          </TableHead>
          <TableHead scope="col">{t("todos.column.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {todos.map((todo) => {
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
                  onChange={() => onToggle(todo)}
                />
              </TableCell>
              <TableCell>
                <span
                  className={todo.done ? "app-todo-title app-todo-title--done" : "app-todo-title"}
                >
                  {todo.title}
                </span>
              </TableCell>
              <TableCell>
                {todo.dueDate === null || due === null ? (
                  <span className="app-muted">{t("todos.no_due_date")}</span>
                ) : (
                  <time
                    className={overdue ? "app-tabular app-due--overdue" : "app-tabular"}
                    dateTime={todo.dueDate}
                  >
                    {due}
                  </time>
                )}
              </TableCell>
              <TableCell className="app-todo-status">
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
                  onClick={() => onRequestDelete(todo)}
                >
                  {t("todos.delete")}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
