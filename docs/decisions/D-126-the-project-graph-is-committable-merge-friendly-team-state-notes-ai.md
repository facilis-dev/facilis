# D-126 — The project graph is committable, merge-friendly team state (notes + AI graph tools)
**Status:** accepted (2026-11-08)

D-125 made the graph interaction-first, but the layout was local editor state: a single
gitignored `.facilis/graph.json`, no way to annotate the diagram, no way for the assistant to
work on it, and text selection fought node dragging. The graph is meant to be the primary
development surface beside chat, so the arrangement plus the team's annotations have to travel
with the repository — without turning every concurrent edit into a merge conflict.

**Decision.**
- **One element, one file.** The state moves to `.facilis/graph/`: `layout.json` holds the
  settings (`hiddenEdges`, `collapsed`), `positions/<key>.json` one small position per node or
  note, `bends/<key>.json` one manual bend per edge, and `notes/<uuid>.md` one markdown file per
  annotation. Pan/zoom is per machine and stays in `viewport.json`, git-ignored. A normal git
  3-way merge is therefore automatic for independent edits — moving two different nodes, or
  adding notes on two branches, does not conflict; only the same element conflicts, and then on
  one readable file. (Measured: a single JSONL file conflicted as soon as the two changed lines
  were adjacent, even for different nodes.)
- **The format is the merge strategy.** `.facilis/.gitignore` keeps `*` and gets a narrow,
  idempotently appended allowlist (`!graph/`, `!graph/**`, `graph/viewport.json`): the graph
  is committable, everything else in `.facilis` (database snapshot, binary blobs, logs — D-052)
  stays local. The file is never rewritten, only extended.
- **Migration.** A pre-D-126 `.facilis/graph.json` (schema v1/v2) is read once, written as the
  v3 files on the next save, and removed; `.facilis` is still excluded from export, publish and
  the search index.
- **Markdown notes.** A note is a React Flow node (`note:<uuid>`) with a markdown body in its
  own file; its geometry is a separate `positions/<key>.json`, so moving and editing a note are
  independent edits. The card renders the markdown (escaped before rendering, the notebook's
  renderer), double-click edits it, and an empty note opens ready to type.
- **AI graph tools.** The chat's PTC runtime gains `graph_state` (read the nodes/edges/notes
  with positions) and `graph_arrange` (moves, bends, notes, visibility) — validated, capped and
  written through the same `graph-layout` IO. They are not source patches: the §9.3 patch flow
  and its allowlist stay untouched, because the graph is diagram state, not project source. A
  successful write announces itself on `graph-live`, so the open panel reloads.
- **Selection.** The canvas and the cards are `select-none`; only the note editor allows text
  selection, so dragging or box-selecting no longer selects card text.

**Consequences:** the graph becomes team state that is committed from the IDE's git panel; git
is the sync mechanism (no server-side merge needed). Two branches that move the same node keep a
one-file conflict a human can resolve in seconds. No new dependency, no new write path outside
`.facilis`; the codec, migration and merge behaviour are pure and unit-tested.
