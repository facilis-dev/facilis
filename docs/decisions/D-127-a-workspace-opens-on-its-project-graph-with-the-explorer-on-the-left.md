# D-127 — A workspace opens on its project graph, with the Explorer on the left
**Status:** accepted (2026-11-09)

The project graph became a primary development surface (D-125): it is the one place that
answers "what is this project made of". Opening or creating a project, however, still
opened `src/app.tsx` in the editor — so the first thing a developer saw was one file out of
context, and the graph was a tab they had to discover.

**Decision.** `createProject` and `openProject` open (and focus) the project-graph tab
instead of the template entry file. The entry file is not opened implicitly any more: it is
one click away from the graph (double-click a node) and from the Explorer. The left sidebar
stays the **Explorer** by default. A fresh project has no saved viewport, so the graph fits
and centres itself; a project that already has a saved layout keeps that viewport, because
the arrangement is the user's (D-126) and silently re-fitting it on every open would throw
it away.

**Why Explorer and not the AI chat on the left.** The graph answers "what is this project",
the Explorer answers "where is this thing": they are complementary, and the left column is
the orientation slot. The chat is a working mode — it auto-widens the sidebar (AppShell) and
wants the conversation to be the focus; defaulting to it would force every first visit into
a chat before the user has a mental model of the project. The chat is one click away in the
activity bar (and `⌘K`), and the first-run tour (D-128) opens it at the moment it explains
what it is for.

**Rejected alternatives.** *Entry file by default*: it was the behaviour and it buries the
project overview. *Chat on the left by default*: it is a valid AI-first layout, but it is a
per-user preference, not a safe default — the activity bar already makes it a single click.
*Fit the graph on every open*: it would discard a saved layout. *A blank welcome tab*: one
more screen between the user and the project.

**Consequences.** The editor area is the graph on landing; tests and the smoke flow that
assumed an active file tab after opening a project are adjusted or made explicit. The tab
keeps its own id/title (D-087) and never becomes a file tab.
