import { fileURLToPath } from "node:url";

// scripts/ is not a pnpm workspace member (pnpm-workspace.yaml is fixed), so these tests run
// through a member's vitest binary with the repo root as the project root.
export default {
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
};
