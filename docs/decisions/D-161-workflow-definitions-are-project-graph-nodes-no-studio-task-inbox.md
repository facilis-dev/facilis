# D-161 — Workflow definitions are project-graph nodes; no Studio task inbox
**Status:** accepted (2026-11-10).

Owner request (2026-11-10): workflows should appear only in the project graph, with no new
"Attività" tab. The graph (D-092/D-134) is already the single static visualizer of the project,
built from `@facilis.dev/analyze` facts without booting the app. A tasks inbox in the Studio would
need a transport to the app's own authorized routes (session, page context, caching) and would
duplicate a surface the app owns; the tasks API deliberately has no framework HTTP endpoint
(D-135).

**Decision.** Add a `workflow` graph node kind. A pass reads each `server/workflows/**` default
export (a `defineWorkflow()` call from `@facilis.dev/core`): the name, the ordered steps with their
kind (`job`/`approval`), the job name or approval title key, the approval assignment permission and
the forward `onReject.step`. Unreadable fields stay explicit (`name: null` plus unknown facts),
and a file whose default export is not a `defineWorkflow` call is a `workflow-definition` warning,
never a crash. The graph renders the definitions in a fourth column with a per-step inspector;
there are no edges yet, because a workflow references jobs by name and jobs are not graph nodes.

**Consequences.** The graph is a definition view, not a run view: instance status and progress stay
in `facilis_workflows` and in the app's own UI. Static extraction covers literals and consts;
computed values show as unknown instead of guessing. Adding jobs as graph nodes later can add a
workflow→job edge without changing this node.
