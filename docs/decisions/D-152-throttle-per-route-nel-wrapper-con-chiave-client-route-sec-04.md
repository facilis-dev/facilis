# D-152 — Throttle per route nel wrapper, con chiave client + route (SEC-04)
**Status:** accepted (2026-11-10)

SEC-04: l'unico rate limit del framework era il token endpoint; login e registrazione del blueprint
non avevano alcun limite (credential stuffing illimitato, creazione massiva di account). Il login
aveva già il tempo costante (D-148), mancava il volume.

**Decision.**

- **Capacità del wrapper.** `defineAuthorizedHandler({ rateLimit: { windowMs, maxRequests } })`
  consuma un tentativo dopo l'origin gate e prima di permessi e parsing del body: `429
  too_many_requests` con `retry-after`, e un audit `http:rate_limit` fallito. La chiave è
  `METHOD path clientAddress`: stessa finestra per client e route, mai condivisa fra route.
- **Address dal middleware.** `event.context.facilis.clientAddress` è risolto con `getRequestIP`
  (socket; `x-forwarded-for` solo con `logging.trustProxy`). Senza un address fidato non si applica
  il throttle: meglio nessun limite che una finestra condivisa che un attaccante può esaurire per
  bloccare tutti (fail open esplicito, documentato).
- **Limiter condiviso e limitato.** Riusa la finestra fissa in-process di D-149 (cap 4096 chiavi,
  eviction FIFO), una sola istanza per processo.
- **Blueprint.** Login 10/minuto per client, registrazione 5/minuto; il token endpoint mantiene la
  sua quota per `client_id` (D-143).

**Rejected.** Chiave basata su `x-forwarded-for` senza trust (spoofabile: si ruota l'header e il
limite sparisce); fallback a una finestra globale (DoS di login a costo zero); lockout per account
(richiede stato per account, crea un DoS mirato e non copre il credential stuffing distribuito);
store condiviso (nessuno in questa fase, D-143).

**Consequences.** In deploy dietro proxy va configurato il trust (srvx `trustProxy` o un proxy che
sovrascrive `x-forwarded-for`), altrimenti il throttle non parte; in sviluppo senza address il
limite è inerte. Lo stato è per processo e si azzera al riavvio. SPEC §7.4/§8.2 e contracts aggiornati.

**Verification.** `route-rate-limit.test.ts` (429 + retry-after, chiavi per client, route separate,
nessun address → nessun throttle), `context.test.ts` (clientAddress solo da fonte fidata),
`rate-limit.test.ts` invariato, blueprint con i due limiti.
