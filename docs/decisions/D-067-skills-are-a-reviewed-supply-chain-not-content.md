# D-067 — Skills are a reviewed supply chain, not content
**Status:** accepted (2026-11-01)

A skill is a versioned bundle that instructs the model for a class of tasks. Its text steers
code generation, so it has the reach of a dependency without the code a review usually reads.

**Decision.** A skill is a manifest (`skill.json`), instructions (`SKILL.md`) and resources,
with declared `capabilities` (read/write globs, tool subset, no network, command subset) that
act as a maximum enforced at the existing boundaries (context assembly, validator,
`applyPatch`, the tool router, the egress policy). Skills carry integrity and a publisher
signature, a deployment allowlist (`skills.allow`) and an approved version baseline, are
enabled by the user from the allowed set (never automatically), and update through the same
path as the app (D-065). Contract: `docs/AI-SKILLS.md` §8.

**Consequences:** an unapproved third-party skill is untrusted text and is never inserted into
the prompt; the deployment's skill catalog is a signed artifact like the mirror allowlist;
skill authoring and review become a process the product must support (capabilities shown,
diffs reviewed, changes attributable in git).
