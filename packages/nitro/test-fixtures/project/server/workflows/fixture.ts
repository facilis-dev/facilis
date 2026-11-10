import { z } from "zod";
import { defineWorkflow } from "@facilis/core";

/**
 * Module-test fixture: a scanned workflow definition for `#facilis/workflows` (D-135).
 * Never executed by the nitro tests; it only has to look like a valid module.
 */
export default defineWorkflow({
  name: "fixture-flow",
  input: z.object({ id: z.string() }),
  steps: [{ job: "ping" }, { approval: { titleKey: "fixture.approve" } }],
});
