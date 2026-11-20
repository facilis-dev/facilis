# D-202 — Feature clusters derive from source facts; their state lives in the URL
**Status:** accepted (2026-11-20)

**Context.** Issue #62 (epic #56) groups the project graph's peer nodes into collapsible feature
clusters. The issue fixes the derivation order — "explicit route group or directory above routes/,
else first path segment, else the source folder; tables/views by schema prefix or folder; pages by
their route cluster" — but leaves two readings open: which directory "above routes/" names, and how
a page with calls into several features picks one. It also requires the collapse state to survive a
reload through the #58 view-state URL while .facilis/graph/ (v3) stays untouched, and expanding to
restore the exact previous positions (epic rule 2: spatial constancy).

**Decision.**

- **Derivation (graph-clusters.ts).** For a route, an explicit Nitro route group — a "(name)"
  directory segment the URL router strips, so only the source path carries it — wins; else the
  directory above the route file *inside* routes/ (the feature directory, e.g. "api/todos"); else
  the first URL path segment; else the source folder. Tables and views take the schema prefix (the
  part before the first underscore, "todo_files" → "todo") else their declaring folder. A page joins
  the cluster of the routes it calls: the most page-route edges wins, ties break lexicographically;
  a page that calls nothing grouped falls into "other". Workflows group by source folder. Whatever
  no rule groups lands in the visible "other" cluster (epic rule 5: unknown is a state, not a guess);
  a lone "other" cluster is not collapsible — collapsing it would empty the canvas.
- **State in the URL, not the document.** The group-by choice ("auto"/"on"/"off", auto on above 40
  nodes), the collapsed cluster ids and the drilled-into cluster ride the gv parameter (g/cc/d
  keys) beside the existing fields. Nothing writes .facilis/graph/: the layout file keeps positions,
  curves and notes only, and is not re-versioned.
- **Deterministic repack.** The clustered layout is a pure function of (analysis, saved pins,
  collapse set): frames wrap near 16:9 as variable-size boxes, members keep the semantic layer order
  inside them, and a collapse repacks the smaller super-node boxes. Expanding therefore restores the
  exact previous positions, because the same inputs rebuild the same layout. Saved pins stay absolute
  overrides and grow their frame so every child stays inside it (extent: "parent").
- **Search and drill.** A search auto-expands every cluster holding a match and dims the rest; the
  user's collapse list is untouched. Double-click drills into a cluster (breadcrumb in the #57 HUD,
  Esc up one level), forcing it open and dimming outsiders without moving anything. G toggles
  grouping, C collapses the drilled or selected cluster.
- **Boundary edges.** A collapse hides the children, drops internal edges and re-anchors crossings
  to the cluster border; parallel crossings of one kind between the same endpoints aggregate into a
  single edge carrying their count, and the super-node shows the total crossing its boundary.

**Consequences.** The flat wrapped-layer layout (#61) is unchanged when grouping is off; the
screenshot scene draws frames and super-nodes so the AI tool sees the same picture. Clusters are
derived, never edited: creating or removing real nodes stays out of scope (epic #56 non-goals).
