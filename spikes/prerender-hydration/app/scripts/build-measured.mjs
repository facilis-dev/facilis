#!/usr/bin/env node
// Measured build for the SPEC §13 risk 5 record: wall time + peak memory (guest
// view, sampled every 100 ms). The kernel-side view (__vv.diag heaps) is sampled
// by the host runner in parallel. Writes .spike/build-report.json.
import fs from "node:fs";
import * as vite from "vite";

const { version } = vite;

const arm = fs.readFileSync("spike-arm.txt", "utf8").trim();
const peak = { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 };
const timer = setInterval(() => {
  const m = process.memoryUsage();
  for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], m[key] ?? 0);
}, 100);
const startedAt = new Date().toISOString();
const t0 = Date.now();
let error = null;
try {
  // configLoader native: the config bundler's esbuild service cannot run in the
  // WebContainer (the template dev command carries the same flag).
  // createBuilder().buildApp() is the WHOLE-APP build: Nitro's server build and
  // prerenderer hang off the buildApp hook, which plain build() never calls.
  if (typeof vite.createBuilder === "function") {
    const builder = await vite.createBuilder({ configLoader: "native", logLevel: "info" });
    await builder.buildApp();
  } else {
    await vite.build({ configLoader: "native", logLevel: "info" });
  }
} catch (e) {
  error = e instanceof Error ? (e.stack ?? e.message) : String(e);
}
clearInterval(timer);
const report = {
  arm,
  vite: version,
  builderApi: typeof vite.createBuilder,
  node: process.version,
  arch: process.arch,
  platform: process.platform,
  startedAt,
  wallMs: Date.now() - t0,
  peakRssMb: +(peak.rss / 1048576).toFixed(1),
  peakHeapUsedMb: +(peak.heapUsed / 1048576).toFixed(1),
  error,
};
fs.mkdirSync(".spike", { recursive: true });
fs.writeFileSync(".spike/build-report.json", JSON.stringify(report, null, 2));
console.log("BUILD_REPORT " + JSON.stringify(report));
process.exit(error ? 1 : 0);
