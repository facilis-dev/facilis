import { defineAuthorizedHandler } from "@facilis/core";

const tables = ["todos"];

export default defineAuthorizedHandler(
  {
    permission: "todos:read",
    dbTables: tables,
    description: "Imported table list: not statically resolvable.",
  },
  async () => tables,
);
