import { describe, expect, it } from "vitest";
import type { Analysis } from "@facilis.dev/ai";
import type { PatchContextHost } from "../patch-context";
import { createToolRouter } from "./tools";

const analysis = {
  files: [],
  tables: [],
  routes: [],
  pages: [],
  config: {},
  blocks: [],
} as unknown as Analysis;

function host(read: (path: string) => Promise<string>): PatchContextHost {
  return {
    files: () => [],
    read,
    manifestBase: () => null,
    analyze: async () => ({ before: analysis, after: analysis }),
  };
}

describe("read_file under node_modules (D-182)", () => {
  it("reads an installed dependency's source through the same tool", async () => {
    const router = createToolRouter(
      host(async (path) =>
        path === "node_modules/@facilis.dev/db/package.json" ? '{"name":"@facilis.dev/db"}' : "",
      ),
    );
    const result = (await router.execute(
      { name: "read_file", args: { path: "node_modules/@facilis.dev/db/package.json" } },
      {},
    )) as { content: string; truncated: boolean };
    expect(result.content).toContain("@facilis.dev/db");
  });

  it("still refuses a credential file inside a dependency", async () => {
    const router = createToolRouter(host(async () => "secret"));
    await expect(
      router.execute({ name: "read_file", args: { path: "node_modules/pkg/.env" } }, {}),
    ).rejects.toThrow(/excluded|credential|secret/i);
  });
});
