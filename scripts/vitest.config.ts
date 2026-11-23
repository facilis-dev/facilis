import { fileURLToPath } from "node:url";

// scripts/ is not a pnpm workspace member (pnpm-workspace.yaml is fixed), so these tests run
// through a member's vitest binary with the repo root as the project root.
export default {
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
    // The lifecycle tests spawn real process trees and wait for a group to be reaped, which
    // outruns Vitest's 5 s default on a loaded CI runner (issue #153).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
};
