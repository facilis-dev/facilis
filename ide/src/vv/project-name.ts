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
