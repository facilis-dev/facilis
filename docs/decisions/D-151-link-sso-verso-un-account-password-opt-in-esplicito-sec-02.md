# D-151 — Link SSO verso un account password: opt-in esplicito (SEC-02)
**Status:** superseded by D-156 (2026-11-10) — l'opt-in è stato sostituito dal claim basato sulla
verifica email; l'analisi del problema resta valida.

SEC-02 (pre-hijacking): D-120 assume che un'email verificata basti a collegare un'identità SSO a un
utente esistente, ma un account creato dalla registrazione password non ha alcuna prova di possesso
dell'indirizzo. Chi registra per primo l'email della vittima ottiene un account con una password che
conosce; al primo login SSO della vittima il flusso lo collegherebbe a quell'account, consegnandolo
all'attaccante.

**Decision.** `auth.sso.linkPasswordAccounts` (default `false`) abilita il link a un account con
`password_hash` non-null; senza opt-in `resolveIdentity` rifiuta con il nuovo codice sicuro
`sso_email_conflict` (redirect, nessun dettaglio). Gli account provisionati da SSO (password null)
continuano a collegarsi per email verificata, e le email di utenti/identità sono salvate canoniche
(D-150).

**Rejected.** Implementare ora la verifica email (nuova feature: campo, token, trasporto, template);
rifiutare sempre il link per email (romperebbe l'unione di identità SSO multiple sullo stesso
account); creare un secondo utente con lo stesso indirizzo (l'indice unico lo impedisce).

**Consequences.** Una migrazione password→SSO richiede di impostare il flag (rischio documentato)
oppure di aspettare la verifica email; l'errore è un redirect sicuro, non un 500. La decisione
D-120 resta valida per il claim del provider. Sorveglianza futura: verifica email vera, linking
con notifica all'utente, e la stessa guardia per inviti/admin.

**Verification.** `identity-guard.test.ts`: rifiuto con password, link con opt-in, email canonica;
login OIDC/SAML esistenti verdi; `sso-config` validation test.
