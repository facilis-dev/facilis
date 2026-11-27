import { describe, expect, it } from "vitest";

import { createModuleGraph } from "../module-graph.ts";
import { createOxcParser } from "../node.ts";
import { NO_DIRECT_ENV, noDirectEnvDiagnostics } from "./no-direct-env.ts";

const PARSER = createOxcParser();

function scan(files: Record<string, string>) {
  return noDirectEnvDiagnostics(
    createModuleGraph({ files: new Map(Object.entries(files)), parser: PARSER }),
  );
}

describe("no-direct-env (D-224)", () => {
  it("warns on a server read and points at the runtime surface", () => {
    const diagnostics = scan({
      "server/reads.ts": "export const url = process.env.SOMETHING;",
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(NO_DIRECT_ENV);
    expect(diagnostics[0]?.message).toContain("ctx.runtime");
  });

  it("warns on a client read with the public surface", () => {
    const diagnostics = scan({ "src/config.ts": "export const key = process.env.API_KEY;" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("publicConfig()");
  });

  it("exempts the config files and anything outside src/ and server/", () => {
    const diagnostics = scan({
      "facilis.config.ts": "export const mode = process.env.MODE;",
      "vite.config.ts": "export const dev = process.env.NODE_ENV;",
      "db/schema.ts": "export const table = process.env.TABLE;",
    });
    expect(diagnostics).toEqual([]);
  });
});
