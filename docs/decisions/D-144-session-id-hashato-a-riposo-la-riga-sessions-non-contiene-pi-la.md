# D-144 — Session id hashato a riposo: la riga `sessions` non contiene più la credenziale
**Status:** accepted (2026-11-10)

L'audit di sicurezza (SEC-06) ha mostrato che le policy RLS padre di `sessions`, `user_roles`,
`api_clients`, `api_tokens` e `auth_identities` sono tenant-wide per necessità: il middleware di
sessione valida il cookie **prima** di conoscere l'utente, quindi la sua transazione ha solo
`{ tenantId }` e non può usare `app.user_id`. Il problema specifico di `sessions` era però che la
colonna chiave **era il valore del cookie**: una lettura della tabella (consentita al ruolo app nel
tenant) restituiva credenziali vive.

**Decision.** La riga memorizza `sha256(cookie id)`; il valore grezzo (32 byte casuali, base64url)
esiste solo nel cookie. `createSession` calcola l'hash prima della INSERT e restituisce il valore
grezzo al chiamante che imposta il cookie; `validateSession` e `destroySession` hashato il valore
presentato prima della query. Nessuna modifica di schema (la colonna resta `text`), quindi nessuna
migrazione; `AuthContext.sessionHash` (D-099) coincide già con la chiave di riga, e il trail di audit
continua a non contenere il cookie.

**Rejected.** Policy per-utente su `sessions`: bloccherebbe il lookup pre-auth (l'utente non è noto);
`sessions` system-only con lettura in elevazione: richiede un `SET LOCAL ROLE` per richiesta e
sposta il filtro `tenant_id` nelle query (rimandato: è la stessa scelta dei job, e può essere
rivalutato insieme). La revoca del grant al ruolo app non è praticabile senza una delle due.

**Consequences.** Le sessioni esistenti al momento dell'aggiornamento diventano irraggiungibili
(righe con id grezzo): gli utenti rifanno il login, accettabile perché le sessioni sono effimere e
scadono comunque. La tabella `sessions` resta RLS-scoped e tenant-wide: una lettura non espone più
credenziali riutilizzabili, ma resta visibile la mappa utente→sessioni (id hashati). Se in futuro si
vorrà nascondere anche quella, la strada è `sessions` system-only (stessa decisione dei job).

**Verification.** `session.test.ts` (la riga è `sha256(cookie)` e l'id grezzo non compare nella
tabella; lifecycle, scadenza, distruzione, middleware, Bearer che non fa fallback al cookie),
suite `@facilis.dev/auth` (135 test) e typecheck del pacchetto.
