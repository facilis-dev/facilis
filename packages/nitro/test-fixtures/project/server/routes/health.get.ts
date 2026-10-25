import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [],
    description: "Health probe.",
  },
  async () => ({ ok: true }),
);
