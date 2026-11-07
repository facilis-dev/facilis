import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.done", "todos.ownerId"],
    description: "List todos.",
  },
  async () => ({ ok: true }),
);
