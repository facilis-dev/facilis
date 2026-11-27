import { defineAuthorizedHandler } from "@facilis.dev/core";
import { createDb } from "@facilis.dev/db";

export default defineAuthorizedHandler({ permission: [], dbTables: [] }, async () => createDb());
