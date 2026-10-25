import { z } from "zod";
import { defineAuthorizedHandler, fail } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    body: z.object({
      title: z.string().min(1).max(200),
      dueDate: z.iso.datetime().optional(),
    }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.dueDate", "todos.tenantId", "todos.ownerId", "todos.done"],
    description: "Create a todo for the current user.",
  },
  async (_event, { body, auth, db }) => {
    const [row] = await db
      .insert(todos)
      .values({
        title: body.title,
        dueDate: body.dueDate === undefined ? null : new Date(body.dueDate),
        tenantId: auth.tenantId,
        ownerId: auth.userId,
      })
      .returning({ id: todos.id, title: todos.title, done: todos.done });

    if (row === undefined) return fail("internal_error");
    return row;
  },
);
