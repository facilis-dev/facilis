import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: ["todos:write", "todos:read"],
    dbTables: ["todos"],
    dbColumns: ["todos.title"],
    description: "Update a todo.",
  },
  async () => ({ ok: true }),
);
