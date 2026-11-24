# D-205 — The skills runtime is withdrawn and O-016 is closed
**Status:** accepted (2026-11-24)

**Context.** D-067 designed skills as a reviewed supply chain (a `skill.json` manifest,
`SKILL.md` instructions and declared capabilities); AI-SKILLS.md §8 records that design. The
skills runtime — catalog resolution, signature verification, the enablement UI and capability
enforcement at a skill seam — was never built: there is no skills module and no first-party
`SKILL.md` in the repository. O-016's core (the PTC tool runtime) was resolved by D-101 and
shipped always-on (D-103); the MCP client on the same seam shipped in D-118
(`ide/src/ai/mcp/*`, wired in `chat-host.ts`). The pending "skills runtime" claim conflated the
shipped PTC/MCP seam with the unbuilt skills surface.

**Decision.** Withdraw the skills runtime: no document presents it as shipped or pending.
O-016 is closed — the PTC core (D-101/D-103) and the MCP client (D-118) shipped, and the skills
extension is withdrawn. D-067's design stays as a historical design record (append-only);
AI-SKILLS.md §8 is kept as that record, not as a current contract. The remaining notes in
PTC.md §13 are operational watch-items on the shipped runtime, not a pending feature.

**Consequences.** The AI-SKILLS.md header states only the shipped surfaces (provider/gateway
policy, AI off by default in managed, the 19-rule validator, the PTC runtime and the MCP
client). If skills are wanted later, file a feature-request issue and a new decision. The MCP
settings UI and managed allowlist (PTC.md phase 3 remainder) are separate polish on the shipped
client, not the skills runtime.
