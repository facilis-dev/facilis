# D-190 — A patch that writes invalid JSON is refused, whichever catalogue it is
**Status:** accepted (2026-11-18)

**Context.** Rule 13 parses the effective `locales/en.json` and reports a broken catalogue as a
**warning**; nothing parsed `locales/it.json` at all. A patch could therefore write a catalogue
the client imports, and the next hot update failed in Vite's native JSON parser with
`expected value at line 22 column 21`, `Plugin: builtin:vite-json`, `File: [object Object]` —
the position but not the file. Reported from a real IDE session: an AI patch broke the Italian
catalogue, the dev server answered 500 for that module, and the only message the user saw named
neither the file nor the tool that had written it.

**Decision.** A structural check, `json-parse`, runs on every patch — context-free, beside
`content-present`, so it also covers write-tool calls with a thin context. A create/update patch
whose path ends in `.json` is parsed with `JSON.parse` before anything is written; a failure is an
**error** (`ok: false`, nothing written) carrying the file, the parser's line and column when it
reports one, and the offending line as `excerpt`. A leading BOM is dropped, because Vite drops
one.

**Consequences.** The model gets the repair in its own terms, in the call it just made, instead
of the user reading a wasm stack trace; `locales/it.json` is covered exactly like the default
catalogue. Rule 13 keeps its warning, which can now only fire when the catalogue on disk was
already broken before the patch. It is not rule 20: it needs no analysis, so the §9.3 table
keeps its 19 numbered rules.

**Verification.** `packages/ai/src/validator-json-parse.test.ts` pins the rejection (trailing
comma, missing value, nested path, normalized path), the BOM acceptance, the offset-to-line
mapping for both message shapes, and the two non-cases (a non-JSON file, a delete).
