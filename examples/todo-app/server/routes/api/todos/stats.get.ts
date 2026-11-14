import { z } from "zod";
import { gte } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis.dev/core";
import { todos } from "~/db/schema";
import { MAX_WEEKS, weekBuckets } from "../../../utils/week-buckets.ts";

const DAY_MS = 86_400_000;

export default defineAuthorizedHandler(
  {
    permission: ["todos:read"],
    query: z.object({
      weeks: z.coerce.number().int().min(1).max(MAX_WEEKS).default(8),
    }),
    dbTables: ["todos"],
    dbColumns: ["todos.createdAt"],
    description: "Todos created per week, zero-filled buckets for the chart (RLS-scoped).",
  },
  async (_event, { query, db }) => {
    const since = new Date(Date.now() - (query.weeks * 7 + 7) * DAY_MS);
    const rows = await db
      .select({ createdAt: todos.createdAt })
      .from(todos)
      .where(gte(todos.createdAt, since));
    return {
      buckets: weekBuckets(
        rows.map((row) => row.createdAt),
        query.weeks,
      ),
    };
  },
);
