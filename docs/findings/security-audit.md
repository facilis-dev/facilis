# Security audit — Facilis (HEAD 69985e4, 2026-11-10)

Analisi statica di sicurezza del repository, con la SPEC come contratto (SPEC §8, §9.3, §11.4) e
la verifica delle decisioni recenti (D-136, D-137, D-141, D-142, D-143, D-098, D-099, D-119, D-120).
Nessuna modifica al codice: questo documento è l'unico artefatto prodotto.

**Ambito:** `packages/{core,db,auth,nitro,storage,ai,analyze}`, `ide/src`, `examples/todo-app/server`,
`scripts/dev`, `.github`, `ide/public/sw.js`, config di root e documentazione di deploy.
**Escluso:** `vendor/vivari` (submodulo upstream read-only; `ide/public/sw.js` è la copia sincronizzata
con la patch IDE e come tale è stata letta), CVE scan delle dipendenze (nessun accesso rete),
test dinamici/exploit (solo verifica statica sul codice).

## 0. Sintesi esecutiva

Il modello di difesa è sopra la media per un framework low-code: RBAC strutturale nel wrapper,
RLS come confine di *grant* (D-136), elevazioni auditate fail-closed, validatore AI, redazione dei
log, token di download firmati. I problemi principali non stanno nelle guardie "di riga" ma in
**tre assunzioni non verificate**: (a) che un'email appartenga a chi la registra, (b) che
`NODE_ENV` sia sempre impostato in produzione, (c) che il confine di sicurezza sia sempre
l'*utente* quando alcune policy RLS scoping solo il *tenant*.

| ID | Finding | Gravità | Confidenza | Area |
|---|---|---|---|---|
| SEC-01 | Bootstrap admin dirottabile via email non verificata (anche con varianti di maiuscole) — risolto con token monouso (D-150) | **Critica** | Alta | auth/bootstrap |
| SEC-02 | Linking SSO su account creati da registrazione non verificata → pre-hijacking — risolto alla radice con la verifica email e il claim dell'account pendente (D-156) | **Alta** | Alta | auth/SSO |
| SEC-03 | Rilevamento produzione fail-open: con `NODE_ENV` non impostato restano aperti manifest, dev/query, dev/schema, dev/view e cookie senza `Secure` | **Alta** | Media | nitro/deploy |
| SEC-04 | Nessun rate-limit/lockout su login e registrazione; registrazione enumerabile (409 con dettaglio) — throttle per route (D-152), risposta generica, timing D-148 | **Alta** | Alta | auth |
| SEC-06 | RLS di `sessions`/`user_roles`/`api_clients`/`api_tokens`/`auth_identities` è tenant-wide, non per-utente | Media | Alta | DB/RLS |
| SEC-07 | SAML: `validateInResponseTo: "ifPresent"` accetta asserzioni senza `InResponseTo` (contratto: niente risposte non sollecitate) | Media | Media | SSO |
| SEC-08 | Rate limiter del token endpoint: chiave scelta dall'attaccante, mappa illimitata, quota avvelenabile | Media | Alta | API/client |
| SEC-09 | Nessun limite di dimensione del body prima del parsing (JSON e multipart) — risolto con cap nel wrapper (D-153) | Media | Alta | HTTP/DoS |
| SEC-10 | Profilo "open": preview iframe same-origin con `allow-same-origin` → codice di progetto legge la AI key in localStorage — **aperto**, rimandato a una feature IDE (D-155) | Media | Alta | IDE |
| SEC-11 | PBKDF2 a 210k iterazioni (< raccomandazione OWASP) e timing oracle sull'esistenza dell'email | Bassa | Alta | auth |
| SEC-12 | Invarianti 1/2 (wrapper e dbTables accurati) non bloccanti per codice scritto a mano: solo diagnostica analyzer — risolto con gate CI (D-154) | Bassa | Alta | processo |
| SEC-13 | Coda job senza ownership: `input`/`output` leggibili da chi ha il permesso della route (risolto con `jobs:read`/`jobs:exec` in RLS, D-145) | Bassa | Alta | jobs |
| SEC-14 | `dbTables` ed elevazioni autocertificati: nulla verificava le relazioni realmente interrogate (route RLS arbitrarie; elevazioni con audit fuorviante) — risolto con analisi statica + guard runtime e regola AI 18 (D-157) | Media | Alta | DB/route |

**Stato al 2026-11-11 (hardening completato):** risolti SEC-01 (D-150), SEC-02 (verifica email e
claim dell'account pendente, D-156; D-151 è superata), SEC-03 (D-146), SEC-04 (D-148 timing/PBKDF2 +
D-152 throttle per route, risposta di registrazione generica; resta un canale indiretto di
enumerazione mitigato dal rate limit), SEC-07 (D-147), SEC-08 (D-149), SEC-09 (D-153),
SEC-11 (D-148), SEC-12 (D-154), SEC-13 (D-145); SEC-06 mitigato (hash delle sessioni, D-144). Resta
aperto solo **SEC-10**, rimandato a una feature IDE dedicata (D-155) perché cambiare il sandbox della
preview tocca cookie/storage/Service Worker e va verificato nel browser.

Totale: 1 critica, 3 alte, 5 medie, 3 basse. **SEC-05 è stato ritirato** dopo la revisione:
una route `crossSite` è utilizzabile anche dall'utente loggato con i ruoli, quindi accettare il
cookie per chiamate same-origin è il comportamento voluto (resta solo la nota in §3).
Nessun bypass remoto non autenticato trovato nelle
route framework-owned (/api/auth/token, SSO, manifest, dev); i percorsi più concreti passano
dalle route applicative blueprint (login/register) e da configurazioni di deploy.

## 1. Dettaglio dei finding

### SEC-01 — Bootstrap del primo admin dirottabile via email non verificata — Critica, confidenza alta

**Stato (2026-11-10): risolto — D-150.** La promozione richiede il token monouso
`FACILIS_INITIAL_ADMIN_TOKEN` oltre all'email, il confronto è in tempo costante, il bootstrap è
one-time (nessun admin esistente) e le email sono canoniche con indice unico `lower(email)`.
La registrazione risponde `{ accepted: true }` senza ruolo né id. Verifica: `seed.test.ts`,
`migrations.test.ts`, suite auth/core/examples.

**Evidenza.**
- `examples/todo-app/server/routes/api/auth/register.post.ts:57-61` — la registrazione è pubblica
  (`permission: []`), non prova la proprietà dell'email e chiama
  `registerInitialAdmin(systemDb, user.id)`.
- `packages/auth/src/seed.ts:62-77` — promuove ad `admin` l'utente il cui indirizzo, **confrontato in
  minuscolo**, coincide con `FACILIS_INITIAL_ADMIN`.
- `packages/auth/src/tables.ts:37` — `email: text("email").notNull().unique()`: unicità
  **case-sensitive** (nessun indice su `lower(email)`).
- Il flusso è quello documentato come bootstrap ufficiale: SPEC §8.4.3 (righe 1891-1912),
  `examples/todo-app/README.md:46`, `docs/DEMO.md:32`.

**Percorso d'attacco.** Con il deploy che segue la documentazione
(`FACILIS_INITIAL_ADMIN=founder@azienda.it`) e la route di registrazione del blueprint esposta:
1. qualsiasi utente non autenticato registra `founder@azienda.it` **prima** del founder reale (o una
   variante di maiuscole, es. `Founder@azienda.it`, che passa il vincolo `unique` perché case-sensitive);
2. la risposta della registrazione mostra `role: "admin"`; il successivo login ottiene il ruolo con
   wildcard `*` (tutti i permessi, inclusi i route `api-clients:*`, `users:*`);
3. anche se il founder reale si registra dopo, l'attaccante conserva `admin`. Non serve possedere
   la casella: nessun controllo di verifica email esiste nel framework.

**Perché i controlli attuali non bastano.** La registrazione passa dal wrapper (Zod, origin gate,
audit) e l'elevazione `system` è corretta, ma il *criterio* di promozione è un'identità non
verificata; il confronto case-insensitive peggiora il caso (bypass anche a distanza di tempo).
Il vincolo di unicità case-sensitive consente account duplicati con maiuscole diverse.

**Rimedio.** Non promuovere per email: usare un token di bootstrap monouso (env) consumato nella
prima registrazione, oppure una promozione CLI/migrazione con accesso al DB; in alternativa
richiedere la verifica email prima della promozione. Normalizzare l'email (minuscolo) in
registrazione/login e aggiungere un indice unico su `lower(email)`. Test negativo: registrare una
variante di maiuscole di `FACILIS_INITIAL_ADMIN` non deve produrre `admin`.

### SEC-02 — SSO: linking su account con email mai verificata → account pre-hijacking — Alta, confidenza alta

**Stato (2026-11-10): risolto alla radice — D-156 (sostituisce D-151).** Il framework ora verifica
gli account password: `users.email_verified_at` + link monouso in `auth_email_verifications`, login
`403 email_unverified` finché non è verificato, e la registrazione pubblica non può essere usata per
"prenotare" un indirizzo (un account pendente si reclama ri-registrando l'email e viene verificato dal
link). Il linking SSO segue la verifica: un account verificato si collega, un account pendente viene
reclamato dall'identità con la password segnaposto rimossa — l'attaccante che ha registrato l'indirizzo
per primo perde l'account, la vittima lo mantiene. Verifica: `identity-guard.test.ts`,
`email-verification.test.ts`, `migrations.test.ts`.

**Evidenza.**
- `packages/auth/src/sso/identity.ts:121-140` — senza identità collegata, un'email
  `emailVerified` viene confrontata con `users.email` (`findUserIdByEmail`, riga 67) e, se esiste
  un utente, l'identità SSO viene **collegata** a quell'account.
- `packages/auth/src/sso/identity.ts:125` — il controllo "unverified email never links" protegge
  solo il claim del provider, non il fatto che l'account esistente sia stato creato senza verifica.
- `examples/todo-app/server/routes/api/auth/register.post.ts:10-14` — la registrazione password non
  ha alcuna verifica email (e il framework non la offre: nessun campo `emailVerified` su `users`).
- D-120 assume esplicitamente "an email must be verified and is matched against users" per il linking.

**Percorso d'attacco.** In un deploy con SSO abilitato (`autoProvision` default `true`) e
registrazione password:
1. l'attaccante registra `vittima@azienda.it` con una password che conosce;
2. la vittima fa il primo login SSO con l'email aziendale verificata dal provider;
3. il flusso la collega all'account creato dall'attaccante; la vittima lavora in un account di cui
   l'attaccante conosce la password (e può leggere/modificare tutto, o usarlo per phishing interno).

È la classe "account pre-hijacking": il controllo D-120 protegge il claim SSO, non l'account
preesistente.

**Rimedio.** Aggiungere una verifica email reale (campo + token) e rifiutare il linking SSO a un
account con `passwordHash != null` e email non verificata; oppure limitare il linking a utenti
creati da SSO o invitati da un admin; registrare l'evento di linking con notifica. Alternativa
minima: nel blueprint di registrazione richiedere un invito o il token di bootstrap (SEC-01).

### SEC-03 — Rilevamento produzione fail-open (`NODE_ENV`) — Alta, confidenza media
**Stato (2026-11-10): risolto — D-146.** Solo `development`/`test` sono dev; unset e valori
sconosciuti sono produzione (dev endpoint 404, cookie `Secure`, niente PGlite).

**Evidenza.**
- `packages/nitro/src/runtime/env.ts:9` — `return environment["NODE_ENV"] === "production"`:
  *solo* la stringa esatta disattiva i dev endpoint; un valore assente vale "development".
- `packages/nitro/src/runtime/http-guard.ts:43-48` — `guardDevRequest` risponde 404 solo se
  `isProductionEnvironment()` è vero; altrimenti applica il solo origin allowlist.
- `packages/nitro/src/runtime/http-guard.ts:17-33` — se `Origin` è assente la richiesta passa
  (client non-browser come `curl` passano sempre).
- `packages/nitro/src/session-cookie.ts:53` — `secure: options.secure ?? process.env.NODE_ENV === "production"`:
  senza `NODE_ENV` il cookie di sessione non ha `Secure`.
- Il requisito è solo documentale: `docs/POSTGRES.md:110,151` usano `NODE_ENV=production`
  nell'esempio di avvio, ma niente nel codice lo impone.

**Impatto in un deploy che omette `NODE_ENV` (Docker/systemd/process manager, self-host):**
- `/__facilis/manifest` risponde 200 senza autenticazione: manifest completo (config, ruoli e
  permessi, route, schema, metadati) a chiunque raggiunga la rete, anche senza `Origin`;
- `/__facilis/dev/schema` e `/__facilis/dev/query` restano attivi: query SQL "read-only" eseguite
  sulla connessione root (in un deploy collegato come owner/superuser bypassa la RLS; con
  superuser sono possibili anche letture di file via funzioni come `pg_read_file`);
- `/__facilis/dev/view` consente di creare viste definer con un permesso dichiarato;
- cookie di sessione senza `Secure` (invio su HTTP, se il sito è raggiungibile in chiaro);
- sink di log su file del progetto invece che stdout (trail fuori dal controllo dell'operatore).

**Rimedio.** Invertire il default: considerare dev solo un valore esplicito
(`FACILIS_ENV=development` o `NODE_ENV in {development,test}`), così l'assenza di configurazione
fallisce chiusa; testare `guardDevRequest({})` → 404. Richiedere `DATABASE_URL`/`FACILIS_STORAGE_SECRET`
in produzione e rifiutare l'avvio altrimenti.

### SEC-04 — Nessun throttling su login/registrazione, registrazione enumerabile — Alta, confidenza alta
**Stato (2026-11-10): mitigato — D-148, D-152, D-156.** Login a tempo costante (hash dummy),
PBKDF2 600k e throttle per route nel wrapper (login 10/min, registrazione 5/min per client); la
registrazione risponde `{ accepted: true }` senza dettagli e la verifica email (D-156) rende gli
account non verificati inutilizzabili. Resta un canale indiretto di enumerazione (registrazione →
login: un account verificato risponde `unauthorized`, uno pendente `email_unverified`), mitigato
dal rate limit; si chiude con la registrazione "deferred" (utente creato solo dopo la verifica),
rimandata come evoluzione in D-156.

**Evidenza.**
- L'unico rate limit del repo è per `/api/auth/token`: `packages/nitro/src/routes/token.post.ts:44`,
  `packages/nitro/src/runtime/rate-limit.ts`; non esiste alcun limitatore per le route applicative.
- `examples/todo-app/server/routes/api/auth/login.post.ts:16-33` — nessun lockout/backoff; ogni
  tentativo esegue PBKDF2 (210k) e la risposta è identica, ma...
- `examples/todo-app/server/routes/api/auth/login.post.ts:26-30` — se l'email non esiste si esce
  **prima** di `verifyPassword`: timing oracle per l'enumerazione degli account.
- `examples/todo-app/server/routes/api/auth/register.post.ts:24-27` — in caso di email già
  registrata risponde `409 conflict` con `details { email: "already_registered" }`: enumerazione
  diretta e affidabile.

**Percorso d'attacco.** Credential stuffing/brute force illimitato sul login (la PBKDF2 rende ogni
tentativo costoso ma non impedisce il volume); enumerazione delle email registrate via timing sul
login o via 409 sulla registrazione; creazione illimitata di account (spam, occupazione di email
future, vedi SEC-01/SEC-02). Le route blueprint sono il codice che gli utenti copiano nei progetti.

**Rimedio.** Rendere il rate limit una capacità del wrapper (`defineAuthorizedHandler({ rateLimit })`)
con chiave (IP, route) e soglie diverse per login/register/token; risposta generica anche per la
registrazione duplicata (o 202 con verifica email); eseguire una PBKDF2 "dummy" quando l'utente non
esiste per uniformare i tempi. Il limiter in-memory va bene solo per single-instance: documentarlo.

### SEC-05 — Ritirato in revisione (non è un finding)

Su indicazione dell'owner: una route `crossSite` è un'API che deve poter essere usata anche
dall'utente loggato con i permessi; il cookie di sessione per le chiamate same-origin è quindi
intenzionale. L'esposizione cross-site resta affidata al Bearer (D-142) e la garanzia "cookie mai
cross-site" è di `SameSite=Lax`. Non è una vulnerabilità nel modello previsto; unico residuo teorico
(annotato in §3): se in futuro un deploy ospitasse applicazioni non fidate su sottodomini *same-site*
dello stesso registrable domain, la POST con cookie su una route `crossSite` non sarebbe fermata dal
gate sull'origine. Nessuna azione richiesta oggi.

### SEC-06 — Le policy RLS delle tabelle credenziali sono tenant-wide: non serve sudo — Media, confidenza alta (verificato con test)

**Stato (2026-11-10):** mitigato in parte — implementata la soluzione hash per gli id di sessione
(D-144): la riga `sessions` contiene `sha256(cookie)` e non è più riproducibile come credenziale.
Resta la visibilità tenant-wide delle righe (utente→sessioni) e la questione delle scritture
`user_roles`; la soluzione system-only resta l'alternativa se si vuole togliere anche quella.

**Risposta diretta alla domanda:** no, non è leggibile "solo dall'utenza di sistema o usando sudo".
Le tabelle in questione sono **app-scoped** (D-136): `ensureAppRole` concede DML a `facilis_app` a
ogni tabella con RLS abilitata (`packages/db/src/policy.ts:94-111`), e `sessions` ha RLS abilitata
(`packages/auth/src/tables.ts:71-78`). Quindi qualunque `ctx.db` — senza sudo, senza system role —
può leggere quelle righe; `sudo`/system servono solo a *bypassare* la RLS, non a leggerle. Il punto
non è il ruolo: è che la policy non contiene **né** un filtro per-utente **né** un filtro per-ruolo.

**Evidenza.**
- `packages/auth/src/tables.ts:63-66` — `parentUserAccessPolicy`: `exists (select 1 from users u where u.id = <col>)`,
  nessun confronto con `app.user_id`.
- `packages/auth/src/tables.ts:49-53` — la policy su `users` è solo di tenant (restrictive
  `tenant_isolation` + permissive `users_tenant_access`): l'EXISTS è vero per ogni utente del tenant.
- Applicata a `sessions` (`:77`), `user_roles` (`:110`), `api_clients` (`:139`),
  `api_tokens` (`:159`); stesso schema per `auth_identities` in `packages/auth/src/sso/tables.ts:36-41`.
- L'id di sessione è **il valore del cookie**, memorizzato in chiaro come PK
  (`packages/auth/src/session.ts:24-45`): una SELECT su `sessions` restituisce credenziali vive.

**Verifica empirica (eseguita, test temporaneo poi rimosso).** Con `createAuthTestDb()` (PGlite +
policy reali) e due utenti A/B dello stesso tenant, una lettura eseguita con
`runWithPolicyScope(db, { tenantId, userId: A })` — cioè l'identità `facilis_app` e lo scope di A,
esattamente ciò che riceve un handler — restituisce **entrambe** le sessioni:

```
VISIBLE_SESSIONS [{"id":"session-user-a","userId":"1111…"},{"id":"session-user-b","userId":"2222…"}]
```

Stesso esito per `user_roles` e per le altre tabelle con lo stesso pattern: la visibilità è quella
del tenant, non dell'utente. Oggi nessuna route framework-owned espone `sessions` (l'unico lettore è
`validateSession`, che filtra per id), quindi l'impatto richiede una route applicativa o la Data
Explorer (dev) che interroghi quelle tabelle, oppure un bug di filtro in un handler; ma il confine
dichiarato ("inherits the parent user's visibility") non è quello che la policy realizza.

**Perché non basta "aggiungere `app.user_id` alla policy" (correzione).** Il middleware di sessione
valida il cookie **prima** di conoscere l'utente: la sua transazione ha solo `{ tenantId }`
(`packages/auth/src/session.ts:151-165`), quindi una policy su `sessions` che pretendesse
`user_id = app.user_id` bloccherebbe il login. Stesso vincolo per `loadUserRoles`.
Le opzioni reali:
1. **Hashing dell'id di sessione** (raccomandata, poco invasiva): il cookie resta il segreto, il DB
   memorizza `sha256(id)` come chiave di ricerca (`validateSession`/`destroySession` cercano per
   hash). La policy resta tenant-wide perché serve al lookup pre-auth, ma una lettura della tabella
   non espone più credenziali utilizzabili.
2. **`sessions` system-only** + lookup interno in elevazione (come i job, SEC-13): il grant viene
   revocato da `ensureAppRole`, il middleware fa la lettura come `facilis_system` dentro la
   transazione della richiesta. Attenzione: senza RLS il filtro `tenant_id` diventa responsabilità
   della query (`where users.tenant_id = ...`), quindi va centralizzato in un solo helper e
   testato; il costo è un `SET LOCAL ROLE` per richiesta (non un audit per richiesta).
3. **Scritture**: oggi la policy `for: "all"` consente al ruolo app di INSERT/UPDATE/DELETE su
   `user_roles`/`sessions` di **qualunque** utente del tenant (assegnazione di ruoli inclusa).
   Se la semantica è "i ruoli si assegnano solo da un'elevazione audita", le policy di scrittura
   vanno negate al ruolo app e l'assegnazione spostata su `ctx.sudo` (l'admin route del blueprint
   scrive `user_roles` con `ctx.db`: andrebbe adattata).
4. Le tabelle `api_clients`/`api_tokens` espongono solo hash (non credenziali utilizzabili) e il
   lookup del Bearer è pre-auth come la sessione: priorità più bassa. `auth_sso_states` contiene
   state/`code_verifier`/nonce di login in corso: se resta RLS-scoped andrebbe scopata per-utente o
   resa system-only.

### SEC-07 — SAML: asserzioni senza `InResponseTo` accettate — Media, confidenza media
**Stato (2026-11-10): risolto — D-147.** `validateInResponseTo: "always"`: una risposta senza
`InResponseTo` viene rifiutata.

**Evidenza.**
- `packages/auth/src/sso/saml.ts:94-97` — il commento afferma che `ifPresent` "lega l'asserzione
  alla AuthnRequest"; in realtà `ifPresent` significa che **se `InResponseTo` manca non viene
  verificato**.
- `packages/auth/src/sso/saml.ts:141-142` — `validateInResponseTo: "ifPresent"` con un
  `cacheProvider` che contiene solo l'id dell'attempt.
- Contratto: D-120 e SPEC §5.3 dicono "IdP-initiated SSO is not accepted (no unsolicited assertion
  surface)"; il binding residuo è il `RelayState`, che l'attaccante può creare da sé con
  `GET /api/auth/sso/:provider/start` (`packages/auth/src/sso/login.ts:103-117`).

**Impatto.** Un'asserzione firmata e valida (audience/recipient corretti) priva di `InResponseTo`
— tipicamente una risposta IdP-initiated o una replay di un'asserzione intercettata — viene accettata
se accompagnata da un `RelayState` fresco dell'attaccante. Consente login CSRF (vittima loggata
nell'account dell'attaccante) e replay entro la finestra di validità; non consente impersonazione
arbitraria senza un'asserzione firmata valida.

**Rimedio.** Usare `validateInResponseTo: "always"` (o rifiutare esplicitamente un profilo senza
`InResponseTo` corrispondente) e mantenere il `RelayState` monouso; aggiungere test con risposta
SAML senza `InResponseTo` che deve fallire con `sso_exchange_failed`.

### SEC-08 — Rate limiter del token endpoint: chiave controllata dall'attaccante e mappa illimitata — Media, confidenza alta
**Stato (2026-11-10): risolto — D-149.** Mappa FIFO con cap 4096, costo O(1) per chiave nuova.

**Evidenza.**
- `packages/nitro/src/routes/token.post.ts:44` — `consume(ctx.body.client_id, ...)`: la chiave è il
  `client_id` inviato, **prima** di qualsiasi autenticazione (e il client id è dichiarato pubblico,
  `packages/auth/src/api-clients.ts`/D-142).
- `packages/nitro/src/runtime/rate-limit.ts:35-56` — ogni chiave nuova crea una voce in `Map`;
  lo sweep avviene solo quando `size > 1024` (`:27-28`, `:60-63`) e rimuove solo le finestre
  scadute; chiavi distinte entro la finestra fanno crescere la mappa senza limite e ogni nuova
  chiave paga uno sweep O(n).

**Impatto.** (1) Lockout mirato: chi conosce un client id può consumarne la quota e impedire al
client legittimo di ottenere token (DoS applicativo). (2) DoS di memoria/CPU non autenticato con
molte `client_id` distinte, sulle istanze con API client abilitati.

**Rimedio.** Chiave composita (IP + client id) e bucket globale per IP/processo; mappa limitata
(LRU) con pulizia periodica; contare separatamente gli id sconosciuti; mantenere il confronto
dell'hash costante (già presente).

### SEC-09 — Nessun limite di dimensione del body prima del parsing — Media, confidenza alta

**Stato (2026-11-10): risolto — D-153.** Cap nel wrapper prima del parsing (JSON 1 MiB; multipart
`storage.maxUploadBytes + 1 MiB`), pre-check di `content-length`, contatore in streaming con cancel
del reader, nuovo codice `payload_too_large` (413) in registry/locale/blueprint. Verifica:
`request-input.test.ts`.

**Evidenza.**
- `packages/core/src/request-input.ts:83-103` — `event.req.json()` senza controllo di
  `content-length` né cap.
- `packages/core/src/request-input.ts:119-137` — `event.req.formData()` bufferizza l'intero
  multipart prima di restituire i `File`.
- `packages/nitro/src/storage.ts:61-69` — `maxUploadBytes` è controllato **dopo** che il body è
  già stato letto/parsato (`file.size`), e la dimensione dichiarata non è una garanzia di consumo.

**Impatto.** DoS per memoria/CPU su route pubbliche con body (`login`, `register`, token) e su
upload autenticati: un body enorme viene bufferizzato prima di qualunque rifiuto. In un deploy con
più tenant è un vettore di esaurimento risorse a basso costo.

**Rimedio.** Nel wrapper: cap configurabile (default ~1 MiB per JSON, dimensione upload per form),
verifica di `content-length` prima del parse e lettura streaming con contatore che interrompe oltre
la soglia; allineare `storage.maxUploadBytes` a questo limite.

### SEC-10 — Profilo "open": preview same-origin non isolata dalle credenziali IDE — Media, confidenza alta

**Stato (2026-11-10): aperto, rimandato — D-155.** Chiuderlo richiede una scelta di prodotto
(origine di preview separata di default, preview senza `allow-same-origin`, o chiave AI non
estraibile) e va verificato con `pnpm ide:smoke`; non è stato toccato in questo PR per non
rompere storage/cookie/Service Worker della preview senza copertura browser. Il rischio residuo
resta quello documentato in D-063.

**Evidenza.**
- `ide/src/vv/preview-sandbox.ts:10-17` — senza `VITE_PREVIEW_ORIGIN`/`VITE_PREVIEW_WILDCARD_DOMAIN`
  (profilo open, default) il sandbox iframe è
  `allow-scripts allow-same-origin allow-forms allow-popups allow-modals`: il codice di progetto
  condivide l'origine dell'IDE.
- `ide/src/components/ide/PreviewPanel.tsx:112` — `sandbox={previewSandbox(hasSeparatePreviewOrigin)}`.
- `ide/src/ai/settings.ts:10-14` — la API key del provider AI è in chiaro in
  `localStorage("vv-ai-settings")` (scelta accettata in D-045); `ide/src/ai/mcp/mcp-config.ts` fa
  lo stesso per i token MCP. OPFS contiene i progetti di tutte le tab.
- `ide/public/sw.js` e il bridge preview hanno messaggi `postMessage(..., "*")` ma con origin
  check lato host: in same-origin il check passa per definizione.

**Impatto.** Il codice del progetto (incluso codice scritto dall'AI, potenzialmente influenzato da
prompt injection o da dipendenze del progetto) viene eseguito same-origin con l'IDE: può leggere la
API key del provider e i token MCP da `localStorage`, l'OPFS con i progetti, e usare il bridge
Service Worker. Nel profilo managed (preview su origine separata) questo non accade. Rischio
residuo documentato (D-063) ma rilevante perché il codice non è fidato per costruzione.

**Rimedio.** Rendere l'origine separata il default anche nel profilo open o, se non possibile,
togliere `allow-same-origin` (accettando di perdere cookie/storage del preview) e tenere la AI key
in un contesto non leggibile al frame (worker/crypto non-estraibile), svuotandola durante il
preview di codice non fidato. Documentare il confine nel threat model.

### SEC-11 — PBKDF2 sotto la raccomandazione e timing oracle — Bassa, confidenza alta
**Stato (2026-11-10): risolto — D-148.** 600k iterazioni e hash dummy nel blueprint di login.

**Evidenza.**
- `packages/auth/src/password.ts:3-4` — `pbkdf2-sha256` con 210.000 iterazioni; OWASP 2023
  raccomanda 600.000 per PBKDF2-HMAC-SHA256. Il parser accetta qualunque iterazione tra 1 e 1M
  senza minimo (`:30-48`).
- `examples/todo-app/server/routes/api/auth/login.post.ts:26-30` — utente inesistente: ritorno
  immediato senza PBKDF2 → differenza di tempo osservabile.

**Rimedio.** Portare il default a 600k (con migrazione trasparente al login) e un minimo nel parser;
eseguire una derivazione dummy quando l'utente non esiste.

### SEC-12 — Invarianti 1/2 affidate all'analyzer, non a un gate — Bassa, confidenza alta

**Stato (2026-11-10): risolto — D-154.** Nuovo gate in
`packages/analyze/src/routes-gate.test.ts`: esegue l'analyzer reale sulle route di `examples/` (e
`starter/`) dentro `pnpm test` e fallisce se `wrapper !== "valid"` o `dbTables` è assente/non
statico; un fixture negativo dimostra che scatta.

**Evidenza.**
- AGENTS.md invarianti 1-2; `packages/analyze/src/passes/routes.ts:40-74` produce il fatto
  `wrapper: "invalid"` solo per l'IDE; il validatore AI lo blocca per i patch
  (`packages/ai/src/rules/routes-security.ts`), ma per il codice scritto a mano non c'è enforcement.
- `package.json`: `lint` = oxlint + file-length + theme; nessun check che scansionino le route; nessun
  test di repo che fallisca su una route senza `defineAuthorizedHandler` o con `dbTables`
  incomplete (l'accuratezza non è verificabile staticamente in modo completo, ma la presenza e
  la coerenza con l'AST sì).

**Rimedio.** Aggiungere un gate CI (`scripts/check-routes.mjs` o test Vitest) che esegua l'analyzer su
`examples` e sui fixture e fallisca su `wrapper != valid` / `dbTables == null`; opzionale una
regola oxlint per il default export delle route.

### SEC-13 — Coda job senza ownership: cosa significa concretamente — Bassa, confidenza alta

**Il modello.** La coda è framework state, non dato applicativo: `facilis_jobs` ha le colonne
`id, name, status, input, output, error, attempts, …` e **una sola colonna di scope,
`tenant_id`** (`packages/db/src/jobs.ts:30-61`). La policy è
`facilis_jobs_tenant_access`: `using (nullif(current_setting('app.tenant_id', true), '') is not null)`.
Non esiste un `owner_id`, e nessuna policy nomina `app.user_id` o `app.roles`: l'unico permesso che
protegge un job è il **permesso della route** che lo espone, non la riga.

**Il percorso nel codice (perché il filtro utente non c'è).**
1. Nel wrapper, `ctx.jobs` è legato alla transazione della richiesta:
   `const requestJobs = jobs.bindScope?.(db) ?? jobs` (`packages/core/src/route.ts:229`).
2. `bindScope` costruisce lo store con quello scope
   (`packages/nitro/src/runtime/jobs/runtime.ts:77-80`); ogni operazione fa
   `runWithPolicyScope(db, { tenantId }, fn)` oppure usa direttamente lo scope della richiesta
   (`packages/nitro/src/runtime/jobs/db-store.ts:49-51`).
3. `get(id)` è `select * from facilis_jobs where id = $1` (`db-store.ts:69-75`); `list()` filtra
   solo per `status`/`name` (`db-store.ts:77-96`); `cancel()` aggiorna per id. Nessuna di queste
   query aggiunge `user_id`.
4. `toJobRecord` restituisce **`input` e `output`** (e `error`) al chiamante
   (`packages/core/src/jobs.ts:171-190`; mapping in `packages/nitro/src/runtime/jobs/row-mapping.ts:16-32`).

**Conseguenza pratica.** In un tenant multi-utente, chi ha il permesso dichiarato dalla route
(es. `todos:read` nel blueprint) può leggere il payload di **qualsiasi** job del tenant, non solo dei
propri, e con `todos:write` può cancellarlo — esattamente le due route di esempio
`examples/todo-app/server/routes/api/jobs/[id].get.ts` e `[id].delete.ts`. Oggi il payload del job
del blueprint è innocuo (`{ olderThanDays }`), ma un job reale porta spesso dati utente nel proprio
`input`/`output` (id di documenti, email, importi): diventerebbero leggibili a chiunque abbia il
permesso della route. L'ID è un UUID casuale, quindi non è enumerabile a tentativi; il rischio
concreto è (a) un route di listing che usa `ctx.jobs.list()`/`queue()` — che restituisce tutti i job
del tenant — oppure (b) un ID che finisce in un log/risposta condivisa. Il job *body* gira come
system, ma questo non cambia ciò che l'handler vede quando legge la coda.

**Esito (2026-11-10, D-145): permessi invece di system-only.** Il system-only avrebbe trascinato
in elevazione anche workflow e task (il loro runner gira come `facilis_app` sotto il tenant), con
audit su ogni lettura di coda. La coda resta quindi RLS-scoped e viene **gated per permesso a
livello di database**: `SELECT` richiede `jobs:read`, `INSERT`/`UPDATE`/`DELETE` richiedono
`jobs:exec` (policy su `app.permissions`, lo stesso meccanismo delle viste con permesso, D-098).
Il motore passa i due permessi di framework nella propria transazione; una richiesta porta quelli
della sessione, quindi una route che tocca la coda senza il permesso prende `permission denied`
dal DB. **La visibilità per-utente resta responsabilità dell'endpoint** (nessuna colonna owner):
chi implementa la route filtra se serve. Stesso schema previsto per `facilis_tasks`/
`facilis_workflows` quando atterrano (`tasks:read`/`tasks:decide`, `workflows:*`). Dettagli in
D-145; migrazione `examples/todo-app/db/migrations/0007_jobs_permissions.sql`; test in
`db-store.test.ts` (scope con permessi vs scope senza) e `migrations.test.ts`.

### SEC-14 — `dbTables` ed elevazioni autocertificati: la dichiarazione non era applicata — Media, confidenza alta

L'invariante 2 richiede `dbTables` presente e accurato, ma solo la **presenza** era garantita (gate
CI SEC-12/D-154). A runtime nessuno confrontava la dichiarazione con l'accesso: `ctx.db` è il client
Drizzle nella transazione `facilis_app`, e la RLS è il confine di grant, non di dichiarazione — una
route che dichiara `["todos"]` poteva leggere `users`, `auth_identities` o `auth_email_verifications`
(tutte RLS con policy tenant-wide) presentandosi al manifest/OpenAPI/grafo come una route che tocca
solo `todos`. Dentro `ctx.sudo`/`ctx.system` il problema è più grave: il callback gira come
`facilis_system` con `BYPASSRLS`, quindi può leggere qualsiasi riga di qualsiasi tenant, mentre
l'audit registra solo le `tables` **autodichiarate**; il trail di sicurezza era auto-certificato.
D-136/D-137 proteggevano solo le tabelle system-only (nessun grant → `permission denied`).

**Esito (2026-11-11, D-157).** `dbTables` è ora una dichiarazione applicata, per tabelle **e viste**
(una vista si dichiara con il proprio nome, D-097/D-098):
- **statico** — `@facilis.dev/analyze` risolve le `defineView` in `ViewFact` e un pass interprocedurale
  segue l'handler nelle funzioni del progetto (chiamate annidate), registrando `from/join`,
  `insert/update/delete(relazione)`, `db.query.<relazione>` e `db.execute`; produce
  `route-table-undeclared`, `route-table-unused`, `route-table-unresolved`, `route-raw-sql` e
  `route-elevation-undeclared`, il gate CI li blocca e il validator AI ha la regola 18
  `route-table-declared` su tutte le route effettive;
- **runtime** — il client di `ctx.db` e quello delle callback di elevazione sono proxati: una
  relazione non dichiarata fallisce chiusa con `500 table_not_declared` prima della query, e
  `db.execute` (SQL non ispezionabile) richiede `rawSql: true` sulla route, altrimenti
  `500 raw_sql_not_allowed`; le escape hatch raw (`$client`/`session`) sono chiuse. L'audit delle
  elevazioni registra le tabelle **osservate** (`observedTables`) accanto a quelle dichiarate, così
  il trail non è più auto-certificato; `ctx.jobs` resta fuori (framework, D-107).

Residui: SQL raw autorizzato con `rawSql` e frammenti `sql` dentro i builder non sono ispezionabili
a runtime (li copre solo l'analisi statica quando il frammento è nel codice); le chiamate dentro i
pacchetti sono opache per l'analisi statica (il runtime resta l'autorità); le viste non hanno ancora
nodi/edge nel grafo (O-013, Phase 4).

## 2. Controlli verificati (cosa tiene)

- **Wrapper route** (`packages/core/src/route.ts:199-213`): ordine corretto origin → permesso →
  validazione → scope; 415 prima di leggere il body; errori solo codici; nessun dettaglio interno
  al client; un solo wrapper per tutte le route di esempio (17/17 file).
- **RLS come confine di grant** (`packages/db/src/policy.ts:75-112`): revoca di tutti i privilegi
  dell'app role, grant solo alle tabelle con `relrowsecurity`, niente default privileges,
  `NOINHERIT`, `SET LOCAL ROLE` con GUC parametrizzati (niente concatenazione di valori).
- **Elevazioni auditate** (`packages/core/src/sudo.ts`, `packages/db/src/sudo.ts:71-84`):
  sottoinsieme obbligatorio di `dbTables`, guardia anti-nesting, audit fail-closed *prima* del
  cambio ruolo, ripristino esplicito del ruolo (niente `RESET ROLE`).
- **SSO** (`packages/auth/src/sso/state.ts:104-114`): consumo atomico `DELETE ... RETURNING`,
  scadenza, pattern del token, `redirectTo` same-origin senza `//`/backslash/controlli;
  PKCE S256 + nonce + state; linking per `(provider, subject)`; segreti solo da env; nessun
  segreto nei log (`identity.ts:125` rifiuta le email non verificate lato provider).
- **Token endpoint / API client** (`packages/auth/src/api-clients.ts:181-256`): segreto e token
  memorizzati solo come SHA-256, confronto costante, revoca per client, `cache-control: no-store`,
  audit senza segreti, 401 generico.
- **Storage** (`packages/nitro/src/storage.ts:51-160`): URL firmati HMAC con scadenza e binding
  tenant/file, disabilitazione fail-closed in produzione senza `FACILIS_STORAGE_SECRET`
  (`packages/nitro/src/runtime/storage-target.ts`), header di download sicuri (CSP `sandbox`,
  `nosniff`, `attachment`), chiavi content-addressed validate.
- **Log** (`packages/nitro/src/runtime/logging/redact.ts`): redazione per chiave, cap di
  profondità/dimensione, nessun endpoint HTTP per i log, catena hash audit, audit fail-closed.
- **IDE**: nessun accesso OPFS fuori dal kernel (`ide/src`: solo `localStorage` per preferenze;
  verificato con grep); token git/GitHub solo in memoria
  (`ide/src/vv/github-oauth.ts:212-223`); relay CDP con controllo `event.origin` e
  `event.source === frame` (`ide/src/vv/preview-devtools.ts:121-174`); policy dei tool PTC
  (`ide/src/ai/ptc/policy.ts`) che blocca `.env`/chiavi/`.git`/`node_modules` e redige i
  valori; patch applicate solo dopo il validatore (`ide/src/facilis/apply-patch.ts:72-90`).
- **Supply chain**: nessun segreto nei file tracciati né nella storia git (solo fixture x509
  upstream in `vendor`); `.gitignore` copre `.env*`/`.facilis`; submodulo `vendor/vivari`
  pinnato a un commit (`e654919`); CI con `permissions: contents: read`,
  `--frozen-lockfile`, submoduli, versioni Node/pnpm fissate; git proxy con allowlist host e
  header (`ide/git-proxy/handler.mjs`) e bind su `127.0.0.1` nello script dev.

## 3. Rischi accettati noti (non nuovi finding)

- **Route `crossSite` e cookie di sessione (SEC-05, ritirato):** accettare l'utente loggato
  (cookie) su una route `crossSite` è il comportamento voluto, perché l'API deve restare
  utilizzabile dall'app con i ruoli; l'esposizione cross-site resta Bearer. Residuo teorico: con
  applicazioni non fidate su sottodomini *same-site* la POST con cookie non è fermata dal gate
  sull'origine — da rivalutare solo se un deploy introduce quel caso.
- API key del provider AI e token MCP in `localStorage` in chiaro: scelta documentata in D-045
  ("nothing here is encrypted"), accettata per il modello minaccia browser; il finding SEC-10
  riguarda la sua raggiungibilità dal codice di progetto.
- Preview same-origin nel profilo open: comportamento documentato (D-063) — riportato come rischio
  residuo, non come deviazione.
- Dev endpoint attivi quando `NODE_ENV` non è `production`: semantica letterale di SPEC
  §6.1/§8.5; il finding riguarda il default fail-open, non l'intenzione.
- IdP-initiated: D-120 dice esplicitamente che non è accettato; SEC-07 è la deviazione
  implementativa.
- `vendor/vivari` non è stato auditato (upstream read-only, pin); `ide/public/sw.js` è stato
  letto solo per i punti di contatto (bridge/preview), non riga per riga.

## 4. Priorità di rimedio

**Stato al 2026-11-11: P0/P1 completati (D-146…D-157).** L'unico punto rimasto è SEC-10 (P2,
rimandato con D-155). La verifica email (D-156) ha chiuso SEC-02 alla radice; l'eventuale evoluzione
"registrazione deferred" chiuderebbe anche l'ultimo canale indiretto di enumerazione di SEC-04.

1. **P0** — SEC-01 (bootstrap admin), SEC-02 (pre-hijacking SSO): introdurre la verifica email o un
   bootstrap a token; normalizzare l'email. Sono i due percorsi con impatto più alto e rimedio
   contenuto. **(completato: D-150 per il bootstrap, D-156 per verifica email e claim SSO)**
2. **P0** — SEC-04 (throttling) e SEC-03 (fail-closed in produzione): entrambe sono capacità del
   framework, non del singolo progetto, e proteggono tutte le app generate.
3. **P1** — SEC-06 (policy per-utente sulle tabelle credenziali) e SEC-07 (SAML binding):
   deviazioni rispetto al contratto scritto, con impatto su confidenzialità/replay.
4. **P2** — SEC-08/09 (DoS), SEC-10 (isolamento preview), SEC-11/12/13/14 (hardening e gate; SEC-13
   risolto con i permessi `jobs:read`/`jobs:exec`, D-145; SEC-14 con l'enforcement di `dbTables`,
   D-157).

## 5. Limiti dell'analisi

- Analisi statica sul commit 69985e4; nessuna esecuzione di exploit e nessuna scansione CVE delle
  dipendenze (rete non disponibile). Per SEC-06 è stato eseguito un test PGlite temporaneo (poi
  rimosso) che conferma la visibilità cross-utente delle sessioni; nessun altro test dinamico.
- Le route framework-owned sono state lette integralmente; le route applicative solo per i flussi
  auth/file/job. Il codice IDE è stato campionato sui punti di contatto con credenziali, VFS e
  bridge; `vendor/vivari` è escluso.
- La gravità di SEC-03 dipende dalla configurazione di deploy (se la piattaforma imposta
  `NODE_ENV=production`, l'impatto si riduce a hardening); SEC-01/02 dipendono dall'esporre la
  registrazione pubblica, che è però il blueprint documentato.
