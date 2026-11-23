import { defineEventHandler } from "nitro/h3";
import { publicStats } from "../../../src/lib/public-api.ts";

// Public endpoint (permission: []-style): no auth, no session, no dbTables.
export default defineEventHandler(() => publicStats());
