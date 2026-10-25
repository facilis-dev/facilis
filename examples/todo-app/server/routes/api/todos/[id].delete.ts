import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    params: z.object({ id: z.uuid() }),
    dbTables: ["todos"],
    description: "Delete a todo.",
  },
  async (_event, { params, db }) => {
    const [row] = await db.delete(todos).where(eq(todos.id, params.id)).returning({ id: todos.id });

    if (row === undefined) return fail("not_found");
    return { deleted: row.id };
  },
);
