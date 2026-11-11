import { z } from "zod";
import { defineAuthorizedHandler } from "@facilis/core";

// The framework exposes ctx.jobs to server code only (D-107, JOBS §6); this route is the
// app's own authenticated surface over it. jobs:exec is checked here AND by the queue's RLS
// policy (D-145), so a route that forgets the permission still cannot enqueue.
export default defineAuthorizedHandler(
  {
    permission: ["jobs:exec"],
    // The definition re-validates its input at enqueue; this schema only shapes the body.
    body: z.object({
      olderThanDays: z.number().int().positive().max(365).optional(),
      runAt: z.iso.datetime({ offset: true }).optional(),
    }),
    dbTables: ["facilis_jobs"],
    description: "Enqueue a purge of completed todos, optionally at a future instant.",
  },
  async (_event, { body, jobs }) => {
    const { id } = await jobs.enqueue(
      "purge-completed-todos",
      { olderThanDays: body.olderThanDays ?? 7 },
      body.runAt === undefined ? undefined : { runAt: body.runAt },
    );
    return { id };
  },
);
