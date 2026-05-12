---
title: Patreon login
---

An optional, additive overlay on top of password auth. Roles always have a password gate. When Patreon is configured, **a role can also accept Patreon OAuth login** if its name appears in the `patreon.tiers` mapping. Patrons whose pledge grants the linked tier can sign in directly without the password.

## Setup

Each Wizzlethorpe Vaults deploy needs its own Patreon OAuth client. Patreon doesn't allow shared multi-tenant apps because the redirect URI must be pre-registered per app and they rate-limit + bill per app.

### 1. Register an OAuth client on Patreon

Go to [patreon.com/portal/registration](https://www.patreon.com/portal/registration)
and create a new client. You'll get:

- **Client ID** (public; safe to commit)
- **Client Secret** (sensitive; lives in `.env` as `PATREON_CLIENT_SECRET`,
  then rides up as a Cloudflare Wrangler secret on `vaults push`)

For the **Redirect URIs** field, register two kinds of URL:

```
# 1. One per domain your deploy answers on (visitor logins)
https://your-vault.pages.dev/auth/patreon/callback
https://your-custom-domain.example.com/auth/patreon/callback

# 2. The CLI / preview loopback
http://localhost:4173/auth/patreon/callback
```

Port `4173` matches the default `vaults preview` port, so this single
loopback URI covers both `vaults patreon configure` (one-shot campaign /
tier fetch) AND any visitor-login flow you want to test against the live
deploy by previewing locally.

### 2. Configure the CLI

```bash
vaults patreon configure
```

Interactive prompt for **client ID** and **client secret**. The client secret is written to `.vaults/.env` (gitignored); the client ID lands in `.vaults/config.json` (trackable). After that the CLI offers to **auto-detect your campaign and tier list** via a one-shot OAuth dance:

- Opens your browser to Patreon
- You approve
- The CLI exchanges the resulting code for a creator access token
- Calls `/v2/campaigns` + `/v2/campaigns/{id}?include=tiers`
- Discards the token

### 3. Map roles to tiers (interactive)

After auto-detect runs, the same CLI session walks each non-default role
and shows a menu of tiers:

```
  Role: patron
    1. Backers ($5/mo, id 5551111)
    2. Producers ($25/mo, id 5552222)
    3. Patrons of Patrons ($100/mo, id 5553333)
    0. None. keep patron password-only
  Pick [0-3]: 1
```

Skipped roles stay password-only (no Patreon path). Existing mappings
ride forward when you re-run `configure`.

To adjust mappings later without re-running auto-detect:

```bash
vaults patreon link <role> <tier-id>
vaults patreon unlink <role>
```

To check the current state:

```bash
vaults patreon status
```

To remove a mapping (without removing Patreon entirely, password access remains):

```bash
vaults patreon unlink dm
```

To remove the entire Patreon block:

```bash
vaults patreon clear
```

### 4. Push

```bash
vaults push
```

The next deploy includes the OAuth handlers and a "Sign in with Patreon"
button on `/login` next to the password form.

## Troubleshooting

| Symptom | Most likely cause |
|---|---|
| "patreon_state_mismatch" | The visitor took longer than 10 minutes to authorise, OR a forged callback. |
| "patreon_token_exchange" | Wrong client secret on the deploy. Re-run `vaults push`. |
| "patreon_no_tier" | Visitor authenticated but their pledge isn't in your `tiers` map. |
| Button doesn't appear | `patreon.tiers` is empty. Run `vaults patreon link <role> <tier-id>`. |
| 500 "PATREON_CLIENT_SECRET secret is missing" | Upload didn't reach Cloudflare. Re-run `vaults push`. |
