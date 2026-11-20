# D-150 — Bootstrap a token monouso e email canonica: l'indirizzo non è una credenziale (SEC-01)
**Status:** accepted (2026-11-10)

SEC-01: la registrazione è pubblica e non verifica l'email, ma `registerInitialAdmin` promuoveva ad
`admin` chi registrava per primo l'indirizzo di `FACILIS_INITIAL_ADMIN` (confronto case-insensitive,
mentre `users.email` era unico case-sensitive: una variante di maiuscole passava). Chi conosce
l'indirizzo poteva diventare admin senza possedere la casella.

**Decision.**

- **L'indirizzo non è una credenziale.** La promozione richiede anche
  `FACILIS_INITIAL_ADMIN_TOKEN`: entrambe le env var devono essere impostate, il token si confronta in
  tempo costante (hash SHA-256 di entrambi i valori e confronto dei byte) e manca il token → nessuna
  promozione (fail closed). La promozione avviene solo se non esiste già un `admin`: è monouso, quindi
  tenere la variabile configurata dopo il bootstrap non permette una seconda promozione.
- **Email canonica.** `normalizeEmail` (trim + minuscolo) è usata in registrazione, login, linking SSO
  e confronto di bootstrap; la tabella `users` guadagna l'indice unico `users_email_lower_idx`
  (`lower(email)`, migrazione `0008`), così il database rifiuta le varianti quanto l'applicazione.
- **Risposta generica.** La route di registrazione del blueprint risponde `{ accepted: true }` sia al
  successo sia all'email già registrata, senza ruolo né id: non è più un oracolo per l'esistenza di un
  account né per la promozione; l'esito reale (ruolo) resta nell'audit server-side.
- **Il token viaggia nel body** della registrazione, mai loggato (il redact di D-119 copre i body: non
  vengono registrati) e protetto dal throttle della route (D-152).

**Rejected.** Verifica email vera (richiede trasporto email e token: feature separata, vedi SEC-02);
promozione solo CLI/migrazione (il blueprint ha bisogno di un bootstrap dalla sua stessa superficie);
fidarsi dell'indirizzo con `emailVerified` assente (è proprio il difetto); allowlist di IP.

**Consequences.** Il deploy documentato ha una seconda variabile; un token perso richiede di
rigenerarlo prima del primo bootstrap. La migrazione `0008` fallisce su un database che contiene già
varianti di maiuscole dello stesso indirizzo (pre-rilascio: si azzera il DB di sviluppo). SPEC
§5.1/§5.3/§8.4.3 e la quickstart sono aggiornate.

**Verification.** `seed.test.ts` copre env mancanti, token errato, variante di maiuscole, promozione
unica e blocco dopo il primo admin; `migrations.test.ts` verifica l'indice; suite auth/core/examples.
