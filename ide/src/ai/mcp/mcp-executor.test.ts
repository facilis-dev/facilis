import { describe, expect, it } from "vitest";
import type { PtcJson, PtcToolExecutor } from "../ptc/protocol";
import { withMcpTools } from "./mcp-executor";

const base: PtcToolExecutor = {
  specs: () => [{ name: "read_file", signature: "read_file({ path })", description: "Read." }],
  execute: async (call) => ({ tool: call.name }),
};

const calls: string[] = [];
const source = {
  specs: () => [{ name: "mcp_test_ping", signature: "mcp_test_ping()", description: "Ping." }],
  call: async (name: string, args: Record<string, unknown>): Promise<PtcJson> => {
    calls.push(name + ":" + JSON.stringify(args));
    return { pong: true };
  },
};

describe("withMcpTools", () => {
  it("advertises both registries", () => {
    const executor = withMcpTools(base, source);
    expect(executor.specs().map((spec) => spec.name)).toEqual(["read_file", "mcp_test_ping"]);
  });

  it("routes local names to the router and mcp_ names to the session", async () => {
    const executor = withMcpTools(base, source);
    expect(await executor.execute({ name: "read_file", args: { path: "a" } }, {})).toEqual({
      tool: "read_file",
    });
    expect(await executor.execute({ name: "mcp_test_ping", args: { ping: 1 } }, {})).toEqual({
      pong: true,
    });
    expect(calls).toEqual(['mcp_test_ping:{"ping":1}']);
  });

  it("refuses arguments that are not one object", async () => {
    const executor = withMcpTools(base, source);
    await expect(executor.execute({ name: "mcp_test_ping", args: "nope" }, {})).rejects.toThrow(
      /one JSON object/,
    );
  });
});
