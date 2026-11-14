import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import type { TodoFile } from "../components/todo-files.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { buttonVariants } from "../components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx";
import { EmptyState } from "../components/ui/empty-state.tsx";
import { Page } from "../components/ui/page.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx";
import { api, errorMessageKey } from "../lib/api.ts";
import { formatDueDate } from "../lib/dates.ts";

interface TodoDetail {
  row: {
    id: string;
    title: string;
    done: boolean;
    dueDate: string | null;
    ownerId: string;
    createdAt: string;
  };
  files: readonly TodoFile[];
  filesTotal: number;
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; messageKey: string }
  | { status: "ready"; detail: TodoDetail };

/**
 * The detail surface of the reference section (PATTERNS §4.3): one record, its linked rows and
 * the four states. Read-only on purpose — the mutations live on the list page.
 */
export function TodoDetailPage() {
  const { id = "" } = useParams();
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    api<TodoDetail>("/api/todos/" + encodeURIComponent(id))
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", messageKey: errorMessageKey(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Page
      title={t("todos.detail.title")}
      description={t("todos.detail.description")}
      actions={
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} to="/todos">
          {t("todos.detail.back")}
        </Link>
      }
    >
      {state.status === "loading" ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t("common.loading")}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {state.status === "error" ? <Alert variant="destructive">{t(state.messageKey)}</Alert> : null}

      {state.status === "ready" ? <TodoDetailView detail={state.detail} /> : null}
    </Page>
  );
}

function TodoDetailView({ detail }: { detail: TodoDetail }) {
  const due = formatDueDate(detail.row.dueDate);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{detail.row.title}</CardTitle>
          <CardDescription>
            {due === null ? t("todos.detail.no_due") : t("todos.detail.due", { date: due })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant={detail.row.done ? "success" : "secondary"}>
            {detail.row.done ? t("todos.detail.done") : t("todos.detail.open")}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {t("todos.detail.files_total", { n: detail.filesTotal })}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("todos.detail.attachments")}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.files.length === 0 ? (
            <EmptyState
              title={t("todos.detail.no_files")}
              description={t("todos.detail.no_files_hint")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("todos.detail.file_name")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t("todos.detail.file_size")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      {file.url === null ? (
                        file.name
                      ) : (
                        <a className="underline-offset-2 hover:underline" href={file.url}>
                          {file.name}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Math.max(1, Math.round(file.size / 1024))} KB
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
