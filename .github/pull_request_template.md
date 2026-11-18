<!--
Title: Conventional Commits in English - feat|fix|chore|docs|test|refactor(scope): summary
Description: English, with the evidence below. Keep the checkboxes that apply; delete the rest.
-->

## Summary

<!-- What changes, why, and the user-visible effect. Two to four sentences. -->

## Linked issue

<!-- Closes #NNN. An AI agent may open a pull request only for an issue that carried the
     agent:ready label when work started (docs/ISSUES.md). -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor or chore
- [ ] Documentation, tooling or CI

## Verification

<!-- Paste the command and its outcome. Full Definition of done: AGENTS.md. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Browser gate when the IDE or a template changes: `pnpm ide:smoke` / `pnpm ide:smoke:multitab`
- [ ] Not applicable, and why:

## Contract and security checklist

- [ ] New route: `defineAuthorizedHandler`, accurate `dbTables`, Zod input, i18n keys, OpenAPI metadata
- [ ] New table: Drizzle schema, RLS policy, generated migration
- [ ] New user-facing string: `t()` key in the locale file (`locales/en.json`, `ide/src/i18n/en.ts`)
- [ ] Contract changed: `docs/SPEC.md` and/or `docs/DECISIONS.md` updated
- [ ] No new production file exceeds 300 lines
- [ ] No secrets, `.env`, or generated artifacts committed

## Risk and rollout

<!-- Migration steps, rollback, feature flag, or "None". -->

## Screenshots or evidence

<!-- Before/after for UI changes; delete this section when it is not applicable. -->
