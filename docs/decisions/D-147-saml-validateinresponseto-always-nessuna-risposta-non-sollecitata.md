# D-147 — SAML: `validateInResponseTo: "always"`, nessuna risposta non sollecitata
**Status:** accepted (2026-11-10)

SEC-07: `"ifPresent"` lega l'asserzione alla AuthnRequest solo quando l'asserzione porta
`InResponseTo`; una risposta IdP-initiated o una replay senza quel campo passava la validazione
(restava solo il RelayState, che l'attaccante può creare). Ora node-saml richiede sempre
`InResponseTo` e lo confronta con il request id dello state monouso; il commento del modulo e il
test SAML sono allineati a "sempre", non "se presente".
