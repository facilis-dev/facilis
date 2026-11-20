# D-145 — Coda: accesso gated da `jobs:read`/`jobs:exec`, non da un ruolo system
**Status:** accepted (2026-11-10)

L'audit SEC-13 aveva proposto di rendere `facilis_jobs` system-only, ma la coda non è isolata:
engine, runner dei workflow e task store girano oggi come `facilis_app` sotto il tenant, quindi il
cambio avrebbe trascinato in system anche workflow e task, con elevazione/audit su ogni consumer.
L'owner ha scelto l'alternativa: la coda resta RLS-scoped e l'accesso è governato da **permessi**;
la visibilità per-utente dei job è responsabilità dell'endpoint che li espone (nessuna colonna
owner finché non serve).

**Decision.**

- **Policy per comando su `app.permissions`.** `facilis_jobs` mantiene la
  `tenant_isolation` restrictiva (D-008) e sostituisce la vecchia
  `facilis_jobs_tenant_access` (permissiva `for all`, che avrebbe OR-abilitato tutto) con quattro
  policy permissive: `SELECT` richiede `jobs:read`; `INSERT`/`UPDATE`/`DELETE` richiedono
  `jobs:exec`. Il predicato è
  `nullif(current_setting('app.permissions', true), '')::jsonb ? '...'`, lo stesso meccanismo
  delle viste con permesso (D-098): un ruolo app che tocca la coda senza il permesso prende
  `permission denied` dal database, non solo un check nel wrapper.
- **Scope del motore.** Il worker del motore passa `permissions: ["jobs:read","jobs:exec"]` nella
  propria transazione (`runWithPolicyScope`): sono permessi di framework, non di un utente. Le
  operazioni fatte da una route usano la transazione della richiesta, quindi i permessi della
  sessione (o del client Bearer); il *body* del job resta `runAsSystem` audited, invariato.
- **Blueprint e config.** `facilis.config.ts` dichiara `jobs:read`/`jobs:exec` e li assegna ai
  ruoli (l'esempio li dà a `user` e `manager`; `admin` ha il wildcard). Le route dei job usano
  quei permessi al posto di `todos:read`/`todos:write`. Un progetto che abilita la coda senza
  dichiararli fallisce chiuso (RLS), non silenziosamente aperto.
- **Workflow e task.** Stesso schema quando W2/W3 atterrano: `tasks:read`/`tasks:decide`,
  `workflows:read`/`workflows:exec`; niente system-only, niente cascata di elevazioni. Il
  requisito "everything runs in a system context like jobs" di WORKFLOWS.md diventa "engine
  app-role sotto il tenant con i permessi di framework; solo i body dei job sono system".
- **Migrazione.** Una migrazione hand-written (le migrazioni dell'esempio sono scritte a mano, non
  generate in CI): `0007_jobs_permissions.sql` droppa la policy vecchia e crea le quattro nuove.

**Rejected.** `facilis_jobs` system-only (cascata su workflow/task, elevazione e audit su ogni
lettura di coda, più "tutto system"); colonna `owner_id` (la visibilità per-utente non è un
requisito: la decide l'endpoint, e resta additiva se servirà); ruoli Postgres per permesso
(`jobs_read`/`jobs_exec` come `ROLE`: le app role non sono Postgres role, SPEC §8.4.5).

**Consequences.** I nomi `jobs:read`/`jobs:exec` entrano nel contratto della config quando un
progetto espone la coda; un client API Bearer ha bisogno di un ruolo con quei permessi; una route
anonima che vuole accodare deve passare da `ctx.system` (audited). Il costo è un predicato jsonb
per riga, come per le viste con permesso. Il modello si estende a `facilis_tasks`/`facilis_workflows`
senza cambiare la classe delle tabelle.

**Verification.** `examples/todo-app/db/migrations.test.ts` (le quattro policy + la vecchia
assente), `packages/nitro/src/runtime/jobs/db-store.test.ts` (scope con permessi: passa; scope
senza: INSERT negato e SELECT invisibile), suite jobs di `@facilis.dev/nitro`, suite
`@facilis.dev/db`, gates root.
