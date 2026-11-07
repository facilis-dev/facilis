import { defineAuthorizedHandler } from "@facilis/core";
import { TODO_TABLES } from "../../../lib/route-config";

const config = {
  permission: ["todos:write"],
  body: { title: "string" },
  dbTables: TODO_TABLES,
  description: "Create a todo",
};

export default defineAuthorizedHandler(config, async (_event, { body }) => body);
