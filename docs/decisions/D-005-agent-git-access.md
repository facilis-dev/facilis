# D-005 — Agent git access
**Status:** accepted (2026-10-25)

A repo-scoped **deploy key** (`facilis-dsh-agent`, write access) is used for agent git
operations over SSH. It is revocable at any time from the repository settings. Commit
identity for this repo: `Michele Scala <scala233@gmail.com>` (matches existing history).
No personal SSH key or PAT is required.
