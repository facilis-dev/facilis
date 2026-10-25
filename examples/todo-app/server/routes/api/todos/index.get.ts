import { z } from "zod";
import { desc } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({ includeDone: z.enum(["true", "false"]).optional() }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done", "todos.dueDate", "todos.tenantId", "todos.ownerId"],
    description: "List todos visible to the current user (RLS-scoped).",
  },
  async (_event, { query, db }) => {
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

    return query.includeDone === "false" ? rows.filter((row) => !row.done) : rows;
  },
);
