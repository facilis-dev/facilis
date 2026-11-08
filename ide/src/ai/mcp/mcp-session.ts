// Configured MCP servers and their discovered tools (docs/PTC.md §8, D-118).
//
// The configuration is per project: the user adds a remote Streamable-HTTP server, enables it
// explicitly, and the server's tools join the PTC registry as `mcp_<server>_<tool>`. Discovery
// is one cached `tools/list` per enabled server. The turn loop reads specs synchronously, so the
// session refreshes at boot and whenever the configuration changes, and a server that fails is
// reported as data (its error) instead of blocking the chat.

import {
  loadConfigs,
  saveConfigs,
  seedFromEnv,
  defaultStorage,
  type McpStorage,
} from "./mcp-config";
import {
  McpClient,
  isMcpError,
  type McpFetch,
  type McpServerConfig,
  type McpToolInfo,
} from "./mcp-client";
import { mcpErrorText, resultJson, specFor } from "./mcp-tools";
import { PtcToolError, type PtcJson, type PtcToolSpec } from "../ptc/protocol";

const MAX_TOOLS_PER_SERVER = 32;
/** Across servers: the prompt lists every spec, so the total has to stay bounded too. */
const MAX_TOTAL_TOOLS = 48;
const DISCOVERY_TIMEOUT_MS = 8_000;

/** One server as the settings UI and the discovery status expose it. */
export interface McpServerState {
  config: McpServerConfig;
  tools: readonly McpToolInfo[];
  /** Why the last discovery failed; null when it succeeded or has not run yet. */
  error: string | null;
  refreshing: boolean;
}

export interface McpSessionOptions {
  /** The open project's root path; the configuration is stored per project. */
  root(): string | null;
  fetch?: McpFetch;
  storage?: McpStorage | null;
  /** Called when a discovery starts or finishes, so a UI can re-render. */
  onChange?: () => void;
  timeoutMs?: number;
}

interface Discovery {
  tools: McpToolInfo[];
  error: string | null;
  refreshing: boolean;
}

export class McpSession {
  private readonly options: McpSessionOptions;
  private readonly storage: McpStorage | null;
  private readonly discoveries = new Map<string, Discovery>();
  private readonly clients = new Map<string, McpClient>();
  private readonly initialized = new Set<string>();
  private seed: McpServerConfig[] | null;
  /** undefined until the first turn: discovery is deferred until a project is open. */
  private lastRoot: string | null | undefined;

  constructor(options: McpSessionOptions) {
    this.options = options;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.seed = seedFromEnv();
  }

  /** The current project's configured servers (disabled ones included). */
  configs(): McpServerConfig[] {
    return loadConfigs(this.storage, this.options.root(), this.seed);
  }

  /** Replace the current project's servers; discovery restarts for the enabled ones. */
  async save(configs: readonly McpServerConfig[]): Promise<void> {
    this.seed = null;
    this.discoveries.clear();
    this.clients.clear();
    this.initialized.clear();
    this.lastRoot = this.options.root();
    saveConfigs(this.storage, this.options.root(), configs);
    await this.refresh();
  }

  /**
   * Discover the current project's servers once, at the first turn: the network round trip
   * belongs to opening a project, not to every message. A failed server keeps its error until
   * the next save or reload (the settings UI has an explicit refresh).
   */
  async ensureFresh(): Promise<void> {
    const root = this.options.root();
    if (this.lastRoot === root) return;
    this.lastRoot = root;
    await this.refresh();
  }

  /** The discovery status of every configured server, for the settings UI. */
  servers(): McpServerState[] {
    return this.configs().map((config) => {
      const discovery = this.discoveries.get(config.id);
      return {
        config,
        tools: discovery?.tools ?? [],
        error: discovery?.error ?? null,
        refreshing: discovery?.refreshing ?? false,
      };
    });
  }

  /** The tools of the enabled, successfully discovered servers, as PTC specs. */
  specs(): PtcToolSpec[] {
    const specs: PtcToolSpec[] = [];
    const names = new Set<string>();
    for (const config of this.configs()) {
      if (!config.enabled) continue;
      const discovery = this.discoveries.get(config.id);
      if (discovery === undefined) continue;
      for (const tool of discovery.tools) {
        if (specs.length >= MAX_TOTAL_TOOLS) break;
        const spec = specFor(config, tool);
        // Two servers may sanitise to the same name; the first one stays callable.
        if (names.has(spec.name)) continue;
        names.add(spec.name);
        specs.push(spec);
      }
    }
    return specs;
  }

  /** Discover every enabled server; a failure becomes that server's reported error. */
  async refresh(): Promise<void> {
    const enabled = this.configs().filter((config) => config.enabled);
    for (const config of enabled) {
      this.discoveries.set(config.id, { tools: [], error: null, refreshing: true });
    }
    this.options.onChange?.();
    await Promise.all(enabled.map((config) => this.discover(config)));
    this.options.onChange?.();
  }

  private async discover(config: McpServerConfig): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DISCOVERY_TIMEOUT_MS,
    );
    try {
      const client = this.clientFor(config);
      await client.initialize(controller.signal);
      this.initialized.add(config.id);
      const tools = (await client.listTools(controller.signal)).slice(0, MAX_TOOLS_PER_SERVER);
      this.discoveries.set(config.id, { tools, error: null, refreshing: false });
    } catch (error) {
      this.discoveries.set(config.id, {
        tools: [],
        error: isMcpError(error) ? error.message : String(error),
        refreshing: false,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Execute one `mcp_…` tool call from a program; unknown names are a capability error. */
  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<PtcJson> {
    const found = this.find(name);
    if (found === null) {
      throw new PtcToolError(
        "capability",
        "unknown MCP tool: " +
          name +
          "; its server is disabled, not connected, or was reconfigured — refresh the settings",
      );
    }
    const { config, tool } = found;
    const client = this.clientFor(config);
    try {
      if (!this.initialized.has(config.id)) {
        await client.initialize(signal);
        this.initialized.add(config.id);
      }
      const result = await client.callTool(tool.name, args, signal);
      if (result.isError) throw new PtcToolError("exception", mcpErrorText(result));
      return resultJson(result);
    } catch (error) {
      if (error instanceof PtcToolError) throw error;
      throw new PtcToolError(
        "exception",
        "MCP " + name + ": " + (isMcpError(error) ? error.message : String(error)),
      );
    }
  }

  private find(name: string): { config: McpServerConfig; tool: McpToolInfo } | null {
    for (const config of this.configs()) {
      if (!config.enabled) continue;
      const discovery = this.discoveries.get(config.id);
      if (discovery === undefined) continue;
      for (const tool of discovery.tools) {
        if (specFor(config, tool).name === name) return { config, tool };
      }
    }
    return null;
  }

  private clientFor(config: McpServerConfig): McpClient {
    const existing = this.clients.get(config.id);
    if (existing !== undefined) return existing;
    const client = new McpClient(
      { url: config.url, ...(config.token === undefined ? {} : { token: config.token }) },
      {
        ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
        ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
      },
    );
    this.clients.set(config.id, client);
    return client;
  }
}
