import { z } from "zod";
import { defineAuthorizedHandler, fail, TaskError } from "@facilis/core";

// The manual flag is this decision write (D-135): decided_by comes from the session, never
// from the body, and a rejected task is the failure branch of the chain.
export default defineAuthorizedHandler(
  {
    permission: ["tasks:decide"],
    params: z.object({ id: z.uuid() }),
    body: z.object({
      decision: z.enum(["approve", "reject"]),
      comment: z.string().max(1000).optional(),
    }),
    dbTables: ["facilis_tasks"],
    description: "Record the decision on a pending manual task.",
  },
  async (_event, { params, body, tasks }) => {
    try {
      return await tasks.decide(params.id, {
        kind: body.decision,
        ...(body.comment === undefined ? {} : { comment: body.comment }),
      });
    } catch (error) {
      if (error instanceof TaskError) return fail(taskFailureCode(error.code));
      throw error;
    }
  },
);

/** Maps the task runtime codes onto the canonical API codes (O-002). */
function taskFailureCode(code: string): "not_found" | "conflict" | "invalid_input" | "db_unavailable" {
  switch (code) {
    case "task_not_found":
      return "not_found";
    case "task_already_decided":
    case "task_expired":
      return "conflict";
    case "task_invalid_input":
      return "invalid_input";
    default:
      return "db_unavailable";
  }
}
