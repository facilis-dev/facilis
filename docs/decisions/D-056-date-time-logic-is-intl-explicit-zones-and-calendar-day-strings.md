# D-056 — Date/time logic is `Intl`, explicit zones and calendar-day strings
**Status:** accepted (2026-10-31)

The framework must not add a date library (bundle + in-VM install cost) and cannot rely on
Temporal: it is not in Node 22/24 and is not guaranteed in the WebContainer browser. The base
logic therefore lives in a zero-dependency `@facilis.dev/time` package built only on `Intl`:

- formatting takes `{ locale, timeZone }` explicitly (runtime zone only as a documented
  default); instants are `Date`/ISO strings;
- a calendar day is the `YYYY-MM-DD` string, with `dateOnlyOf`/`today` producing it *in a
  zone* and `formatDateOnly`/start-of-day/end-of-day consuming it without shifting it;
- start/end of day are DST-aware (offset probing, no arithmetic on naive local time);
- invalid input throws instead of rendering garbage.

**Consequences:** one small module with a tested time-zone contract; no configuration. An app
that needs recurring rules, duration math or a picker writes/copies that on top.
