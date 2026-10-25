import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    params: z.object({ id: z.uuid() }),
    body: z.object({
      title: z.string().min(1).max(200).optional(),
      done: z.boolean().optional(),
    }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done"],
    description: "Update a todo (RLS prevents touching other users' rows).",
  },
  async (_event, { params, body, db }) => {
    const [row] = await db
      .update(todos)
      .set(body)
      .where(eq(todos.id, params.id))
      .returning({ id: todos.id, title: todos.title, done: todos.done });

    // RLS makes "someone else's todo" indistinguishable from "no such todo".
    if (row === undefined) return fail("not_found");
    return row;
  },
);
