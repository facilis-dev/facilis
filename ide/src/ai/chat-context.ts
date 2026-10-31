// The per-turn prompt context (D-045): the project as the model should see it.
//
// Kept beside ChatSession rather than inside it because the session file is close
// to the 300-line limit and this is a self-contained read: files, the open buffer,
// facilis.config.ts and the live manifest (SPEC §9.1 Model A). Every source is
// best-effort — a project that is not running simply has no manifest.

import { fetchManifest } from "@/facilis/manifest-client";
import { buildSystemPrompt } from "./prompt";
import type { ChatContextInfo } from "./types";

export interface ContextHost {
  /** Project-relative paths. */
  files(): readonly string[];
  read(path: string): Promise<string>;
  activeFile(): Promise<{ path: string; content: string } | null>;
  manifestBase(): string | null;
}

export interface ChatContext {
  system: string;
  context: ChatContextInfo;
}

export async function buildChatContext(
  host: ContextHost,
  signal: AbortSignal,
): Promise<ChatContext> {
  const files = host.files();
  const activeFile = await host.activeFile();
  const config = await host.read("facilis.config.ts");
  let manifest: Record<string, unknown> | null = null;
  let manifestRevision: string | null = null;
  const base = host.manifestBase();
  if (base !== null) {
    const result = await fetchManifest(base, { signal });
    if (result.ok) {
      manifest = result.envelope.manifest;
      manifestRevision = result.envelope.revision;
    }
  }
  return {
    system: buildSystemPrompt({
      manifest,
      manifestRevision,
      files,
      activeFile,
      configFile: config.length > 0 ? { path: "facilis.config.ts", content: config } : null,
    }),
    context: { manifestRevision, files: files.length, activeFile: activeFile?.path ?? null },
  };
}
