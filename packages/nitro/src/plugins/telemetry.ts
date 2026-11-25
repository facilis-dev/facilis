/**
 * Backend telemetry plugin (D-203 §1), registered by the Nitro module in every build and
 * disabled at boot unless the deploy enabled it.
 *
 * Disabled means absent: with no runtime installed there are no hooks, no tracer and no
 * exporter, so the process pays for one environment lookup and nothing else.
 */
import { definePlugin } from "nitro";
import { useNitroHooks } from "nitro/app";

import { createHttpSpanHooks } from "../runtime/telemetry/http-span.ts";
import { bootstrapTelemetry } from "../runtime/telemetry/runtime.ts";

export default definePlugin(() => {
  const installation = bootstrapTelemetry();
  if (installation === null) return;

  const hooks = useNitroHooks();
  const http = createHttpSpanHooks(installation.runtime.tracer);
  hooks.hook("request", (event) => http.request(event));
  hooks.hook("response", (response, event) => http.response(response, event));
  // The batch processor holds spans until its next tick; without this hook a rolling deploy
  // would lose the tail of every trace. Nitro awaits runtime hooks on graceful shutdown.
  hooks.hook("close", () => installation.shutdown());
});
