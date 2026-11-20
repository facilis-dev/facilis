# D-155 — Isolamento della preview "open" (SEC-10) rimandato a una feature IDE dedicata
**Status:** accepted (2026-11-10)

SEC-10: nel profilo open la preview gira same-origin con l'IDE (`allow-same-origin`), quindi il codice
del progetto può leggere la AI key/MCP token da `localStorage` e l'OPFS. La chiusura richiede o
un'origine di preview separata di default o la rimozione di `allow-same-origin`, entrambe scelte di
prodotto che cambiano cookie/storage/Service Worker della preview (D-063, D-132) e vanno verificate
con `pnpm ide:smoke` in un browser.

**Decision.** Non toccare il sandbox in questo PR di hardening: il rischio residuo resta documentato in
D-063 e nel finding SEC-10, che resta aperto. La feature IDE dedicata sceglierà fra origine separata di
default, preview senza `allow-same-origin`, o chiave AI non estraibile (worker/crypto), e aggiornerà il
threat model.

**Rejected.** Rimuovere `allow-same-origin` ora (rompe storage e cookie della preview, e la pipeline
`ide:smoke` non è eseguibile in questa sessione); dichiarare il profilo open "sicuro" senza modifiche.

**Consequences.** SEC-10 resta un finding aperto con priorità P2, tracciato nell'audit; nessuna regressione
nelle preview attuali.
