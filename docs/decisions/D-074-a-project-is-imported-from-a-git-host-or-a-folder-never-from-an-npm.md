# D-074 — A project is imported from a git host or a folder, never from an npm package
**Status:** accepted (2026-11-01)

The npm import treated a published package as a project source: the tab unpacked its tarball
and synthesized a Run manifest from whatever `package.json` it found. That is not a project.
It has no repository intent (no `.git`, no history, no source-layout contract), its dependency
tree is not resolved (a package's devDependencies are not the app's), and it carries no
`facilis.app.json`, so admission and the update comparison have nothing to check. The two
remaining import surfaces, a folder and a git host (D-073), carry the project's own sources and
its marker, and they cover "I have existing code" without a second remote protocol (npm
packument + tarball + tar/gzip decoding inside the tab).

**Decision.** Remove the npm package import. The dialog is a git-host import only;
`importNpmPackage`, `parseNpmSpec`, `fetchNpmPackage` and the local tar/gzip decoding are
gone, and `projects.imports.npm` leaves the deployment schema (an unknown key now fails
validation, which is where a stale config should fail).

**Consequences.** One fewer remote source and a smaller admission surface in the open
profile. A package's files can still be brought in by importing its repository, or by
importing a folder. `imports.git` remains the only remote import kind, and a managed build
still compiles it out (D-063).
