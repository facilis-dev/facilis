// The per-turn prompt context (D-045/D-048): the project as the model should see it.
//
// Kept beside ChatSession rather than inside it because the session file is close
// to the 300-line limit and this is a self-contained read: files, the open buffer,
// facilis.config.ts, the user's AGENTS.md and the live manifest (SPEC §9.1 Model A).
// Every source is best-effort — a project that is not running simply has no manifest.

import { aiWritePolicy } from "@/deploy/current";
import { fetchManifest } from "@/facilis/manifest-client";
import { INSTRUCTIONS_PATH } from "./instructions";
import type { PtcToolSpec } from "./ptc/protocol";
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

export interface ChatContextOptions {
  /** PTC tool specs; empty only in tests (the chat always has the runtime, D-103). */
  tools?: readonly PtcToolSpec[];
}

export async function buildChatContext(
  host: ContextHost,
  signal: AbortSignal,
  options: ChatContextOptions = {},
): Promise<ChatContext> {
  const files = host.files();
  const activeFile = await host.activeFile();
  const config = await host.read("facilis.config.ts");
  // An editor tab with unsaved AGENTS.md edits is what the user means right now.
  const instructions =
    activeFile?.path === INSTRUCTIONS_PATH
      ? activeFile.content
      : await host.read(INSTRUCTIONS_PATH);
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
      instructions:
        instructions.length > 0 ? { path: INSTRUCTIONS_PATH, content: instructions } : null,
      tools: options.tools ?? [],
      writePolicy: aiWritePolicy,
    }),
    context: {
      manifestRevision,
      files: files.length,
      activeFile: activeFile?.path ?? null,
      instructions: instructions.length > 0,
    },
  };
}
