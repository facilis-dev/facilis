# D-081 — Git authentication is HTTP Basic: a token, or an account password where the host still allows one
**Status:** accepted (2026-11-02)

The dialogs asked for a "token" only, which read as if username/password were impossible. In
fact the transport is HTTP Basic: isomorphic-git builds one Authorization header, and the proxy
forwards it untouched. What differs per host is only whether an account password is accepted as
the password half.

**Decision.** Keep the token as the recommended credential, and accept an account password on
the hosts that still allow it.

- **Same field, two meanings.** The secret field takes a token; when a username is also given it
  is treated as that account's password (`normalizeGitSecret` in `git-provider.ts`). It is still
  per operation, never stored, never in a URL or a log.
- **Username is the switch.** The `Remote git` dialog already had an optional username; the
  import dialog now has the same field in a deployment with the proxy. Without a username the
  host's token-as-password default username (D-079) is used, so a token needs no username.
- **GitHub is token-only.** GitHub removed account-password authentication for git in 2021, so
  its copy says so; GitLab, Gitea/Forgejo and self-hosted hosts accept a password when the
  account has no 2FA, and their copy says the username is required.
- **The REST fallback stays token-only.** Publishing and the CORS-based import use the host's
  API with a token (`PRIVATE-TOKEN`/bearer); a password is never sent there, and a real-git
  clone that fails while a username is set reports the clone error instead of retrying via REST.

**Rejected alternatives.** A separate "password" field would imply the two are different wire
formats; they are not. Asking GitHub for a password would be a dead end, so the UI never labels
the field as password-only. OAuth device flow would avoid long-lived secrets, but it is a
per-host authorization dance and a follow-up, not a replacement for a token.

**Consequences.** Users of hosts that still accept passwords can authenticate without minting a
token; everyone else uses a token, which remains the recommendation (scoped, revocable). The
proxy operator sees the credential transiently either way — the same trust boundary as D-079 —
and no password is stored by the IDE.
