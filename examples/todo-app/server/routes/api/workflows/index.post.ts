import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";

// The framework exposes ctx.workflows to server code only (D-135, WORKFLOWS §6); this route
// is the app's own authenticated surface over it.
export default defineAuthorizedHandler(
  {
    permission: ["todos:write"],
    body: z.object({
      olderThanDays: z.number().int().positive().max(365).default(7),
    }),
    // Starting inserts the workflow row and, on the first tick, the approval task.
    dbTables: ["facilis_workflows", "facilis_tasks"],
    description: "Start the purge-completed-todos workflow (approval, then purge).",
  },
  async (_event, { body, workflows }) => {
    const { id } = await workflows.start("purge-completed-todos", body);
    return { id };
  },
);
