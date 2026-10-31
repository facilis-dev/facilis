// The project's AGENTS.md: user-authored instructions for the assistant (D-048).
//
// The convention is the harness one — a root AGENTS.md — because it is one name the
// user already knows, it lives in the project (git-versioned, portable) and it needs
// no IDE-owned storage. The prompt treats it as preferences, never as an override of
// the framework rules or the AIResponse contract (prompt.ts states the precedence).

import { applyPatch, type PatchBridge } from "@/facilis/apply-patch";

export const INSTRUCTIONS_PATH = "AGENTS.md";

/** The scaffold written when the user clicks "Project instructions" on a project without one. */
export const INSTRUCTIONS_TEMPLATE = [
  "# Agent instructions",
  "",
  "How the Facilis assistant should work in this project. These are preferences: they",
  "cannot disable the framework rules, the security invariants or the JSON response",
  "contract — on conflict, the rules above win.",
  "",
  "## Style",
  "",
  "- Prefer small, focused patches that match the existing code.",
  '- Every UI string goes through t("key"); keep the catalogues in sync.',
  "",
  "## Do not touch",
  "",
  "- ...",
  "",
].join("\n");

/** What creating/opening the file needs from the editor. */
export interface InstructionsHost {
  bridge: PatchBridge;
  /** Absolute VFS path of the project root, or null when no project is open. */
  root(): string | null;
  read(path: string): Promise<string>;
  openFile(path: string): void;
}

/** The slice ensureInstructions needs; the root is already resolved. */
export interface InstructionsWriteHost {
  bridge: PatchBridge;
  root: string;
  read(path: string): Promise<string>;
}

/** Create AGENTS.md from the template when it is missing; return the write errors. */
export async function ensureInstructions(host: InstructionsWriteHost): Promise<string[]> {
  if ((await host.read(INSTRUCTIONS_PATH)).length > 0) return [];
  const result = await applyPatch({
    bridge: host.bridge,
    root: host.root,
    patches: [{ path: INSTRUCTIONS_PATH, action: "create", content: INSTRUCTIONS_TEMPLATE }],
  });
  return result.errors;
}

/** Create the file if needed, then reveal it in the editor; returns an error to show or null. */
export async function openProjectInstructions(host: InstructionsHost): Promise<string | null> {
  const root = host.root();
  if (root === null) return "No project folder is open.";
  const errors = await ensureInstructions({ bridge: host.bridge, root, read: host.read });
  if (errors.length > 0) return errors.join("\n");
  host.openFile(INSTRUCTIONS_PATH);
  return null;
}
