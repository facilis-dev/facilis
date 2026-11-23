#!/usr/bin/env node
// Runs the built Nitro server (arm A) on the preview port: prerendered files for
// allowlisted routes, the runtime renderer (SPA shell) for everything else.
process.env.PORT = process.argv[2] ?? "4173";
process.env.NITRO_PORT = process.env.PORT;
process.env.HOST = "127.0.0.1";
await import("../.output/server/index.mjs");
