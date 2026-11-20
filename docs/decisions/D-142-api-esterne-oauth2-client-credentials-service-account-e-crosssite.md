# D-142 — API esterne: OAuth2 client-credentials, service account e crossSite autenticato
**Status:** accepted (2026-11-10)

L'owner vuole esporre API ad altri sistemi. Il modello scelto: un endpoint OAuth2
client_credentials (client id + secret) che rilascia un access token, API taggate come esposte, e
il ruolo scelto sulla credenziale. D-141 aveva reso crossSite sinonimo di route pubblica
(permission: []); questa decisione lo estende al caso autenticato e corregge l'assunzione — errata
— che l'ACS SAML restasse fuori dal wrapper.

**Decision.**

- **Service account nella tabella users.** users.is_service (boolean, default false) e' l'unico
  marcatore. Un service account non puo' mai fare login: validateSession lo rifiuta, createSession
  lancia, il flusso SSO non lo linka ne' lo provisiona, la route di login del template lo rifiuta.
  Non ha password (password_hash null) e non e' un utente persona; resta la riga per RLS, audit e
  ownership (ownerId = il suo id).
- **Tabelle app-scoped (D-136).** api_clients (client_id pubblico unico, secret hashato, nome,
  ruolo, service user, createdBy, revokedAt, lastUsedAt) e api_tokens (token hashato unico, client,
  service user, expiresAt, revokedAt, lastUsedAt) hanno RLS con la policy parent-user-access
  (ereditano la visibilita' del service user nella tenant scope): sono raggiungibili dal ruolo
  applicativo, come sessions, senza un secondo meccanismo di elevation. Nessuna FK verso roles
  (system-only): il ruolo e' validato contro config.auth.roles.
- **Endpoint framework POST /api/auth/token.** Body JSON { grant_type: "client_credentials",
  client_id, client_secret } (deviazione documentata da RFC 6749, che usa form-urlencoded: la
  route e' coerente con il contratto JSON del framework). Risposta { access_token,
  token_type: "Bearer", expires_in } con cache-control: no-store. Nessun refresh token: RFC 6749
  §4.4 non lo prevede per client_credentials; il rinnovo e' un nuovo grant. 404 quando
  auth.apiClients.enabled e' false; 401 generico per client/secret errati o revocati (nessuna
  enumerazione); audit di emissione e fallimenti senza mai loggare il secret. Access token opachi
  (32 byte random, solo hash SHA-256 a riposo), TTL auth.apiClients.tokenTtlMs.
- **Bearer nel middleware di sessione.** Con Authorization: Bearer <token> il middleware valida il
  token nella stessa tenant policy scope del cookie e popola context.auth con il service user e il
  ruolo del client espanso dalla config (via: "bearer", sessionHash = hash del token per l'audit).
  Un Bearer invalido non fa fallback al cookie. Le route cookie restano SameSite=Lax + gate D-141:
  il gate non e' toccato dal Bearer perche' un client server-to-server non manda Origin; un browser
  cross-site con Bearer deve comunque usare una route crossSite.
- **crossSite = esposta, con permessi.** Il throw di D-141 (crossSite solo con permission: [])
  sparisce: una route crossSite con permessi e' valida ed e' raggiungibile solo con un'identita'
  Bearer. Resta nel manifest (RouteMeta.crossSite) e in OpenAPI (x-cross-site + security:
  [{ bearerAuth: [] }] con lo scheme dichiarato); il preflight CORS consente l'header
  authorization. Le route pubbliche (permission: []) non cambiano.
- **originCheck: "skip" per i protocolli.** L'ACS SAML e' un POST cross-site e la route SSO e' un
  defineAuthorizedHandler: senza eccezione il gate D-141 la rifiuterebbe. Il config del wrapper
  guadagna originCheck?: "enforce" | "skip" (default enforce), usato solo dagli endpoint di
  protocollo framework-owned; un'app non deve usarlo.
- **Gestione dei client nel template.** Helper in @facilis.dev/auth (createApiClient, listApiClients,
  revokeApiClient) e route del template starter protette da permessi dell'app
  (api-clients:read/api-clients:write): il secret e' mostrato una sola volta, il ruolo e' scelto
  tra config.auth.roles, la revoca invalida i token esistenti, la lista non restituisce mai hash.
  Un supporto Studio/UI arrivera' solo se serve.

**Rejected.** Refresh token (non esiste in client_credentials; sarebbe un secondo segreto a vita
lunga), JWT (revoca immediata piu' difficile dei token opachi), tabella service_accounts separata
(FK e policy custom per un caso che users.is_service copre), ruolo fotografato nel token (un
cambio/revoca del client deve valere subito), API key non-OAuth (l'owner ha chiesto client id +
secret + token).

**Consequences.** auth.apiClients.enabled e' false di default: nessun endpoint nuovo finche' l'app
non lo attiva. I service account compaiono in users e vanno filtrati con is_service. crossSite non
significa piu' "pubblica": permission decide se serve un Bearer. L'ACS SAML torna a funzionare
cross-site. Docs: SPEC §5.3/§6.9/§7.1/§7.4/§8.4.4/§8.6, contracts §4.4.

**Verification.** api-clients.test.ts (creazione service user, secret mai in chiaro, grant, secret
errato, revoca, scadenza, ruolo), session tests (Bearer, no fallback, service user rifiutato,
createSession throw), SSO guard test, route tests (originCheck skip, crossSite + permission
definibile), token route test (404/401/200/400), analyzer warning, OpenAPI bearerAuth, manifest,
typecheck/test/lint/build root.
