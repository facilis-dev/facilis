# D-115 — Getting past the app's own login (preview tools)

**Status:** accepted (2026-11-08)

The owner asked how the AI copes with a generated app that requires a login before it can be
inspected. The preview tools (D-111) can click and type, but nothing told the model what a login
screen means.

**Decision.**

- The prompt (`PREVIEW_PROMPT` in `ide/src/ai/prompt.ts`, appended only when a preview tool is
  registered) teaches the flow: the preview runs inside the user's own session, so a login the
  user already did is usable; when the app is not logged in, the model registers a throwaway
  account through the app's own form (the development database is per project) or asks the user —
  it never guesses a real password. The guidance also says where the fields live (the app's page
  source, e.g. `src/pages/login.tsx`), that generated inputs commonly carry no `name` attribute
  (select by type or label), and that a redirect to the login route is an ended session, not a
  broken page.
- An OAuth/SSO or two-factor step lives outside the preview frame: the model asks the user to
  complete it and continues afterwards. The IDE stores no credentials, and a throwaway account
  exists only in the project's development database.
- The session is the kernel's cookie jar, one per listening port and therefore per project
  (`vendor/vivari/AGENTS.md`, "The kernel keeps the cookie jar…"): the preview frame the tools
  drive is the same one the user sees, so the user's login is shared and two projects never share
  a session.

**Rejected alternatives.** *A credential store in the IDE*: the app's dev database is ephemeral and
per project, and storing passwords would add a secret surface for no function. *A dev auth bypass
the model can use*: it would skip the real flow — the very thing being investigated — and would
have to ship in generated apps. *Seeding a demo user in every template*: the user row is app data,
not framework data, and the templates do not own their tables' contents.

**Consequences.** The model stops treating a login page as a failure and exercises the flow the way
a user would. Anything the frame cannot reach (external IdP, 2FA, CAPTCHA) is handed back to the
user.

**Verification.** `prompt.test.ts` (the login guidance appears with a preview tool and not
without one); gates green.
