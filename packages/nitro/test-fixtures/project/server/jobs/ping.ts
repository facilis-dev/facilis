import { z } from "zod";
import { defineJob } from "@facilis/core";

/**
 * Module-test fixture: a scanned job definition for `#facilis/jobs` (D-107).
 * Never executed by the nitro tests; it only has to look like a valid module.
 */
export default defineJob({
  name: "ping",
  input: z.object({ message: z.string().default("pong") }),
  output: z.object({ ok: z.boolean() }),
  tables: [],
  run: () => ({ ok: true }),
});
