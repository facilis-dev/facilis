# D-223 — Graph group overrides are per-node team state in `groups/<key>.json`
**Status:** accepted (2026-11-26)

**Context.** D-219 groups the map by feature: routes take their URL path (skipping the technical
`api` prefix), pages join the routes they call, and schema objects join their strongest
referrer. The rule is deterministic but not always what the user wants: a route can serve a
feature whose name is not its first path segment, a page can be a cross-cutting shell, and a
shared table can have several plausible homes. Issue #194 follow-up asks the user to see the
rule and to override the group for a route, page or table.

**Decision.**

1. The saved layout gains `groups: Record<nodeId, groupName>`, encoded as one small
   `.facilis/graph/groups/<key>.json` per pinned node (`{"id","group"}`), matching the
   positions/bends/notes merge strategy. An absent entry means "use the automatic rule"; there
   is no format change to the other files and no migration.
2. An override wins over every rule. It is applied before pages and schema objects resolve, so
   moving a route also moves the tables that referenced it unless they are pinned themselves.
3. `deriveDomainAssignments` returns the group, the reason (override, route path/file, page
   calls/directory/path, reference, framework, fallback) and the deciding fact. The inspector
   shows this and offers a group input plus an "Automatic" reset; the same override map feeds
   the canvas, the search jump and the inspector's cross-group answers.
4. The overrides survive "reset layout": they are grouping intent, not geometry.

**Consequences.** Teams can commit their feature map and fix a wrong automatic group without
editing code. A pinned node keeps its file until the user clears it; a renamed/removed node's
override is carried along rather than silently dropped, so it comes back if the node does.
