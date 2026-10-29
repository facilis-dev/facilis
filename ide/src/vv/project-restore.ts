// A project's files live both in this tab's VFS and on OPFS. The boot restore is scoped
// (D-036): every project Home knows about is deferred (BootOptions.deferRestoreRoots) and
// replayed only when a tab opens it, so opening one can find its subtree missing from the
// VFS even though it is safely on OPFS. This is that replay, outside IdeController (whose
// size the file-length ratchet pins).
import type { KernelBridge } from "./kernel";
import { projectName } from "./project-name";

type Stat = (abs: string) => Promise<{ exists: boolean }>;

async function replay(
  bridge: KernelBridge,
  root: string,
  status: (line: string) => void,
): Promise<void> {
  try {
    const res = await bridge.request("vv-restore-roots", { roots: [root] });
    const count = typeof res.count === "number" ? res.count : 0;
    if (count > 0) status(`restored ${count} saved files in ${projectName(root)}`);
  } catch {
    // A VFS that cannot answer leaves the caller's stat as the decision: retrying is
    // the caller's job, and a dead kernel has bigger problems than this message.
  }
}

/**
 * Make `root` readable in this tab's VFS and report whether it exists afterwards.
 * Replays before every retry: a project another tab created moments ago may still be in
 * that tab's write-behind mirror rather than on OPFS, and calling it deleted would drop
 * it from Home.
 */
export async function ensureProjectOnDisk(
  bridge: KernelBridge,
  root: string,
  stat: Stat,
  status: (line: string) => void,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await stat(root)).exists) return true;
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    await replay(bridge, root, status);
  }
  return (await stat(root)).exists;
}
