import { defineAuthorizedHandler } from "@facilis/core";

const handler = defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    params: { id: "uuid" },
    dbTables: ["todos"],
    dbColumns: ["todos.done"],
  },
  async () => null,
);

export default handler;
