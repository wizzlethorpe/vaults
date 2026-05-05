---
title: Patreon login
---

# Patreon login

An optional, additive overlay on top of password auth. Roles always have a
password gate (current behaviour); when Patreon is configured, **a role can
also accept Patreon OAuth login** if its name appears in the `patreon.tiers`
mapping. Patrons whose pledge grants the linked tier can sign in directly;
devs/testers/exceptions still use the password.

## When this is useful

You're running a paid TTRPG campaign worldbuilding wiki, a fiction site
with patron-only chapters, a development log with backer access — anything
where some access tiers correspond to Patreon pledges. Configure Patreon
once, link tiers to roles, and patrons sign in by clicking a button instead
of you handing out passwords.

The model is **strictly additive**:

| Role | Password | Tier | Result |
|---|---|---|---|
| `public` | _(default — none)_ | _(none)_ | Always public |
| `patron` | ✓ set | linked to "Backers" tier | Either path: password OR Patreon |
| `dm` | ✓ set | _(no tier mapping)_ | Password only |
| `dev` | ✓ set | _(no tier mapping)_ | Password only |

Roles without a tier mapping don't get a Patreon path even when Patreon is
configured globally — important for dev / tester / manual roles.

## Setup

Each Wizzlethorpe Vaults deploy needs its own Patreon OAuth client.
Patreon doesn't allow shared multi-tenant apps because the redirect URI
must be pre-registered per app and they rate-limit + bill per app.

### 1. Register an OAuth client on Patreon

Go to [patreon.com/portal/registration](https://www.patreon.com/portal/registration)
and create a new client. You'll get:

- **Client ID** (public; safe to commit)
- **Client Secret** (sensitive; lives in `.vaultrc.json` then rides up as
  a Cloudflare Wrangler secret)

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

Interactive prompt for **client ID** and **client secret**. After that
the CLI offers to **auto-detect your campaign and tier list** via a
one-shot OAuth dance:

- Opens your browser to Patreon
- You approve
- The CLI exchanges the resulting code for a creator access token
- Calls `/v2/campaigns` + `/v2/campaigns/{id}?include=tiers`
- Discards the token

The token is **never persisted** — only the campaign ID + tier ID list
end up in `.vaultrc.json`.

### 3. Map roles to tiers (interactive)

After auto-detect runs, the same CLI session walks each non-default role
and shows a menu of tiers:

```
  Role: patron
    1. Backers ($5/mo, id 5551111)
    2. Producers ($25/mo, id 5552222)
    3. Patrons of Patrons ($100/mo, id 5553333)
    0. None — keep patron password-only
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

To remove a mapping (without removing Patreon entirely — password access
remains):

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

## How it works at runtime

1. Visitor clicks **Sign in with Patreon** on the login page.
2. The Pages Function generates a CSRF state token in a short-lived
   signed cookie and redirects to Patreon's authorize endpoint.
3. Visitor approves on Patreon.
4. Patreon redirects back to `/auth/patreon/callback?code=…&state=…`.
5. Function verifies the state cookie, exchanges the code for an access
   token, fetches the visitor's identity + memberships from Patreon's
   `/v2/identity` endpoint.
6. Function filters memberships to your campaign, walks the visitor's
   currently-entitled tiers, picks the highest role whose mapped tier
   appears, issues the same signed session cookie as password login.

The visitor's Patreon access token is never stored. We use it once,
immediately, to look up tier entitlements.

## Cookie lifetime

The session cookie issued via Patreon login is identical to the
password-login cookie (7 days, signed with `SESSION_SECRET`). If a patron
downgrades or cancels their pledge, their existing session continues
working until it expires; the next sign-in won't reauthorize them.

Rotate `SESSION_SECRET` (`vaults push --rotate-secret`) to invalidate
every issued cookie immediately.

## Troubleshooting

| Symptom | Most likely cause |
|---|---|
| "patreon_state_mismatch" | The visitor took longer than 10 minutes to authorise, OR a forged callback. |
| "patreon_token_exchange" | Wrong client secret on the deploy. Re-run `vaults push`. |
| "patreon_no_tier" | Visitor authenticated but their pledge isn't in your `tiers` map. |
| Button doesn't appear | `patreon.tiers` is empty. Run `vaults patreon link <role> <tier-id>`. |
| 500 "PATREON_CLIENT_SECRET secret is missing" | Upload didn't reach Cloudflare. Re-run `vaults push`. |

## Security notes

- The Patreon **client secret** is stored on `.vaultrc.json` so the CLI
  can re-upload it on each `vaults push`. Same risk profile as the
  password hashes and `sessionSecret` already in that file. **Make sure
  `.vaultrc.json` is gitignored** — every CLI command that writes
  secrets there now warns loudly when it isn't.
- Visitor access tokens are never persisted; we use them once at login.
- The Pages Function's `/auth/patreon/start` endpoint uses a CSRF-signed
  state cookie with a 10-minute TTL to bind the authorize-redirect to
  the visitor's browser session, so a forged callback can't impersonate.
