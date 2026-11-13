// Git safety types for the AI's incremental source writes (D-181).
//
// Split out of types.ts (which is at the 300-line limit): the chat session, the write tools
// and the GitSafety seam all agree on these shapes, so they live beside the chat types and
// are re-exported from types.ts for the existing importers.

/** One entry of the clean-tree gate's change list. */
export interface ChatGitChange {
  path: string;
  letter: "A" | "M" | "D" | "U";
}

/** Why the git gate refused to let the AI write; the chat pauses for the user's choice. */
export type ChatGitGateFailure =
  | { code: "no-repo" }
  | { code: "no-head" }
  | { code: "dirty-tree"; changes: readonly ChatGitChange[] };

/** The pending clean-tree gate, as the chat card renders it. */
export interface ChatGitGateState {
  failure: ChatGitGateFailure;
  /** A commit attempt failed (for example no git identity); shown under the buttons. */
  error: string | null;
}

/** One source file the AI wrote in the live turn (summary and Undo). */
export interface ChatTurnWrite {
  path: string;
  action: "create" | "update" | "delete";
  /** A dropped table/column (rule 15) is part of this write. */
  destructive: boolean;
  added: number;
  removed: number;
}

/** The clean-tree gate result: HEAD to undo to, or the reason the AI may not write. */
export type GitGate = { ok: true; head: string } | { ok: false; failure: ChatGitGateFailure };

/**
 * Git safety for AI source writes (D-181): a clean tree with HEAD before the first write of
 * a turn, and a restore path for the turn's writes. The IDE implements it over Source
 * Control's own sessions; the chat and the write tool only see this contract.
 */
export interface GitSafety {
  /** HEAD plus a clean working tree, or why the AI may not write. */
  gate(): Promise<GitGate>;
  /** Stage everything and commit it (the card's "commit and continue"). */
  commitAll(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Initialize the repository for a project that has none. */
  init(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Restore the given project paths from HEAD (the turn's Undo). */
  restore(paths: readonly string[]): Promise<{ ok: boolean; errors: string[] }>;
}
