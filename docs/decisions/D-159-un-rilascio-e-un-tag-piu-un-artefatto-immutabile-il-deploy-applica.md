# D-159 — Un rilascio e' un tag piu' un artefatto immutabile; il deploy applica artefatti con un ledger e un fingerprint
**Status:** accepted (2026-11-10)

**Context.** SPEC §2 dice che la pipeline esegue drizzle-kit migrate e POSTGRES §4 documenta uno
snippet una-tantum: applicano SQL senza sapere a che release e' il database, senza verificare che il
DB sia quello che si aspettano e senza un modo per rifiutare il drift. La prima versione del piano
(docs/MIGRATION-PLAN.md §1) calcolava il piano live -> dichiarato dentro il deploy: ma il deploy deve
partire da qualunque stato (vuoto, indietro di N release, ripristinato da backup, adottato) e il
confronto live non e' disponibile ne' dall'IDE ne' dalla CI.

**Decision.** Un rilascio e' un tag piu' un artefatto: il tag e' la release, l'artefatto e' il suo
schema diff immutabile, e il deploy applica artefatti con un ledger.

- **Artefatto.** Prodotto dal pipeline di D-158: release/from/to (tag + oid), fromDigest/toDigest,
  planHash (sha256 del corpo), risk, batch ordinati, destructive (gli id dei batch che perdono
  dati), approved? (autore, data, hash), problems. E' conservato come artifact CI chiave tag, non
  committato, e il deploy ne registra l'hash nel ledger.
- **Ledger.** _facilis_deploy_runs(release, plan_hash, from_digest, to_digest, status, statements,
  approval_ref, backup_ref, started_at, finished_at), una riga per artefatto applicato. Lo stato di
  un database e' cio' che dice il ledger: pending = artefatti fra la release del ledger e il target.
- **Deploy.** Preflight digest(live) == artifact.fromDigest (altrimenti rifiuto tipizzato),
  fingerprint post-check, lock consultivo, una transazione per artefatto, post-step (seed,
  ensureAppRole, ensureSystemRole, views). Nessun downgrade: si ripristina il backup o si spedisce
  un artefatto in avanti.
- **Il catalogo live e' verifica, non generatore.** facilis db adopt registra la baseline di un DB
  senza ledger; facilis db repair e' la riconciliazione esplicita live -> dichiarato, con backup,
  registrata come repair e mai come release. --allow-destructive esiste solo qui.
- **Approvazione e esecuzione sono atti separati.** L'approvazione e' un atto di rilascio legato al
  planHash e alla lista dei batch distruttivi; la policy dell'ambiente (destroy: deny | approval |
  allow) decide se il deploy puo' eseguirla; il deploy resta non presidiato. Il backup e'
  dell'ambiente di rilascio: il deploy richiede e registra un backup_ref, non lo produce.
- **Stesso artefatto in ogni ambiente.** Test/staging applicano per primi lo stesso SQL; la
  produzione applica lo stesso dopo l'approvazione, quindi non possono divergere in silenzio.
- **Release Preview.** L'IDE calcola lo stesso piano tag -> HEAD dal git tree, senza database, e
  fallisce chiuso dove l'analyzer non risolve una dichiarazione. Il preview mostra il piano che
  parte, non SQL inventato: cio' sostituisce la premessa di D-086 (che rifiutava di sintetizzare
  SQL nel preview) perche' la generazione ora e' deterministica dai tag e l'artefatto CI e'
  l'autorita'.
- **v1 non fa data batch.** Un piano che richiede righe esistenti modificate fallisce il rilascio
  con data_needed; i backfill scritti a mano restano fuori scope (decisione 5 del piano).

**Rejected.** applicare il diff live -> dichiarato al deploy (non deterministico, dipende dallo
stato e non e' revisionabile), SQL committato nel repo o manifest OCI (artefatti CI chiave tag:
decisione 1), drizzle-kit migrate come deploy step, flag umano a ogni deploy (l'approvazione e' un
atto di rilascio), backup eseguito dal framework (lo fa l'ambiente di rilascio), confronto live al
momento del rilascio (l'IDE/CI non hanno il DB).

**Consequences.** facilis db deploy/status/adopt/repair prende il posto dello snippet di POSTGRES
§4; SPEC §2/§7.7/§11.3 e APP-UPDATES §5 cambiano; da emendare anche D-086 (premessa schema-lens),
D-109 (completato da D-158), D-065/D-070 (step DB dell'upgrade), D-136 (RLS dentro gli artefatti),
D-052 (snapshot PGlite dev), D-078 (publish + tag). Matrice di stati e flussi:
docs/MIGRATION-PLAN.md §2.3-§2.5.

**Verification.** P1: digest canonico e round-trip dichiarato <-> live. P3: matrice di stati
(vuoto, indietro, ripristinato, adottato, drift, parziale, ruolo sbagliato), secondo run a 0
statement, deploy interrotto, rifiuti tipizzati, e2e PGlite + Postgres. P4: lo stesso piano in IDE e
pipeline per la stessa coppia di tag.
