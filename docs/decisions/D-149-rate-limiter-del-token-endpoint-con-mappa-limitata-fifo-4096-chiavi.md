# D-149 — Rate limiter del token endpoint con mappa limitata (FIFO, 4096 chiavi)
**Status:** accepted (2026-11-10)

SEC-08: il limiter creava una finestra per ogni `client_id` distinto e potava la mappa solo oltre
1024 chiavi, pagando uno sweep O(n) per ogni chiave nuova (memoria e CPU controllate
dall'attaccante, che sceglie il client id prima dell'autenticazione). Ora la mappa ha un cap fisso
(FIFO: si evince la finestra più vecchia) e il costo per chiave nuova è O(1); la quota resta per
client id (l'eventuale lockout di un client altrui è accettato: senza store condiviso non c'è
un'alternativa migliore, e il token dura un'ora). Il test copre l'eviction.
