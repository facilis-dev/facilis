// The controller-backed ChatHost (D-045): the glue between ChatSession and the
// editor. It owns the one-per-controller session, so a sidebar view switch keeps
// the conversation and the proposal, and reloading the page starts clean.
//
// Paths cross the boundary project-relative (the prompt and the patches are
// root-relative, SPEC §9.2); the editor speaks absolute VFS paths. Do the
// conversion here, once, instead of in every consumer.

import type { IdeController } from "@/vv/controller";
import { isDiffTabId } from "@/vv/synthetic-tabs";
import { previewSrcFor } from "@/vv/preview-url";
import { analyzePatches } from "@/facilis/patch-analysis";
import { ChatSession, type ChatHost } from "./chat-session";
import { createAnalyzerSyntaxChecker } from "./analyzer-syntax";
import { createGitAccess } from "./git-access";
import { createGraphAccess } from "./graph-access";
import { createGraphViewAccess } from "./graph-view-access";
import { createPreviewAccess } from "./preview-access";
import { createPtcRunner } from "./ptc/runner";
import { createRunnerFrameChild } from "./ptc/runner-frame";
import { createToolRouter } from "./ptc/tools";
import { withMcpTools } from "./mcp/mcp-executor";
import { McpSession } from "./mcp/mcp-session";

const sessions = new WeakMap<IdeController, ChatSession>();

/** The chat session for an IDE instance (created on first use). */
export function chatFor(controller: IdeController): ChatSession {
  const existing = sessions.get(controller);
  if (existing) return existing;
  // D-118: the project's MCP servers live with the chat session; their tools merge into the
  // existing router, so every local tool keeps its own policy and write protection.
  const mcp = new McpSession({ root: () => controller.activeFolder?.rootPath ?? null });
  const host = chatHost(controller, mcp);
  // D-126: the graph's committed team state; D-139: the project's git repository and remotes.
  // Only the PTC router reads them, so they join the PatchValidationHost view here and the
  // ChatHost contract (chat-session-types.ts) stays put.
  const toolHost = {
    ...host,
    graph: createGraphAccess(controller),
    git: createGitAccess(controller),
  };
  // D-103: the tool runtime is the chat's only mode. The runner holds no cross-turn state:
  // its sandbox frame is created and removed per program.
  const session = new ChatSession(host, {
    runner: createPtcRunner({
      childFactory: createRunnerFrameChild(),
      executorFactory: () => withMcpTools(createToolRouter(toolHost), mcp),
    }),
  });
  sessions.set(controller, session);
  return session;
}

function chatHost(controller: IdeController, mcp: McpSession): ChatHost {
  const root = (): string | null => controller.activeFolder?.rootPath ?? null;
  const relative = (absolute: string): string => {
    const base = root();
    if (base === null) return absolute;
    return absolute.startsWith(base + "/") ? absolute.slice(base.length + 1) : absolute;
  };
  const absolute = (relativePath: string): string => {
    const base = root();
    if (base === null) return relativePath;
    return base.replace(/\/+$/, "") + "/" + relativePath.replace(/^\/+/, "");
  };
  return {
    root,
    bridge: controller.bridge,
    files: () => {
      const snapshot = controller.getSnapshot();
      const base = root();
      const files = snapshot.files;
      if (base === null) return files;
      // ChatHost paths are project-relative; the snapshot's are absolute.
      return files
        .filter((path) => path.startsWith(base + "/"))
        .map((path) => path.slice(base.length + 1));
    },
    read: (path) => controller.readFileText(absolute(path)).catch(() => ""),
    async activeFile() {
      const active = controller.getSnapshot().activeTab;
      if (active === null || isDiffTabId(active)) return null;
      const model = controller.editorSession.editor()?.getModel();
      // The Monaco model, not the VFS copy: the assistant must see unsaved edits.
      if (model && model.uri.path === active)
        return { path: relative(active), content: model.getValue() };
      const content = await controller.readFileText(active);
      return content.length > 0 ? { path: relative(active), content } : null;
    },
    manifestBase() {
      const snapshot = controller.getSnapshot();
      const tabs = snapshot.previewTabs;
      const tab =
        tabs.find((entry) => entry.id === snapshot.activePreviewId) ??
        tabs.find((entry) => entry.port !== null);
      if (!tab || tab.port === null) return null;
      return previewSrcFor(controller.bridge, tab);
    },
    openFile: (path) => {
      void controller.openEntry(absolute(path));
    },
    // Rule 1's parser: the framework analyzer (oxc), the same parser that produces the
    // facts the other rules read. Monaco is the editor's viewer, not the validator's parser.
    syntaxChecker: () => createAnalyzerSyntaxChecker(),
    // D-111: the running preview, so a program can inspect and drive the app itself.
    preview: createPreviewAccess(controller.preview),
    // D-171: the graph's visible view, so a program can focus it, search it and screenshot it.
    graphView: createGraphViewAccess(controller),
    // D-118: the project's MCP servers are discovered once, before a turn's tool list.
    prepare: () => mcp.ensureFresh(),
    // The 17-rule validator reads analyzer facts: the worker analyzes the project before and
    // after the proposal; a thrown error blocks validation.
    analyze: (patches, signal) => analyzePatches(controller, patches, signal),
  };
}
