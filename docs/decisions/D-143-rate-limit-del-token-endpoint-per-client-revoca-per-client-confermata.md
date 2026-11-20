# D-143 — Rate limit del token endpoint per client, revoca per client confermata
**Status:** accepted (2026-11-10)

`POST /api/auth/token` accettava tentativi illimitati: un loop con il secret sbagliato arrivava a
un confronto SHA-256 (costante nel tempo) per ogni richiesta e nulla lo rallentava. D-142 aveva
gia' scelto la revoca per client (client + ogni token emesso); l'owner ha chiesto il rate limit e
confermato che la revoca per client e' la granularita' giusta.

**Decision.**

- **Finestra fissa in-process per client id.** Il token endpoint consuma un tentativo prima di
  toccare il database, sia che il secret sia corretto sia che non lo sia; a budget esaurito
  risponde `429 too_many_requests` con `retry-after` in secondi interi. La chiave e' il
  `client_id` della richiesta (le richieste malformate restano un 400 senza costo DB e non
  consumano budget). Il limiter e' un Map con finestre per chiave, potata oltre 1024 chiavi, cosi'
  un attaccante che ruota `client_id` non fa crescere la memoria senza limite.
- **Config.** `auth.apiClients.rateLimit: { windowMs, maxRequests }` (default 60000/30): trenta
  scambi al minuto sono molto sopra il fabbisogno di un client legittimo (il token dura un'ora) e
  abbastanza sotto per rendere inutile un brute force. Entrambe le chiavi sono interi positivi;
  configurarle e' indipendente dall'abilitare gli API client.
- **Nuovo codice di errore.** `too_many_requests` = `429` entra nella registry chiusa (O-002);
  il template registra `errors.too_many_requests` in `locales/en.json`/`it.json` e in
  `KNOWN_ERROR_CODES`, cosi' il client traduce il codice come gli altri. Il tentativo bloccato e'
  auditato come `auth:token:issue` fallito con `errorCode: "too_many_requests"`; il client id non
  viene loggato in quel ramo (non serve a correlare e non e' un dato utile).
- **Nessuno store condiviso.** Un deploy Facilis esegue un solo processo Nitro, quindi lo stato in
  memoria e' coerente; piu' istanze richiederebbero uno store condiviso (Redis o DB) che il
  framework non spedisce, e il limite dichiara questo confine invece di fingere di averlo risolto.
  Un riavvio azzera le finestre.
- **Revoca per client, confermata.** `revokeApiClient` marca il client e ogni suo token nella
  stessa operazione, e' idempotente e un token di un client revocato non autentica piu'. Non c'e'
  revoca per singolo token: la superficie di gestione e' il client, la rotazione e' revoca +
  ricreazione, e un token ha gia' una vita breve. Una tabella `api_tokens` revocabile a mano
  sarebbe un secondo pannello di amministrazione senza un caso d'uso.

**Rejected.** Rate limit in banca dati (una scrittura per tentativo, e lo stato di throttle non
appartiene alle tabelle app-scoped), limiter globale invece che per client (un client rumoroso
affamerebbe gli altri), revoca per singolo token (superficie di gestione senza un caso d'uso),
refresh token (gia' rifiutato in D-142).

**Consequences.** Il token endpoint e' throttled di default anche se nessuno lo configura; il
blocco e' per processo e si azzera al riavvio. La config `auth.apiClients` guadagna un terzo
blocco con default, quindi le app esistenti non cambiano comportamento finche' non abilitano gli
API client. Docs: SPEC §7.1/§7.4/§8.6, contracts §4.4.

**Verification.** `rate-limit.test.ts` (budget, deny con retry-after, finestra che si riapre,
chiavi indipendenti, clock iniettabile), `token.post.test.ts` (429 + `retry-after` + lo scambio
negato non arriva al database + audit), config tests (default e validazione di windowMs/
maxRequests), errors test (429 nella registry), root gates lint/typecheck/test/build.
