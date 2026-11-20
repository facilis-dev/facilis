# D-153 — Cap dei byte del body prima del parsing e codice `payload_too_large` (SEC-09)
**Status:** accepted (2026-11-10)

SEC-09: il wrapper leggeva `req.json()`/`req.formData()` senza alcun limite; `storage.maxUploadBytes`
era controllato dopo che il body multipart era già bufferizzato. Un body enorme su una route pubblica
(login, registrazione) esauriva memoria senza che nulla lo fermasse.

**Decision.**

- **Cap nel wrapper.** JSON 1 MiB; multipart `storage.maxUploadBytes + 1 MiB` (1 MiB se lo storage non
  è configurato). Prima il `content-length`, se numerico e oltre il cap, rifiuta senza leggere; altrimenti
  un contatore sullo stream interrompe (e cancella il reader) appena supera il cap. Il parser riceve
  solo i byte entro il limite.
- **Nuovo codice chiuso.** `payload_too_large` = 413 con `details.maxBytes`, in
  `FACILIS_ERROR_CODES`/registry, nelle locale `en`/`it` e in `KNOWN_ERROR_CODES` del template.
- **Il test dei fake event resta com'era**: se non c'è stream (unit test, runtime non-Request) si usa il
  path precedente, così il wrapper resta usabile in ogni runtime Fetch.

**Rejected.** Fidarsi del solo `content-length` (assente in chunked e falsificabile); lasciare il
controllo a `storage.maxUploadBytes` (la memoria è già stata consumata); reimplementare il multipart
parser (si bufferizza una volta, ma entro il cap, e il parser standard resta valido).

**Consequences.** Un body JSON oltre 1 MiB è rifiutato (documentato: alzare il cap significa
cambiare il wrapper, non la config); un multipart può ancora bufferizzare fino a `maxUploadBytes + 1
MiB`, e un singolo file oltre `maxUploadBytes` resta rifiutato dal path storage con
`file_too_large`. SPEC §7.4/§8.2 e O-002 aggiornati.

**Verification.** `request-input.test.ts` (content-length, chunked, JSON/multipart sotto e sopra il
cap, errori esistenti invariati), suite core/nitro verdi, file-length e lint.
