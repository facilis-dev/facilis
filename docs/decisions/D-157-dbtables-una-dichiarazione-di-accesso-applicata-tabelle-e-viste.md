# D-157 — `dbTables` è una dichiarazione di accesso applicata (tabelle e viste, statica + runtime)
**Status:** accepted (2026-11-11); the jobs carve-out is revoked by D-162 (the declaration covers job bodies too)

Il security review (audit SEC-02 e seguito) ha mostrato che `dbTables` è metadato autocertificato: una route
può interrogare qualsiasi tabella RLS, e dentro un'elevazione `facilis_system` bypassa la RLS mentre l'audit
registra solo le tabelle dichiarate. Le viste non sono fatti dell'analyzer (O-013), quindi oggi una route che
usa una vista dichiara le tabelle base. L'owner ha chiesto una dichiarazione applicata: ciò che una route
dichiara è ciò a cui può accedere, così è semplice capire quale route fa cosa.

**Decision.**

- **Cosa dichiara `dbTables`.** L'insieme completo delle relazioni che l'handler può toccare tramite
  `ctx.db`, `ctx.sudo` e `ctx.system`: **tabelle e viste**, con i nomi SQL. Una vista si dichiara con il
  proprio nome (D-097/D-098), invoker o definer: le tabelle base non si dichiarano, perché l'accesso alla
  vista non è un accesso diretto e per una definer il gate resta il permesso dichiarato nella `defineView`.
  Questo sostituisce la convenzione di O-013 ("dichiara le tabelle base").
- **Statico.** `@facilis.dev/analyze` impara `defineView` (`db/views/**`) in `ViewFact` (nome, tabelle,
  permesso, access). Un nuovo pass per route parte dall'handler, **segue le chiamate a funzioni del
  progetto** (stessi server module, con mappatura degli argomenti; profondità limitata, cicli chiusi; le
  chiamate nei pacchetti restano opache) e registra le relazioni lette/scritte: `select().from(...)` e join,
  `insert`/`update`/`delete(relazione)`, `db.query.<relazione>`. Confronto con `dbTables`:
  - usata e non dichiarata → **errore** `route-table-undeclared`;
  - dichiarata e non usata → **warning** `route-table-unused` (soppresso quando la route delega a helper
    opachi, dove il runtime resta l'autorità);
  - relazione non risolvibile o dinamica → **errore** `route-table-unresolved`;
  - `db.execute(sql)` senza flag → **errore** `route-raw-sql`;
  - dentro `ctx.sudo`/`ctx.system`, uso fuori da `options.tables` → **errore**
    `route-elevation-undeclared`.
  Il gate CI delle route (SEC-12, `routes-gate.test.ts`) esegue il pass su `examples/` e `starter/`; il
  validator AI riceve la nuova **regola 18 `route-table-declared`** per i patch.
- **`rawSql`.** Nuovo campo opzionale della config di route (`rawSql?: boolean`, default `false`),
  estratto staticamente come gli altri campi (manifest/OpenAPI `x-raw-sql`, release diff). Con
  `rawSql: true` la route può usare `db.execute`: l'SQL non è ispezionabile e la dichiarazione resta
  autorevole; senza, l'uso è un errore. È l'unica deroga, esplicita e visibile.
- **Runtime.** Il client passato come `ctx.db` e quello passato alle callback di elevazione sono
  **guarded**: ogni relazione toccata deve essere nel set dichiarato prima che la query parta; violazione →
  fail-closed `table_not_declared` (500); `db.execute` senza flag → `raw_sql_not_allowed` (500). Le
  violazioni producono un evento di audit (`route:table_access`, outcome failed) con route, request id e
  relazioni; il client non vede i nomi delle relazioni. L'elevazione continua a richiedere `tables` non
  vuoto e sottoinsieme di `dbTables`, ora verificato sull'accesso osservato; l'evento `succeeded`
  dell'audit aggiunge le tabelle **osservate** accanto a quelle dichiarate. I job in background,
  `ctx.jobs` e il loro store restano sul client non guarded (framework) e fuori scope.
- **Nessun interruttore globale.** L'enforcement è parte dell'invariante 2 ("dbTables presente e accurato"):
  nessuna modalità warn/off; l'unica deroga è `rawSql: true`. Le route del framework e dell'esempio vengono
  allineate, non escluse.

**Rejected.** Modalità warn/off (un invariante di sicurezza disattivabile non è strutturale). Inferire le
tabelle dall'SQL raw (fragile e aggirabile). Un ruolo Postgres per route (esplosione di ruoli, PGlite). Nodi
vista nel grafo (resta Phase 4 di O-013: qui le viste entrano in analyzer e validator, non ancora nel grafo).

**Consequences.** Cambiamento breaking per le route con `dbTables` incompleto: il gate CI blocca il merge e
il runtime fallisce chiuso; le route del framework e dell'esempio sono aggiornate. Una vista in `dbTables`
supera la regola 4; O-013 si aggiorna (fatti analyzer, validator e dichiarazione della vista; grafo ancora
no). SPEC 1.25 §7.4/§8.4/§9.3/§11.2, PHASE1-CONTRACTS e AGENTS.md (18 regole) seguono.
