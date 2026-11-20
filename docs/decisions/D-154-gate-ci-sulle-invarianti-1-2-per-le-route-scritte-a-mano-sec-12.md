# D-154 — Gate CI sulle invarianti 1-2 per le route scritte a mano (SEC-12)
**Status:** accepted (2026-11-10)

SEC-12: l'analyzer produceva `wrapper: "invalid"` ma solo l'IDE e il validatore AI lo usavano; niente
in CI impediva di aggiungere a mano una route senza `defineAuthorizedHandler` o senza `dbTables`.

**Decision.** Un test Vitest in `@facilis.dev/analyze` (`routes-gate.test.ts`) carica le app con
`server/routes`/`server/api` sotto `examples/` (e `starter/` quando esiste), esegue l'analyzer reale e
fallisce se una route non ha un `RouteFact`, se `wrapper !== "valid"` o se `dbTables` è assente/non
leggibile staticamente. Un fixture temporaneo dimostra che il gate scatta (default export non-wrapper,
`dbTables` assente, `dbTables` dinamico). Gira in `pnpm test` (la CI esegue già turbo test): nessun
nuovo script né modifica del lint root.

**Rejected.** `scripts/check-routes.mjs` (nuovo wiring e secondo entry point dell'analyzer, mentre la
pipeline test esiste già); regola oxlint (non può verificare l'accuratezza di `dbTables` rispetto
all'AST, solo la presenza del token).

**Consequences.** Il gate copre le route del blueprint (quelle che gli utenti copiano); una directory
applicativa nuova va aggiunta all'elenco del test. L'accuratezza semantica di `dbTables` resta una
responsabilità del validatore AI per i patch e dell'analyzer per il resto.

**Verification.** Analyze suite 102 test (prima 100), il probe sull'esempio riporta 17/17 route valide,
typecheck/lint/prettier verdi.
