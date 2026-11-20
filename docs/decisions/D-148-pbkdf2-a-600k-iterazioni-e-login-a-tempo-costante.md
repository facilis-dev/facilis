# D-148 — PBKDF2 a 600k iterazioni e login a tempo costante
**Status:** accepted (2026-11-10)

SEC-11: PBKDF2-SHA256 era a 210.000 iterazioni (sotto la raccomandazione OWASP di 600.000) e il
blueprint di login usciva **prima** di `verifyPassword` quando l'email non esisteva (o l'account
era SSO/service), creando un timing oracle per l'enumerazione. Default portato a 600.000 (gli hash
esistenti restano validi: le iterazioni sono nel formato versionato) e il blueprint verifica un
hash dummy valido quando l'account non ha password, così il costo PBKDF2 — e il tempo di risposta —
è lo stesso in tutti i casi. Il rate limiting resta aperto (SEC-04).
