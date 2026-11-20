# D-146 — Rilevamento produzione fail-closed: solo `development`/`test` sono dev
**Status:** accepted (2026-11-10)

L'audit SEC-03 ha mostrato che `isProductionEnvironment` era `NODE_ENV === "production"`: un deploy
che ometteva la variabile otteneva i dev endpoint (manifest, dev/query, dev/schema, dev/view), il
cookie senza `Secure`, i log su file e il fallback PGlite. Il default ora è **fail-closed**: solo
`NODE_ENV=development` o `NODE_ENV=test` sono dev; qualunque altro valore (incluso l'assenza) è
produzione. Lo stesso helper governa cookie, storage, logging, dev guard e rifiuto di PGlite in
produzione, quindi non restano controlli con default diversi. Docs e test aggiornati: i test che
simulavano "dev" con `{}` ora passano `NODE_ENV: "development"`.
