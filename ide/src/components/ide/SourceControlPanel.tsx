import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIde } from "./useIde";
import type { GitChange, RepoState } from "@/vv/scm-session";
import { hasGitIdentity, loadGitIdentity, saveGitIdentity } from "@/vv/git-config";
import { Panel, baseName } from "./SourceControlParts";
import { RepoSection } from "./SourceControlRepoSection";

export function SourceControlPanel() {
  const { c } = useIde();
  const scm = c.scm;
  const snap = useSyncExternalStore(scm.subscribe, scm.getSnapshot);

  // Dialog + collapse state is keyed by repo root so it works across sections.
  const [identityRoot, setIdentityRoot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [branchRoot, setBranchRoot] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [discardTarget, setDiscardTarget] = useState<{ root: string; change: GitChange } | null>(
    null,
  );
  const [discardAllRoot, setDiscardAllRoot] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Every row opens the HEAD ↔ working-tree diff; an untracked file diffs against
  // empty, so a new file still has something to review (D-088).
  const openChange = (ch: GitChange) => c.openDiff(ch.abs);
  // The hover action opens the file itself: editing a new file stays one click away.
  const openFile = (ch: GitChange) => void c.openEntry(ch.abs);

  const doCommit = async (repo: RepoState) => {
    const message = repo.commitMessage.trim();
    if (!message) return;
    if (!hasGitIdentity()) {
      const id = loadGitIdentity();
      setName(id?.name ?? "");
      setEmail(id?.email ?? "");
      setIdentityRoot(repo.root);
      return;
    }
    if (repo.staged.length === 0 && repo.changes.length > 0) await scm.stageAll(repo.root);
    await scm.commit(repo.root, message);
  };

  const saveIdentityAndCommit = async () => {
    if (!name.trim() || !email.trim() || !identityRoot) return;
    const root = identityRoot;
    saveGitIdentity({ name, email });
    setIdentityRoot(null);
    const repo = scm.getSnapshot().repos.find((r) => r.root === root);
    const message = repo?.commitMessage.trim();
    if (!repo || !message) return;
    if (repo.staged.length === 0 && repo.changes.length > 0) await scm.stageAll(root);
    await scm.commit(root, message, { name, email });
  };

  const toggleCollapse = (root: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });

  if (snap.repos.length === 0) {
    return (
      <Panel>
        <div className="p-3 text-xs leading-relaxed text-muted-foreground">
          Open a project to use Source Control.
        </div>
      </Panel>
    );
  }

  // Single repo → skip the outer collapse chrome and show it expanded, so the
  // common case stays as compact as before.
  const single = snap.repos.length === 1;

  return (
    <Panel>
      <ScrollArea className="min-h-0 flex-1">
        {snap.repos.map((repo) => (
          <RepoSection
            key={repo.root}
            repo={repo}
            scm={scm}
            collapsible={!single}
            collapsed={collapsed.has(repo.root)}
            onToggle={() => toggleCollapse(repo.root)}
            onOpenChange={openChange}
            onOpenFile={openFile}
            onOpenGraph={() => c.openCommitGraph(repo.root)}
            onCommit={() => void doCommit(repo)}
            onNewBranch={() => {
              setBranchRoot(repo.root);
              setBranchName("");
            }}
            onDiscard={(change) => setDiscardTarget({ root: repo.root, change })}
            onDiscardAll={() => setDiscardAllRoot(repo.root)}
          />
        ))}
      </ScrollArea>

      {/* create-branch dialog */}
      <Dialog
        open={branchRoot != null}
        onOpenChange={(o) => {
          if (!o) setBranchRoot(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>Branch off the current HEAD and switch to it.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && branchName.trim() && branchRoot) {
                void scm.createBranch(branchRoot, branchName.trim());
                setBranchRoot(null);
              }
            }}
            placeholder="feature/my-branch"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBranchRoot(null)}>
              Cancel
            </Button>
            <Button
              disabled={!branchName.trim()}
              onClick={() => {
                if (branchRoot) void scm.createBranch(branchRoot, branchName.trim());
                setBranchRoot(null);
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* git identity dialog (first commit) */}
      <Dialog
        open={identityRoot != null}
        onOpenChange={(o) => {
          if (!o) setIdentityRoot(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set your git identity</DialogTitle>
            <DialogDescription>
              Used as the author of your commits. Stored locally in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIdentityRoot(null)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || !email.trim()}
              onClick={() => void saveIdentityAndCommit()}
            >
              Save &amp; commit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* discard single */}
      <AlertDialog
        open={discardTarget != null}
        onOpenChange={(o) => {
          if (!o) setDiscardTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard changes to {discardTarget ? baseName(discardTarget.change.path) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is irreversible — the file is restored to its last committed state.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (discardTarget) void scm.discard(discardTarget.root, discardTarget.change);
                setDiscardTarget(null);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* discard all */}
      <AlertDialog
        open={discardAllRoot != null}
        onOpenChange={(o) => {
          if (!o) setDiscardAllRoot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard all{" "}
              {discardAllRoot
                ? (scm.getSnapshot().repos.find((r) => r.root === discardAllRoot)?.changes.length ??
                  0)
                : 0}{" "}
              changes?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This is irreversible — all unstaged changes are reverted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const root = discardAllRoot;
                setDiscardAllRoot(null);
                if (!root) return;
                const items =
                  scm
                    .getSnapshot()
                    .repos.find((r) => r.root === root)
                    ?.changes.slice() ?? [];
                void (async () => {
                  for (const ch of items) await scm.discard(root, ch);
                })();
              }}
            >
              Discard All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
