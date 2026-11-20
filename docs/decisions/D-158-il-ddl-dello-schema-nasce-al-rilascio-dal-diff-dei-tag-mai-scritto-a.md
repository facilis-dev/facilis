# D-158 — Il DDL dello schema nasce al rilascio dal diff dei tag, mai scritto a mano
**Status:** accepted (2026-11-10)

**Context.** Il DDL oggi si scrive a mano. Nell'esempio e' hand-written (0001_seed_roles,
0005_app_access, 0006_api_clients), nei progetti generati lo scrive l'AI (regola 14 del validator e
regola config-sync), e i documenti dichiarano drizzle-kit come generatore (SPEC §2, §8.3) anche se
il progetto generato non ha ne' drizzle-kit ne' db:generate. D-109 aveva stabilito che il framework
rende le migrazioni dai fatti dello schema, ma l'unico renderer (ide/src/ai/schema-migration.ts) e'
rimasto orfano: nessun import, nessun test. Chi cambia db/schema.ts deve quindi anche scrivere il
SQL, e quel SQL puo' essere incompleto, non riproducibile e diverso da un ambiente all'altro.

**Decision.** Per test e produzione il DDL e' un artefatto generato in pipeline, dal diff fra il tag
del rilascio precedente e il tag nuovo, senza accesso al database.

- **Dove nasce.** Il release pipeline fa checkout dei due tag, carica db/schema.ts e
  facilis.config.ts, costruisce i due snapshot dichiarati e chiama planSchema(from, to) in
  @facilis.dev/core: batch ordinati, classi di rischio, problemi. Un problema (dichiarazione
  irrappresentabile, sicurezza delle policy) fa fallire il rilascio, non degrada.
- **Nessun database al momento della generazione.** L'IDE e la CI non raggiungono test/prod: il
  confronto live e' impossibile per costruzione, quindi il tag e' l'unica sorgente. Il catalogo
  live resta una verifica del deploy e un attrezzo di adozione/riparazione (D-159).
- **Nessun AI e nessun utente scrivono DDL.** La regola 14 del validator e la regola config-sync
  smettono di chiedere un file .sql e diventano un blocco: un DDL scritto a mano in una patch viene
  rifiutato. db/migrations/ e meta/ escono dal template.
- **Eccezione dev.** In PGlite lo schema cambia senza tag: al boot il dev database si riconcilia
  live -> dichiarato con lo stesso planner, sui dati usa-e-getta. Non e' un percorso di rilascio.
- **Nessuna dipendenza runtime da drizzle-kit.** I percorsi programmatici sono verificati rotti o
  lossy (pushSchema perde i parametri, il pull non e' idempotente) e il progetto generato non lo
  installa: drizzle-kit resta un oracolo di test in CI, non una dipendenza.
- **D-109 si completa.** Il renderer orfano si sposta in @facilis.dev/core con i suoi test.

**Rejected.** drizzle-kit come generatore di produzione (rotto/lossy e assente dal progetto
generato), diff live come generatore (la pipeline non ha accesso al DB: e' la ragione del modello),
SQL scritto dall'AI (non riproducibile dai tag, non revisionabile), migrazioni scritte a mano per i
backfill in v1 (fuori scope, decisione 5 del piano).

**Consequences.** Una modifica di schema in un PR non contiene piu' .sql; rilanciare il pipeline
sugli stessi tag produce lo stesso piano. Da emendare: SPEC §2/§7.7/§8.3/§8.4.2/§9.4/§11.3/Appendix
D, PATTERNS §5 (generated, never authored), APP-UPDATES §5, POSTGRES §4, README dell'esempio. Il
piano operativo e' docs/MIGRATION-PLAN.md.

**Verification.** P0: nessuna riga di codice. P2: golden test del planner e confronto con
drizzle-kit generateDrizzleJson + generateMigration come oracolo; una dichiarazione non supportata
fallisce il rilascio. Gate finali: pnpm lint/typecheck/test/build.

**Implementation note (2026-11-18).** Le regole 14 e 16 del validator ora applicano il contratto:
la 14 rifiuta (errore, non piu' warning) ogni create/update sotto `db/migrations/` — il DDL esce
dal piano dei tag, quindi non c'e' un file da scrivere — e la 16 non chiede piu' una migrazione di
seed quando `facilis.config.ts` cambia ruoli/permessi: il seed e' generato al rilascio e resta solo
il controllo fail-closed sull'auth leggibile. Restano di P5 la riconciliazione dev live -> dichiarato
e la rimozione del replay delle migrazioni dal boot.

**Implementation note (2026-11-20, issue #48).** Il lens schema del Release Preview e' ora il piano
generato: `buildReleasePreview` chiama `planSchema(from, to)` sui due `SchemaSnapshot` dichiarati
(fatti analyzer via `schemaSnapshotFromAnalysis`, #47) e il pannello mostra batch (SQL + rischio per
batch), rischio del piano, id dei batch distruttivi e problemi; un piano con problemi fallisce chiuso
e non presenta SQL. Il rischio del piano non e' mai `breaking`: il lens breaking (drop ancora letti
dalle route) solleva il rischio complessivo mostrato, il piano resta quello dell'artefatto. Rimossi
`ReleaseMigrationFile`, le letture di `db/migrations` nel preview, `pending_migrations_on_target`,
lo splitter SQL e il classificatore di statement (il preview era l'ultimo consumatore). I lens
security/breaking/API consumano le tabelle dello snapshot (colonne con tipo, policy con SQL renderizzato);
il sottopath browser-safe `@facilis.dev/core/release` raggiunge `planSchema` senza codice runtime Node
(dipendenza da `@facilis.dev/db` solo di tipo). SPEC §7.7/§11.3 aggiornati al contratto implementato.
