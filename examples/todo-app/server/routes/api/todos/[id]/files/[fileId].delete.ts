import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis.dev/core";
import { facilisFiles, todoFiles } from "~/db/schema";

// Remove one attachment link (D-053). The facilis_files metadata row is shared by the
// link table entries, so it is deleted only when no todo references the file any more.
export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    params: z.object({ id: z.uuid(), fileId: z.uuid() }),
    dbTables: ["todo_files", "facilis_files"],
    description: "Detach a file from a todo and drop its metadata when unreferenced.",
  },
  async (_event, { params, db }) => {
    const [link] = await db
      .delete(todoFiles)
      .where(and(eq(todoFiles.parentId, params.id), eq(todoFiles.fileId, params.fileId)))
      .returning({ id: todoFiles.id });
    if (link === undefined) return fail("not_found");

    const [stillLinked] = await db
      .select({ id: todoFiles.id })
      .from(todoFiles)
      .where(eq(todoFiles.fileId, params.fileId))
      .limit(1);
    if (stillLinked === undefined) {
      await db.delete(facilisFiles).where(eq(facilisFiles.id, params.fileId));
    }

    return { deleted: true };
  },
);
