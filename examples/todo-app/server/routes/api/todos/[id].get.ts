import { z } from "zod";
import { count, desc, eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis.dev/core";
import { facilisFiles, todoFiles, todos } from "~/db/schema";

const FILE_LIMIT = 20;

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    params: z.object({ id: z.uuid() }),
    dbTables: ["todos", "todo_files", "facilis_files"],
    dbColumns: [
      "todos.title",
      "todos.done",
      "todos.dueDate",
      "todos.ownerId",
      "todo_files.parentId",
      "facilis_files.name",
    ],
    description: "One todo with its latest attachments and their true total (RLS-scoped).",
  },
  async (event, { params, db, storage }) => {
    const [row] = await db
      .select({
        id: todos.id,
        title: todos.title,
        done: todos.done,
        dueDate: todos.dueDate,
        ownerId: todos.ownerId,
        createdAt: todos.createdAt,
      })
      .from(todos)
      .where(eq(todos.id, params.id))
      .limit(1);

    // RLS makes "someone else's todo" indistinguishable from "no such todo".
    if (row === undefined) return fail("not_found");

    const tenantId = event.context.facilis?.defaultTenantId;
    const rows = await db
      .select({
        id: facilisFiles.id,
        name: facilisFiles.name,
        mime: facilisFiles.mime,
        size: facilisFiles.size,
      })
      .from(todoFiles)
      .innerJoin(facilisFiles, eq(facilisFiles.id, todoFiles.fileId))
      .where(eq(todoFiles.parentId, params.id))
      .orderBy(desc(facilisFiles.createdAt))
      .limit(FILE_LIMIT);

    const [totalRow] = await db
      .select({ value: count() })
      .from(todoFiles)
      .where(eq(todoFiles.parentId, params.id));

    const files = rows.map((file) => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      // Without a driver the attachment is listed but not downloadable.
      url: storage.available ? storage.buildDownloadUrl(file.id, { tenantId }) : null,
    }));

    return { row, files, filesTotal: Number(totalRow?.value ?? 0) };
  },
);
