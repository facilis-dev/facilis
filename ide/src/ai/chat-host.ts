// The controller-backed ChatHost (D-045): the glue between ChatSession and the editor.
// It owns the one-per-controller conversation store (chat-store.ts), so a sidebar view switch
// keeps the conversation and a new chat keeps the previous one; reloading starts clean.
//
// Paths cross the boundary project-relative (the prompt and the patches are
// root-relative, SPEC §9.2); the editor speaks absolute VFS paths. Do the
// conversion here, once, instead of in every consumer.

import type { IdeController } from "@/vv/controller";
import { isDiffTabId } from "@/vv/synthetic-tabs";
import { previewSrcFor } from "@/vv/preview-url";
import { analyzePatches } from "@/facilis/patch-analysis";
import { writeProjectAsset } from "@/facilis/vfs-write";
import { webAccess as deploymentWebAccess } from "@/deploy/current";
import { createChatWrites } from "./chat-writes";
import { ChatSession, type ChatHost } from "./chat-session";
import { createGitCheckpoint } from "./git-checkpoint";
import type { GitSafety } from "./types";
import { ChatStore } from "./chat-store";
import { createAnalyzerSyntaxChecker } from "./analyzer-syntax";
import { createGitAccess } from "./git-access";
import { createGraphAccess } from "./graph-access";
import { createGraphViewAccess } from "./graph-view-access";
import { createPreviewAccess } from "./preview-access";
import { createPtcRunner } from "./ptc/runner";
import { createRunnerFrameChild } from "./ptc/runner-frame";
import { PtcToolError } from "./ptc/protocol";
import { createToolRouter } from "./ptc/tools";
import { createWebAccess } from "./web-access";
import { withMcpTools } from "./mcp/mcp-executor";
import { McpSession } from "./mcp/mcp-session";

const stores = new WeakMap<IdeController, ChatStore>();

/** The conversations of an IDE instance (created on first use). */
export function chatStoreFor(controller: IdeController): ChatStore {
  const existing = stores.get(controller);
  if (existing) return existing;
  // D-118: the project's MCP servers are discovered once per controller and shared by every
  // conversation; their tools merge into the existing router, so every local tool keeps its
  // own policy and write protection.
  const mcp = new McpSession({ root: () => controller.activeFolder?.rootPath ?? null });
  const store = new ChatStore(() => createSession(controller, mcp));
  stores.set(controller, store);
  return store;
}

/** The active conversation's session, for view consumers such as the ActivityBar. */
export function chatFor(controller: IdeController): ChatSession {
  return chatStoreFor(controller).active();
}

/** Absolute VFS path of the open project, or null. */
function projectRoot(controller: IdeController): string | null {
  return controller.activeFolder?.rootPath ?? null;
}

function createSession(controller: IdeController, mcp: McpSession): ChatSession {
  const safety = createGitSafety(controller);
  const host = { ...chatHost(controller, mcp), gitSafety: safety };
  // D-175: the compiled deployment decides whether the web family exists at all; managed
  // with no declared origin compiles it out (deploymentWebAccess === null). The writer
  // converts the tool layer's project-relative path into the VFS's absolute one.
  const web =
    deploymentWebAccess === null
      ? null
      : createWebAccess({
          policy: deploymentWebAccess,
          pageOrigin: location.origin,
          writeAsset: (relativePath, bytes) => {
            const root = projectRoot(controller);
            if (root === null) {
              throw new PtcToolError("capability", "no project is open: a download needs one");
            }
            return writeProjectAsset({
              bridge: controller.bridge,
              root,
              path: relativePath,
              bytes,
            });
          },
        });
  const sessionHost: ChatHost = web === null ? host : { ...host, web };
  // D-126: the graph's committed team state; D-139: the project's git repository and remotes.
  // Only the PTC router reads them, so they join the PatchValidationHost view here and the
  // ChatHost contract (chat-session-types.ts) stays put.
  const writes = createChatWrites({ ...sessionHost, safety });
  const toolHost = {
    ...sessionHost,
    graph: createGraphAccess(controller),
    git: createGitAccess(controller),
    writes,
  };
  // D-103: the tool runtime is the chat's only mode. The runner holds no cross-turn state:
  // its sandbox frame is created and removed per program.
  return new ChatSession(sessionHost, {
    runner: createPtcRunner({
      childFactory: createRunnerFrameChild(),
      executorFactory: () => withMcpTools(createToolRouter(toolHost), mcp),
    }),
    writes,
  });
}

/** Git safety for AI writes (D-181): Source Control's own commits, plus a refresh after a restore. */
function createGitSafety(controller: IdeController): GitSafety {
  const checkpoint = createGitCheckpoint({
    bridge: controller.bridge,
    root: () => projectRoot(controller),
    commit: async (root) => {
      await controller.scm.stageAll(root);
      const committed = await controller.scm.commit(root, "chore: save work before AI changes");
      const repo = controller.scm.getSnapshot().repos.find((entry) => entry.root === root);
      return committed ? { ok: true } : { ok: false, error: repo?.error ?? "The commit failed." };
    },
    init: async (root) => {
      await controller.scm.init(root);
      return { ok: true };
    },
  });
  // A git-fs checkout is silent (it does not broadcast vv-fs-changed), so the turn Undo must
  // ask the controller to reload the worktree exactly as Source Control does after a discard.
  return {
    gate: () => checkpoint.gate(),
    commitAll: () => checkpoint.commitAll(),
    init: () => checkpoint.init(),
    restore: async (paths) => {
      const result = await checkpoint.restore(paths);
      controller.scm.onWorkdirChanged?.();
      return result;
    },
  };
}

function chatHost(controller: IdeController, mcp: McpSession): ChatHost {
  const root = (): string | null => projectRoot(controller);
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
    analyze: (patches, signal, overlay) => analyzePatches(controller, patches, signal, overlay),
  };
}
