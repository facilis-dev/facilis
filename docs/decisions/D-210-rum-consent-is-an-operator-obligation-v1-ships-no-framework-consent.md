# D-210 — RUM consent is an operator obligation; v1 ships no framework consent gate
**Status:** accepted (2026-11-24)

**Context.** D-203 §7 records that value-free attributes are necessary but not sufficient:
error messages can carry PII, RUM is spoofable and noisy, and "a consent gate may be required
per deployment". Its open questions ask "whether a consent gate ships in v1". Issue #141
requires the consent position (GDPR/ePrivacy) to be recorded, plus operator collector guidance.
This decision answers the open question for v1 and records the evaluation.

**Evaluation.**

- *What personal data could telemetry carry?* The closed vocabulary (D-203 §1–§2, spec §8.8)
  carries no values: route templates, method, status, duration, declared table/job/workflow
  names, the pinned web-vital triple, and the error constructor type. No message, stack,
  query string, body, header, cookie, user id or persistent client identifier is emitted.
  URLs are templated (UUID, numeric and email-shaped segments collapse to `:id`); the client
  scrubs as defense in depth and the ingestion allowlist is the final gate.
- *IP addresses.* The browser exports same-origin to the app's ingestion route
  (`/__facilis/telemetry/v1/traces`); the app forwards server-side and sends no end-user IP
  (`ingest/forward.ts` carries only the scrubbed OTLP payload). The collector therefore sees
  the app's egress IP — the operator's own infrastructure. End-user IPs reach a collector only
  in operator-chosen topologies (direct exposure, a proxy that injects the client address as an
  attribute, other OTLP sources); the reference collector configs truncate those to /24 (IPv4)
  and /48 (IPv6).
- *ePrivacy (Directive 2002/58/EC, Art. 5(3)).* Consent is required for storing or accessing
  information on the user's terminal equipment unless strictly necessary. Facilis RUM sets no
  cookie and stores no persistent identifier, so the framework itself does not trigger
  Art. 5(3). An operator who combines telemetry with other trackers inherits their consent
  duties for that combination.
- *GDPR.* The operator chooses the purpose, the backend and the retention, so the operator is
  the controller; Facilis hosts nothing and receives nothing, so it is not a processor. IP
  addresses are personal data (Recital 30; Breyer, C-582/14) even when truncated, and the
  residual surface is minimal but not provably zero — a spoofed client or a misconfigured
  deployment could carry more, which is why the collector-side allowlist exists. Legitimate
  interest (Art. 6(1)(f)) is arguable for minimal, value-free operational telemetry, but the
  balancing test, transparency (Arts. 13–14) and any DPIA (Art. 35) are the operator's; where
  national law or the operator's own policy requires consent, it must be obtained **before**
  telemetry is enabled.

**Decision.**

1. **v1 ships no framework consent gate.** Telemetry is off by default and enabled only through
   build-time deploy options (D-203 rule 5). A runtime consent switch would add a runtime policy
   surface that D-203 excludes, and a consent UX is app-specific.
2. **The operator is the data controller** and must assess the lawful basis — and obtain consent
   where required — before enabling telemetry. `docs/TELEMETRY.md` carries the guidance; the
   deploy documentation points to it.
3. **The framework minimizes what could require consent:** the value-free vocabulary, no
   persistent identifiers, no cookie/storage access, client and server scrubbing, head sampling,
   and the operator-side redaction/IP-truncation reference configs (`docs/telemetry/`), whose
   allowlists are gated against the vocabulary by `collector-config.test.ts`.
4. **A framework consent gate is deferred post-v1** (runtime opt-in/opt-out UI for RUM). This
   answers D-203's open question for v1. If it lands later, it must not weaken the build-time
   off switch or the spec §8.8 gates.

**Consequences.**

- D-203's "whether a consent gate ships in v1" open question is answered: no; the obligation is
  documented operator-side. D-203 itself stays unchanged as the historical record.
- D-119 is unchanged: the audit/log pipeline is server-side and never browser-exported, so this
  decision does not touch it. D-200 is unchanged: dev telemetry stays local.
- The reference collector configs become part of the privacy contract: allowlist drift or a
  missing IP-truncation rule fails `pnpm test`.

**Verification.** `pnpm lint`, `pnpm test` (scrub suites + `collector-config.test.ts`);
doc review of `docs/TELEMETRY.md`.
