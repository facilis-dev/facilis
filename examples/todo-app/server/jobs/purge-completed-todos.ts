import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { defineJob } from "@facilis/core";
import { todos } from "~/db/schema";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// One default export per file: the #facilis/jobs virtual module imports it by path.
export default defineJob({
  name: "purge-completed-todos",
  input: z.object({
    olderThanDays: z.number().int().positive().max(365).default(7),
  }),
  output: z.object({ deleted: z.number().int().nonnegative() }),
  // The sudo audit records what the job touches; the body runs as facilis_system (D-107).
  tables: ["todos"],
  maxAttempts: 2,
  timeoutMs: 10_000,
  async run({ data, db }) {
    // The system-scoped transaction bypasses the owner policy, so a purge is tenant-wide.
    const cutoff = new Date(Date.now() - data.olderThanDays * MS_PER_DAY);
    const deleted = await db
      .delete(todos)
      .where(and(eq(todos.done, true), lt(todos.createdAt, cutoff)))
      .returning({ id: todos.id });
    return { deleted: deleted.length };
  },
});
