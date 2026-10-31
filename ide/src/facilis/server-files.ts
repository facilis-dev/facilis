// Server half of the Facilis probe template.
//
// Every route goes through defineAuthorizedHandler (security invariant 1) with an
// accurate dbTables list, so the AST pass can publish x-db-tables on /_openapi.json.

const pingRoute = `import { defineAuthorizedHandler } from "@facilis/core";

// Public probe route: empty permission and empty dbTables prove the wrapper and
// the AST metadata pass without touching a table.
export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [],
    description: "Framework liveness probe.",
  },
  async () => ({ ok: true }),
);
`;

const todosRoute = `import { desc } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis/core";
import { todos } from "~/db/schema";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    dbTables: ["todos"],
    description: "List todos visible to the current user (RLS-scoped).",
  },
  async (_event, { db }) => {
    return await db
      .select({
        id: todos.id,
        title: todos.title,
        done: todos.done,
        dueDate: todos.dueDate,
      })
      .from(todos)
      .orderBy(desc(todos.createdAt));
  },
);
`;

const todosPostRoute = `import { z } from "zod";
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
    dbColumns: ["todos.title", "todos.dueDate", "todos.tenantId", "todos.ownerId"],
    description: "Create a todo for the current user.",
  },
  async (_event, { body, auth, db }) => {
    const [row] = await db
      .insert(todos)
      .values({
        title: body.title,
        dueDate: body.dueDate === undefined ? null : new Date(body.dueDate),
        ownerId: auth.userId,
      })
      .returning({ id: todos.id, title: todos.title, done: todos.done });

    if (row === undefined) return fail("internal_error");
    return row;
  },
);
`;

export const serverFiles: Record<string, string> = {
  "server/routes/api/ping.get.ts": pingRoute,
  "server/routes/api/todos/index.get.ts": todosRoute,
  "server/routes/api/todos/index.post.ts": todosPostRoute,
};
