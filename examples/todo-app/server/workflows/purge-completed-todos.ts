import { z } from "zod";
import { defineWorkflow } from "@facilis/core";

// One default export per file: the #facilis/workflows virtual module imports it by path.
// The approval step suspends the chain on a manual task; a rejection fails the run (the
// reject branch is the definition's choice, docs/WORKFLOWS.md §8).
export default defineWorkflow({
  name: "purge-completed-todos",
  input: z.object({
    olderThanDays: z.number().int().positive().max(365).default(7),
  }),
  steps: [
    {
      approval: {
        titleKey: "workflows.purge.approval",
        params: ({ input }) => ({ days: input.olderThanDays }),
        // Assignment by permission: only a holder of tasks:decide may settle this task.
        permission: "tasks:decide",
      },
    },
    {
      job: "purge-completed-todos",
      input: ({ input }) => ({ olderThanDays: input.olderThanDays }),
    },
  ],
});
