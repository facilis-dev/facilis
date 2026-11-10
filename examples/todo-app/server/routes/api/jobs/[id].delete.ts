import { z } from "zod";
import { defineAuthorizedHandler, fail } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["jobs:exec"],
    params: z.object({ id: z.uuid() }),
    dbTables: ["facilis_jobs"],
    description: "Cancel a queued background job or abort a running one.",
  },
  async (_event, { params, jobs }) => {
    const cancelled = await jobs.cancel(params.id);
    if (!cancelled) return fail("not_found");
    return { cancelled: true };
  },
);
