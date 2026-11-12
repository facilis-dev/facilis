// The run manifest the IDE hands the kernel for a project it creates or opens.
//
// This is the runtime contract with `vv-create-project` / `vv-register-project` and the
// preview proxy — not a picker's metadata. The picker's descriptors (label, description,
// loader) live in `facilis/templates.ts` (D-168); what a template IS here is only how it
// runs. Imported projects get a manifest synthesized from their `package.json`
// (project-import.ts).
export interface ProjectManifest {
  /** Stable id. The kernel uses it to look up a shipped dependency lock, if any. */
  id: string;
  /** Title fallback for the kernel's project registry and the run narration. */
  name: string;
  /** The dev-server port the preview points at. */
  port: number;
  /** File (relative to the project root) opened in the editor after create/open. */
  entry: string;
  /** Install step (skipped automatically if node_modules already exists). */
  install: string;
  /** Dev command run after install. */
  dev: string;
  /** The dev server hot-updates in place (affects the status wording only). */
  hmr: boolean;
  /** An edit restarts the server / reloads the page, so in-page state is lost. */
  reload: boolean;
  /**
   * Preview-proxy contract, not a template feature: the SW must keep the
   * `/preview/<port>/` prefix for ports listed here. The Facilis template does not set
   * it (it is served at the origin root); kept so the preview plumbing stays coherent if
   * an imported project ever needs it.
   */
  keepPreviewPrefix?: boolean;
}

/** A project template: its run manifest plus every file, keyed by project-relative path. */
export interface ProjectTemplate {
  manifest: ProjectManifest;
  files: Record<string, string>;
}
