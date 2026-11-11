import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [],
    description: "Health probe.",
  },
  async () => ({ ok: true }),
);
