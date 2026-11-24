/**
 * Backend telemetry plugin (D-203 §1), registered by the Nitro module in every build and
 * disabled at boot unless the deploy enabled it.
 *
 * Disabled means absent: with no runtime installed there are no hooks, no tracer and no SDK,
 * so the process pays for one environment lookup.
 */
import { definePlugin } from "nitro";
import { useNitroHooks } from "nitro/app";

import { createHttpSpanHooks } from "../runtime/telemetry/http-span.ts";
import { bootstrapTelemetry } from "../runtime/telemetry/runtime.ts";

export default definePlugin(() => {
  const runtime = bootstrapTelemetry();
  if (runtime === null) return;

  const hooks = useNitroHooks();
  const http = createHttpSpanHooks(runtime.tracer);
  hooks.hook("request", (event) => http.request(event));
  hooks.hook("response", (response, event) => http.response(response, event));
});
