# D-156 — Verifica email degli account password e claim SSO dell'account pendente (SEC-02)
**Status:** accepted (2026-11-10)

SEC-02 alla radice: il framework non aveva alcun modo di provare che un indirizzo appartenesse a chi
registrava. D-150 aveva chiuso il bootstrap e D-151 aveva bloccato il linking SSO a un account
password, ma restavano due problemi: un account password non era mai verificato (quindi il linking
restava disabilitato per sempre) e la registrazione pubblica poteva creare un account "segnaposto"
sull'indirizzo della vittima.

**Decision.**

- **Schema.** `users.email_verified_at` (timestamp nullable) è la prova; `auth_email_verifications`
  custodisce i link: chiave `sha256(token)`, `user_id` con `ON DELETE CASCADE`, `expires_at`,
  `tenant_id` e policy RLS come le altre tabelle auth (D-136). Un solo link attivo per utente: emettere
  un nuovo token cancella il precedente.
- **Primitive.** `issueEmailVerification` (TTL, rotazione), `consumeEmailVerification` (single-use:
  la riga viene cancellata prima del controllo di scadenza; token sconosciuto/scaduto → `null`) e
  `markEmailVerified` (fallback dev). Scrivono solo dentro l'elevazione audita `ctx.system`, come la
  registrazione: la route di verifica non ha sessione (D-099).
- **Config.** `auth.verification: { enabled (false), tokenTtlMs (24 h, max 30 giorni), successRedirect,
  failureRedirect }`; ogni chiave ha un default, `enabled: false` non cambia il comportamento di un
  progetto esistente.
- **Blueprint.** La registrazione crea l'utente con `email_verified_at` NULL, emette il link e risponde
  `{ accepted: true }` (mai il token, mai un oracolo di esistenza). Con la verifica attiva il login
  risponde `403 email_unverified` **dopo** la verifica della password, quindi non è un oracolo.
  `GET /api/auth/verify-email?token=…` consuma il link e redirige a
  `successRedirect?verified=1` / `failureRedirect?verify_error=invalid_token`, con audit
  `auth:email:verify`. Ri-registrare un'email con account PENDENTE reclama l'account (password
  sostituita, link ruotato): chi controlla la casella lo dimostra, chi ha solo registrato per primo no.
- **Delivery del progetto.** Il framework non spedisce email: il blueprint posta
  `{ to, subject, text }` a `FACILIS_EMAIL_WEBHOOK_URL` (opzionale `FACILIS_EMAIL_WEBHOOK_TOKEN`
  come Bearer). In `development`/`test`, se il webhook non è configurato, il link viene loggato e
  l'account verificato subito: demo e `ide:smoke` non richiedono una casella; la produzione senza
  webhook fallisce in modo visibile (log server-side) ma la risposta resta generica.
- **SSO (sostituisce D-151).** Il claim di un'identità verificata su un account PENDENTE rimuove la
  password segnaposto e marca l'account verificato prima di collegare l'identità (audit
  `auth:sso:link` con `claimed: "unverified_password"`); un account VERIFICATO si collega senza
  toccare la password. Il claim vale solo con la verifica email attiva: se è disabilitata
  l'identità non può distinguere un account pendente della vittima da uno reale del proprietario,
  quindi il linking è rifiutato con `sso_email_conflict` invece di azzerare una password in uso.
  `auth.sso.linkPasswordAccounts` viene rimosso: la verifica è la prova, non un interruttore.

**Rejected.** Registrazione "deferred" (creare l'utente solo dopo la verifica): eliminerebbe anche
l'ultimo canale di enumerazione, ma richiede una tabella di pending separata e cambia il contratto di
registrazione/bootstrap in un colpo solo; rimandato come possibile evoluzione. Link con HMAC stateless
(nessuna revoca/rotazione né single-use). Provider SMTP nel framework (segreti e deliverability sono
del deploy, come log e storage). Auto-verifica in produzione quando il webhook manca (fail-open).

**Consequences.** Un deploy che abilita la verifica deve impostare il webhook (documentato in README e
SPEC); la migrazione `0009` riempie `email_verified_at` per gli account esistenti, così un deploy già
in uso non si blocca. Resta un canale indiretto di enumerazione (registrazione → login: un account
verificato risponde `unauthorized`, uno pendente `email_unverified`), mitigato dal rate limit (D-152)
e chiudibile con la registrazione deferred. SSO.md, SPEC §5.1/§5.3/§8.4.4/§4.4 e i contratti Phase 1
sono aggiornati.

**Verification.** `email-verification.test.ts` (single-use, TTL, rotazione, token altrui, fallback
dev, scoped client), `identity-guard.test.ts` (claim che azzera la password e verifica, account
verificato che mantiene la password, claim non verificato rifiutato), `migrations.test.ts` (colonna,
tabella, RLS, indice), `starter-contract.test.ts` (route verify + primitive nel template), suite
auth/core/examples/analyze verdi.
