import { defineAuthorizedHandler } from "@facilis/core";

// `as const` exercises the analyzer's static reader through the rolldown parser adapter.
const tables = ["todos"] as const;

export default defineAuthorizedHandler(
  {
    permission: "todos:read",
    dbTables: tables,
    description: "Same-file const table list, read statically by the analyzer.",
  },
  async () => tables,
);
