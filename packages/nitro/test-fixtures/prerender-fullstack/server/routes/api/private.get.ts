import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: ["stats:read"],
    dbTables: [],
    description: "Private fixture data — never prerendered.",
  },
  async () => ({ secret: true }),
);
