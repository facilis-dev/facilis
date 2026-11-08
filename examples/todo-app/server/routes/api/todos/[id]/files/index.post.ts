import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { storeUpload } from "@facilis/nitro/storage";
import { todoFiles, todos } from "~/db/schema";

// Upload one attachment for a todo (D-053). The todo select is the access check: RLS makes
// another user's todo indistinguishable from a missing one, so the failure is a 404. The
// metadata row is written through ctx.db, inside the request transaction, so a failed link
// insert rolls the metadata back instead of leaving an orphan row.
export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    params: z.object({ id: z.uuid() }),
    form: z.object({ file: z.instanceof(File) }),
    dbTables: ["todos", "todo_files", "facilis_files"],
    description: "Upload a binary attachment for a todo (multipart/form-data).",
  },
  async (event, { params, form, db, auth, storage }) => {
    const [todo] = await db
      .select({ id: todos.id })
      .from(todos)
      .where(eq(todos.id, params.id))
      .limit(1);
    if (todo === undefined) return fail("not_found");

    const stored = await storeUpload({ event, db, storage, auth, file: form.file });
    // A failed upload (too large, storage down) is already a finished error response.
    if (stored instanceof Response) return stored;

    const [link] = await db
      .insert(todoFiles)
      .values({ parentId: params.id, fileId: stored.id })
      .returning({ id: todoFiles.id });
    // Throw the Response so the request transaction rolls back the file metadata row.
    if (link === undefined) throw fail("not_found");

    return stored;
  },
);
