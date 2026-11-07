import { useMemo } from "react";
import { t } from "@facilis/core/i18n";
import { formatDueDate, isOverdue, localTimeZone } from "../lib/dates.ts";
import { useLocale } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";

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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-12">
              {t("todos.column.done")}
            </TableHead>
            <TableHead scope="col">{t("todos.column.title")}</TableHead>
            <TableHead scope="col">{t("todos.column.due")}</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              {t("todos.column.status")}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t("todos.column.actions")}
            </TableHead>
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
                    onCheckedChange={() => onToggle(todo)}
                  />
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "block [overflow-wrap:anywhere]",
                      todo.done && "line-through opacity-60",
                    )}
                  >
                    {todo.title}
                  </span>
                </TableCell>
                <TableCell>
                  {todo.dueDate === null || due === null ? (
                    <span className="text-muted-foreground">{t("todos.no_due_date")}</span>
                  ) : (
                    <time
                      className={cn(
                        "whitespace-nowrap tabular-nums",
                        overdue && "font-semibold text-destructive",
                      )}
                      dateTime={todo.dueDate}
                    >
                      {due}
                    </time>
                  )}
                </TableCell>
                {/* On a phone the checkbox already shows "done" and an overdue date is red,
                    so the chip costs more width than it explains. */}
                <TableCell className="hidden sm:table-cell">
                  {todo.done ? (
                    <Badge variant="success">{t("todos.status.done")}</Badge>
                  ) : overdue ? (
                    <Badge variant="destructive">{t("todos.overdue")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("todos.status.open")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
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
    </div>
  );
}
