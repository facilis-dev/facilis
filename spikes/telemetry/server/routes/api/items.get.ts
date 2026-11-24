import { defineHandler } from "nitro";
import { selectItems } from "../../lib/db";
import { getRequestTelemetry } from "../../lib/telemetry/event-context";

/**
 * The instrumented application route: a browser fetch reaches it and it hits the DB, so one
 * trace covers FE fetch → Nitro request → DB query.
 */
export default defineHandler((event) => ({
  items: selectItems(getRequestTelemetry(event)),
}));
