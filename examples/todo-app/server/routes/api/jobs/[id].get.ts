import { z } from "zod";
import { defineAuthorizedHandler, fail } from "@facilis/core";

export default defineAuthorizedHandler(
  {
    permission: ["jobs:read"],
    params: z.object({ id: z.uuid() }),
    dbTables: ["facilis_jobs"],
    description: "Read one background job by id (queue state is server-side).",
  },
  async (_event, { params, jobs }) => {
    const job = await jobs.get(params.id);
    if (job === null) return fail("not_found");
    return job;
  },
);
