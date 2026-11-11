import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: "todos:write",
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.ownerId"],
    description: "Create a todo for the current user.",
  },
  async () => ({ ok: true }),
);
