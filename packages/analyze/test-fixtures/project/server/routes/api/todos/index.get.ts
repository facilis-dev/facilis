import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({ done: z.boolean().optional() }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done", "todos.ownerId"],
    description: "List todos",
  },
  async (_event, { db }) => db,
);
