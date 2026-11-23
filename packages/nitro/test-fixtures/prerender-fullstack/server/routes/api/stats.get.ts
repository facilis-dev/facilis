import { defineAuthorizedHandler } from "@facilis.dev/core";

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [],
    description: "Public fixture stats for the prerender data step.",
  },
  async () => ({ count: 42, source: "public-api" }),
);
