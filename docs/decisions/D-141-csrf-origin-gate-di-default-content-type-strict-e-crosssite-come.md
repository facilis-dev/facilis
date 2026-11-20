# D-141 — CSRF: origin gate di default, Content-Type strict, e `crossSite` come dichiarazione di esposizione
**Status:** accepted (2026-11-10)

L'owner ha chiesto se con i cookie SameSite un token CSRF sia ancora necessario e se un flag
per-route possa dichiarare un'API chiamabile dall'esterno del sito. L'analisi ha mostrato che
`SameSite=Lax` copre il caso classico (POST cross-site su route autenticate da cookie) ma non:
le route che *scrivono* cookie (login/logout/register), il same-site cross-origin (sottodomini
dello stesso registrable domain), le GET che mutano stato, e non e' una difesa del framework ma
del browser. Inoltre la preview in-VM tiene la sessione nel cookie jar del kernel, dove
`SameSite`/`Secure` sono ignorati: la protezione esiste solo in un deploy reale, e il deploy
dell'app generata e' fuori scope (SPEC §2.2).

**Decision.**

- **Il choke point e' `defineAuthorizedHandler`.** Prima del controllo di permission, ogni
  richiesta con metodo unsafe (POST/PUT/PATCH/DELETE) passa un gate dell'origine: `Sec-Fetch-Site`
  e' autoritativo quando presente (`same-origin`/`none` ammessi; `same-site` ammesso solo verso
  un'origine in `security.trustedOrigins`; `cross-site` rifiutato); in sua assenza si confronta
  `Origin` con l'header `Host` (o con `trustedOrigins`); `Origin` assente = client non-browser,
  ammesso (il CSRF e' un attacco del browser; l'autenticazione resta comunque richiesta), `null`
  rifiutato. Il rifiuto e' `403 forbidden` e passa dal logging come ogni altra uscita.
- **Content-Type strict.** Una route con schema `body` accetta solo `application/json`, una con
  `form` solo `multipart/form-data`; ogni altro media type e' `415 unsupported_media_type`
  (nuovo codice del registry chiuso O-002), letto prima del body. Chiude il trucco della simple
  request `text/plain` con body JSON, che non fa preflight, e rende obbligatorio il preflight per
  una fetch JSON cross-origin.
- **`security.trustedOrigins`** (default `[]`, origini assolute http/https senza path/query) e'
  l'escape hatch per SPA e API su origini diverse dello stesso sito. Non abilita da sola la
  lettura cross-origin: quella resta dichiarata per route.
- **`crossSite?: boolean`** (default `false`) in `AuthorizedHandlerConfig`: dichiara una route
  *pubblica* chiamabile da una pagina su un'altra origine, senza credenziali. E' ammesso solo con
  `permission: []` (altrimenti `defineAuthorizedHandler` lancia: un cookie di sessione non
  attraversa le origini) e viene rifiutato dall'analyzer con `route-cross-site-authenticated`.
  Propaga come gli altri campi statici (RouteFact -> RouteMetadata -> `x-cross-site` in OpenAPI,
  `crossSite` in `RouteMeta`); un valore non statico e' `null`/unresolved, mai indovinato. Una
  middleware Nitro registrata prima di context/session risponde al preflight (`204` + CORS) e
  aggiunge `Access-Control-Allow-Origin` alle sole route flaggate: il flag dichiara l'esposizione,
  non e' la difesa CSRF.
- **Niente token CSRF per ora.** Con `SameSite=Lax` + Content-Type strict + gate dell'origine il
  token sarebbe ridondante per le route cookie first-party. Torna necessario solo se si
  introduce `SameSite=None`/embed di terze parti, un allowlist cross-site con credenziali, o
  un'auth a token; login-CSRF non si risolve con un token legato alla sessione (non esiste ancora)
  ma con il gate, che copre anche login/logout/register.
- **Il POST cross-site dell'ACS SAML** e' una route framework-owned che passa dal wrapper (e'
  un defineAuthorizedHandler), quindi il gate la rifiuterebbe: la decisione D-142 aggiunge
  originCheck: 'skip' al suo config. Resta l'unico endpoint di protocollo con l'eccezione.

**Rejected.** Solo CORS (non ferma le scritture simple/form e non protegge nulla lato server);
token CSRF adesso (ridondante, richiede binding di sessione e un trattamento pre-login);
`SameSite=None` (riapre il CSRF e peggiora l'isolamento); il flag come unica difesa (non e' una
difesa); `__Host-` immediato (richiede Secure+Path=/+no Domain, inerte nel cookie jar del kernel
in dev e un rename di contratto: rimandato a un deploy reale).

**Consequences.** Le richieste unsafe cross-site verso le route applicative ora rispondono `403`
salvo dichiarazione esplicita; login/logout/register CSRF sono chiusi; `SameSite=Lax` resta la
difesa di default del cookie. Un deployment dietro un proxy che riscrive `Host` deve aggiungere
la propria origine pubblica a `security.trustedOrigins`. La preview in-VM continua a funzionare:
il browser manda `Sec-Fetch-Site: same-origin` attraverso il proxy e il cookie jar del kernel non
e' governato da SameSite. Il registry errori resta chiuso: aggiungere un codice e' una decisione,
non un refactor.

**Verification.** `request-security.test.ts` (cross-site/same-site/trusted/Origin/Host/assenti),
route tests (`403` cross-site, `415` media type; il throw `crossSite`+permission e' rimosso da
D-142), config tests
(default e validazione origini), analyzer tests (`route-cross-site-authenticated`, null
fail-closed), `cors-policy.test.ts` (match `{id}`/`{*rest}`, preflight, trusted), manifest/OpenAPI
tests (`crossSite`, `x-cross-site`), typecheck/test/lint/build root.
