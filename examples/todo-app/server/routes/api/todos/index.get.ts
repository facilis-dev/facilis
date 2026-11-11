import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis.dev/core";
import { facilisFiles, todoFiles, todos } from "~/db/schema";

interface TodoFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Signed download URL, or null when no storage driver booted (the row still lists). */
  url: string | null;
}

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({ includeDone: z.enum(["true", "false"]).optional() }),
    dbTables: ["todos", "todo_files", "facilis_files"],
    dbColumns: [
      "todos.title",
      "todos.done",
      "todos.dueDate",
      "todos.tenantId",
      "todos.ownerId",
      "todo_files.todoId",
      "facilis_files.name",
    ],
    description: "List todos visible to the current user, with attachments (RLS-scoped).",
  },
  async (event, { query, db, storage }) => {
    const tenantId = event.context.facilis?.defaultTenantId;
    const rows = await db
      .select({
        id: todos.id,
        title: todos.title,
        done: todos.done,
        dueDate: todos.dueDate,
        ownerId: todos.ownerId,
      })
      .from(todos)
      .orderBy(desc(todos.createdAt));

    // Links are fetched once and grouped in JS: a left join would duplicate the todo row
    // per attachment and then need the same grouping, with a larger JSON payload.
    const links = await db
      .select({
        parentId: todoFiles.parentId,
        id: facilisFiles.id,
        name: facilisFiles.name,
        mime: facilisFiles.mime,
        size: facilisFiles.size,
      })
      .from(todoFiles)
      .innerJoin(facilisFiles, eq(facilisFiles.id, todoFiles.fileId));

    const filesByTodo = new Map<string, TodoFile[]>();
    for (const link of links) {
      const file: TodoFile = {
        id: link.id,
        name: link.name,
        mime: link.mime,
        size: link.size,
        // Without a driver the attachment is listed but not downloadable; the upload route
        // returns storage_unavailable, so this only happens for a degraded boot.
        url: storage.available ? storage.buildDownloadUrl(link.id, { tenantId }) : null,
      };
      const files = filesByTodo.get(link.parentId);
      if (files === undefined) filesByTodo.set(link.parentId, [file]);
      else files.push(file);
    }

    const withFiles = rows.map((row) => ({
      id: row.id,
      title: row.title,
      done: row.done,
      dueDate: row.dueDate,
      ownerId: row.ownerId,
      files: filesByTodo.get(row.id) ?? [],
    }));
    return query.includeDone === "false" ? withFiles.filter((row) => !row.done) : withFiles;
  },
);
