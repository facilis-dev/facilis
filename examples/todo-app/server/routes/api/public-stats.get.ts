import { count, eq } from "drizzle-orm";
import { defineAuthorizedHandler } from "@facilis.dev/core";
import { todos } from "~/db/schema";

// A public read for the prerendered landing page (D-202, issue #86): permission [] is what makes
// the page prerender-eligible. RLS still applies — the anonymous build pass and any logged-out
// visitor count only the rows the policy exposes, never private todos. No system elevation: the
// aggregate stays within the caller's row-level scope, so private data is never leaked.
export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: ["todos"],
    dbColumns: ["todos.done"],
    description: "Public aggregate todo counters for the prerendered landing page (RLS-scoped).",
  },
  async (_event, { db }) => {
    const [totalRow] = await db.select({ value: count() }).from(todos);
    const [doneRow] = await db.select({ value: count() }).from(todos).where(eq(todos.done, true));
    return { total: totalRow?.value ?? 0, done: doneRow?.value ?? 0 };
  },
);
