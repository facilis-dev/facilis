import { defineAuthorizedHandler } from "../../utils/authorized.ts";

// A16 probe: meta is emitted by defineRouteMeta *inside* the wrapper body.
export default defineAuthorizedHandler(
  {
    permission: "todos:read",
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.ownerId"],
    description: "Wrapper-emitted metadata probe",
  },
  async (_event, { auth }) => {
    return { ok: true, userId: auth.userId };
  },
);
