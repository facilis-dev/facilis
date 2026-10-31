// A project is named by its directory, and by nothing else.
//
// The create/import flows used to carry a second name for display — the form's "Project
// name", the manifest title handed to the kernel, the registry's stored `name` — and the
// two could drift. Measured: a project whose Directory field was `.../facilis-ts-appx`
// showed in the Explorer as "facilis-ts-app", indistinguishable from the project already
// open beside it. Every place that labels a project now goes through projectName().
export function projectName(rootPath: string): string {
  const path = rootPath.replace(/\/+$/, "");
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base || "/";
}

/**
 * Whether a typed confirmation names this project exactly.
 *
 * Deleting a project destroys its files for good, so the dialog asks for the project's
 * name rather than a click-through. Trimmed, because trailing whitespace from a paste is
 * not a second thought; otherwise exact — a near miss must not delete the wrong folder.
 */
export function confirmsProjectName(rootPath: string, typed: string): boolean {
  return typed.trim() === projectName(rootPath);
}
