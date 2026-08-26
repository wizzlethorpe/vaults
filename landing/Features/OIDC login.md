---
title: OIDC login
---

An optional single sign-on overlay for **any standards-compliant OIDC issuer** (your university, Google Workspace, Auth0, Keycloak, an internal identity server). Where [[Patreon login]] grants a role from a pledge tier, OIDC grants it from the signed-in identity's **email address**.

This is the path to use when a vault's audience is a class, a lab, or a company rather than a set of supporters.

## How access is granted

Each role gets a rule listing exact emails and/or exact domains:

```
student   →  domains: lion.lmu.edu
staff     →  domains: lmu.edu,  emails: dean@lmu.edu
```

On sign-in the middleware takes the email from the issuer's userinfo endpoint and awards the **highest-ranked** role whose rule matches. A visitor matching no rule falls back to the default (public) role rather than being refused, so an SSO-only vault still serves its public pages to anyone. Roles with no rule are reachable by whatever else grants them, exactly like an unmapped Patreon tier.

Matching is deliberately strict:

- **Exact, case-insensitive.** No plus-address or dot folding: `a+b@x` is its own address.
- **A domain rule matches only the final domain.** `me@cs.lmu.edu` does **not** match `lmu.edu`. List subdomains explicitly.

## Setup

### 1. Register a client with your issuer

Ask for an **authorization code** client with the `openid email` scopes, and register these redirect URIs:

```
https://your-vault.pages.dev/auth/oidc/callback
https://your-custom-domain.example.com/auth/oidc/callback
http://localhost:4173/auth/oidc/callback
```

The loopback port matches `vaults preview`, so one entry covers local testing.

### 2. Configure the CLI

```bash
vaults oidc configure
```

You supply the issuer URL, a login-button display name, and the client credentials. The CLI fetches `<issuer>/.well-known/openid-configuration` and bakes the three endpoints into the deploy, so the running middleware never fetches discovery. If discovery is unreachable you can enter the endpoints by hand. It warns when the issuer doesn't advertise the `email` scope or PKCE `S256`.

The same session then walks each non-default role and prompts for its rule. Entries are comma-separated; anything containing an `@` past the first character is read as an email, everything else as a domain:

```
Grant roles by email and/or domain (comma-separated, e.g.
'dean@lmu.edu, lion.lmu.edu'). Enter keeps the current rule, 'none'
clears it (password-only).
  student [lion.lmu.edu]:
  staff: dean@lmu.edu, lmu.edu
```

The client secret is written to `.vaults/.env` as `OAUTH_CLIENT_SECRET` (gitignored) and uploaded as a Cloudflare secret on push. Everything else lands in `.vaults/config.json`, which is safe to commit.

### 3. Push

```bash
vaults push
```

The deploy grows a "Sign in with *&lt;display name&gt;*" button on `/login`. The button only appears once at least one role has a rule.

To inspect or remove the configuration:

```bash
vaults oidc status
vaults oidc clear
```

## Notes

- The flow uses PKCE (`S256`) plus a signed, short-lived CSRF state cookie, the same hardening as the Patreon round-trip.
- OIDC and Patreon can be configured on the same vault. A visitor takes whichever route grants them the stronger role.
- OIDC can **replace** password auth rather than sitting alongside it. Add roles with `--no-password` (or press Enter at the prompt) and the login page drops the password form and role picker entirely, leaving only the provider button. See [[Role gating]].
