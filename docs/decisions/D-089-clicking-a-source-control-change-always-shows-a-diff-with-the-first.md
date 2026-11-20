# D-089 — Clicking a Source Control change always shows a diff, with the first hunk revealed
**Status:** accepted (2026-11-02)

Clicking a change in the SCM panel sometimes looked like it did nothing. Two independent causes:
untracked files (which is every file of a fresh repository before the first commit) were routed
to the plain editor, so there was no diff to show; and Monaco's diff editor opens at line 1 and,
below roughly 900 px of editor width, silently falls back to inline mode and hides the original
pane. On a long file the change could be several screens below the fold, so the tab read as a
copy of the file.

**Decision.** Every change opens the HEAD ↔ working-tree diff, and the diff makes the change
visible.

- **Every row is a diff.** Both sections (staged and unstaged) and every letter now call
  `openDiff`; an untracked file diffs from empty and a deleted one against empty. A hover
  "open file" action on each row keeps one-click editing (`openEntry`), and the row keeps the
  path as its tooltip.
- **Always two panes.** `useInlineViewWhenSpaceIsLimited: false` in the diff editor: the inline
  fallback hides the original version, and comparing the two is the point of the tab.
- **Reveal the first hunk.** After `setModel`, `revealFirstDiff()` scrolls the first change
  into view, so opening the diff is independent of where in the file the change is.
- **Split for the ratchet.** The diff editor moved from `controller.ts` to `vv/diff-session.ts`
  (one instance, owns its throwaway original/modified models, disposal on remount), and the SCM
  panel was split into `SourceControlPanel.tsx` + `SourceControlRepoSection.tsx` +
  `SourceControlParts.tsx` so the baseline entry could be dropped. New strings live in
  `en/it-source-control.ts`; the diff tab label is translated too.

**Rejected alternatives.** Keeping untracked files on the plain editor and adding a "view diff"
command: the reported action is the row click, and every other git GUI treats it as "show me
what changed". Inline-only diffs: they hide the original. Revealing the hunk only for tracked
files: uniform behaviour is simpler, and a new file's hunk is line 1 anyway. Making the diff tab
editable: it is a read-only view by design (D-078/D-079 trust boundary), and the open-file
action is the edit path.

**Consequences.** The diff tab stays read-only; editing still goes through the editor or the
Explorer. At a narrow editor width the two panes wrap more (word wrap follows the editor setting),
which is the trade for always seeing both versions. Untracked rows now cost a diff tab instead of
a plain tab — the same click count, since the open-file action is on the row.

**Verification.** Browser run on a change at the end of a 62-line file: both panes mount (346 px /
347 px at 1440 px), the first change is line 62 and the revealed view covers lines 22–64, an
untracked file diffs from an empty original, and the row's open-file action opens the editable
text tab. No page errors, no failed requests; the IDE suite is 595 tests and the full gate set is
green.
