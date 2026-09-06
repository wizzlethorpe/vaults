---
title: Patreon login
---

An optional way to grant a role. With Patreon configured, a role **accepts Patreon login** when its name appears in the `oauth.patreon.tiers` mapping in `.vaults/config.json`, and patrons whose pledge grants the linked tier sign in directly.

A password is not required alongside it. A role can be reachable by password, by Patreon, by [[OIDC login|OIDC]], or by any combination; a role reachable only through Patreon has no password set. See [[Role gating]] for how the login page adapts.

## Setup

Each deploy needs its own Patreon OAuth client. Patreon pre-registers redirect URIs per app, and rate-limits and bills per app, so one shared client cannot serve every vault.

### 1. Register an OAuth client on Patreon

Go to [patreon.com/portal/registration](https://www.patreon.com/portal/registration) and create a client. You get:

- **Client ID**: public, safe to commit.
- **Client Secret**: sensitive. It lives in `.env` at the vault root as `PATREON_CLIENT_SECRET` and is uploaded as a Cloudflare Wrangler secret on `vaults push`.

For the **Redirect URIs** field, register two kinds of URL:

```
# 1. One per domain your deploy answers on (visitor logins)
https://your-vault.pages.dev/auth/patreon/callback
https://your-custom-domain.example.com/auth/patreon/callback

# 2. The CLI and preview loopback
http://localhost:4173/auth/patreon/callback
```

Port `4173` is the default `vaults preview` port, so this one loopback URI covers `vaults patreon configure` (the one-shot campaign and tier fetch) and any visitor-login test against a local preview.

### 2. Configure the CLI

```bash
vaults patreon configure
```

An interactive prompt for **client ID** and **client secret**. The secret is written to `.env` (gitignored); the client ID lands in `.vaults/config.json`. The CLI then offers to **detect your campaign and tier list** with a one-shot OAuth flow:

- Opens your browser to Patreon.
- You approve.
- The CLI exchanges the code for a creator access token.
- It calls `/v2/campaigns` and `/v2/campaigns/{id}?include=tiers`.
- It discards the token.

The flow times out after five minutes.

### 3. Map roles to tiers

After detection, the same session walks each non-default role and shows a menu of tiers:

```
  Role: patron
    1. Backers ($5/mo, id 5551111)
    2. Producers ($25/mo, id 5552222)
    3. Patrons of Patrons ($100/mo, id 5553333)
    0. None (keep patron password-only)
  Pick [0-3]: 1
```

A role with an existing mapping shows `Pick [0-3] (Enter = keep):` instead. A skipped role stays password-only.

To adjust mappings later without re-running detection:

```bash
vaults patreon link <role> <tier-id>
vaults patreon unlink <role>      # removes one mapping; password access stays
vaults patreon status             # the current state
vaults patreon clear              # removes the Patreon configuration entirely
```

### 4. Push

```bash
vaults push
```

The next deploy includes the OAuth handlers and a "Sign in with Patreon" button on `/login`, beside the password form.

## Troubleshooting

| Symptom | Most likely cause |
|---|---|
| `patreon_state_mismatch` | The visitor took longer than 10 minutes to authorise, or the callback was forged. |
| `patreon_token_exchange` | Wrong client secret on the deploy. Re-run `vaults push`. |
| `patreon_no_tier` | The visitor authenticated but their pledge is not in your tier mapping. |
| `patreon_misconfigured` on the login page | The deploy has no `PATREON_CLIENT_SECRET`. Re-run `vaults push`. |
| The button does not appear | No role is mapped. Run `vaults patreon link <role> <tier-id>`. |
| 500 "PATREON_CLIENT_SECRET secret is missing" on `/auth/patreon/start` | The secret upload did not reach Cloudflare. Re-run `vaults push`. |
