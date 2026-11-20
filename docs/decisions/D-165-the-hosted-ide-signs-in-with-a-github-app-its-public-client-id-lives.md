# D-165 — The hosted IDE signs in with a GitHub App; its public client id lives in the deploy config
**Status:** accepted (2026-11-11)

**Context.** D-082 chose the GitHub device flow and left the registration as "an OAuth app, once
per deployment". The hosted IDE on `ide.facilis.dev` is a public product surface whose build is
in this repo: it must not hold a client secret, and it should ask for the narrowest permission
that still allows a clone and a push rather than the blanket `repo` scope.

**Decision.** The hosted deployment registers a **GitHub App** with device flow enabled:
repository permissions `Contents: Read and write` plus the mandatory `Metadata: Read-only`; no
webhook, no callback URL, no private key, no client secret. Its **client id** — public by design
— lives in `deploy/ide.facilis.dev.json`, which `.github/workflows/deploy-ide.yml` passes to the
build through `FACILIS_DEPLOY_CONFIG` (D-077). The device-flow code is unchanged: GitHub Apps
ignore OAuth scopes (permissions come from the app registration) and the same two proxied
endpoints return a user access token. The app must be **installed** on every account whose
repositories the token pushes to; a user access token only reaches accounts where the app is
installed.

**Consequences.** Consent shows a fine-grained app instead of the `repo` scope, and the token can
only write the contents of installed repositories. Installation is a step an OAuth app does not
have (one click, `Install App`, per account), and the app's user tokens expire after 8 hours
unless expiring tokens are disabled — the IDE keeps the token in tab memory and asks for a new
sign-in, which D-082 already accepts. The client id is committed, so the deployment is
reproducible; another deployment with its own app points `FACILIS_DEPLOY_CONFIG` at its own
config file. An OAuth app remains supported and documented for deployments that prefer it.
