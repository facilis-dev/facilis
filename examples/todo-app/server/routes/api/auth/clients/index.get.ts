import { listApiClients } from "@facilis/auth";
import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["api-clients:read"],
    dbTables: ["api_clients"],
    description: "List API clients (the secret hash never leaves the server).",
  },
  async (_event, { db }) => listApiClients(db),
);
