// "Reset everything" wipes every project, the dependency cache and the recent-projects
// list from this browser, and there is no undo — so it asks for a typed word, the policy
// D-050 set for deleting one project. Unlike a project name, the word names nothing: the
// action spans the whole origin, so it is a fixed token rather than a symbol to recall.
// What the dialog checks is that the user stopped and typed it.
export const RESET_CONFIRMATION = "RESET";

/**
 * Whether the typed text is the reset confirmation word.
 *
 * Trimmed and case-insensitive: the word identifies no folder, so a lowercase entry is
 * the same deliberate act — unlike a project name, where a near miss must not delete the
 * wrong one (confirmsProjectName).
 */
export function confirmsResetEverything(typed: string): boolean {
  return typed.trim().toUpperCase() === RESET_CONFIRMATION;
}
