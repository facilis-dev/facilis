import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";

// The framework keeps the task API server-only (D-135, docs/WORKFLOWS.md §7); this route is
// the app's own authenticated inbox over it: the oldest pending request first.
export default defineAuthorizedHandler(
  {
    permission: ["tasks:read"],
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
    dbTables: ["facilis_tasks"],
    description: "List pending manual tasks, oldest first.",
  },
  async (_event, { query, tasks }) => {
    const rows = await tasks.list({ status: "pending", limit: query.limit ?? 50 });
    return { tasks: rows };
  },
);
