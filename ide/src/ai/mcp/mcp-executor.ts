// Merge an MCP session's tools into the PTC router (docs/PTC.md §8, D-118).
//
// The router owns the local, read-only tools; an MCP session owns the remote ones. This wrapper
// is the seam: the prompt advertises both, and a program's `tools.mcp_…(args)` call reaches the
// session while every existing name keeps going through the router untouched. Write protection
// is unchanged either way — a remote tool effect is not a project write.

import {
  PtcToolError,
  type PtcJson,
  type PtcToolCall,
  type PtcToolExecutor,
  type PtcToolSpec,
} from "../ptc/protocol";

export interface McpToolSource {
  specs(): readonly PtcToolSpec[];
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<PtcJson>;
}

export function withMcpTools(base: PtcToolExecutor, source: McpToolSource): PtcToolExecutor {
  return {
    specs: () => {
      const extra = source.specs();
      return extra.length === 0 ? base.specs() : [...base.specs(), ...extra];
    },
    async execute(call: PtcToolCall, options: { signal?: AbortSignal }): Promise<PtcJson> {
      const spec = source.specs().find((entry) => entry.name === call.name);
      if (spec === undefined) return base.execute(call, options);
      const args = call.args;
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new PtcToolError(
          "capability",
          spec.name + " " + spec.signature + ": arguments must be one JSON object",
        );
      }
      return source.call(spec.name, args as Record<string, unknown>, options.signal);
    },
  };
}
