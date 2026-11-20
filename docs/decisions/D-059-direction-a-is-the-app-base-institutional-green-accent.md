# D-059 — Direction A is the app base: institutional, green accent
**Status:** accepted (2026-10-31)

After the design lab (`examples/design-lab`, D-058 follow-up) the owner picked **A —
Institutional** as the base visual layer for generated apps: light-first neutrals, forest-green
primary (`#15803d` light, `#4ade80` with dark content in dark mode), one green signal accent,
dense but airy layout (control 38 / row 44 / sidebar 248 / page max 1280), radius 8/12, subtle
shadows, Geist Variable, designed light+dark.

The **brand layer remains open** (B violet or C warm, each light+dark) and is temporarily
rendered with A; when chosen, its complete theme blocks are added alongside the operations ones,
and auth/onboarding/empty states opt into them.

**Consequences:** the kit keeps one component set with role-based tokens; the lab's A tokens and
pattern CSS are promoted into `@facilis.dev/ui/theme.css`, the existing primitives are polished
(no API changes), the lab patterns (Card, StatCard, Tabs, Dialog, Switch, Avatar, Pagination,
TableToolbar, Menu, Skeleton) become kit components, and the gallery + todo app are restyled as
the first acceptance. Brand names stay out of the docs and code.
