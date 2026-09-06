---
title: OIDC login
---

An optional single sign-on overlay for **any standards-compliant OIDC issuer**: a university, Google Workspace, Auth0, Keycloak, an internal identity server. Where [[Patreon login]] grants a role from a pledge tier, OIDC grants it from the signed-in identity's **email address**.

Use it when a vault's audience is a class, a lab or a company rather than a set of supporters.

## How access is granted

A non-default role may carry a rule listing exact emails, exact domains, or both:

| Role | Rule |
|---|---|
| `student` | domains: `lion.lmu.edu` |
| `staff` | domains: `lmu.edu`; emails: `dean@lmu.edu` |

On sign-in the middleware reads the email from the issuer's userinfo endpoint and grants the **highest-ranked** role whose rule matches. A visitor matching no rule is not signed in: the login page shows an error and they keep reading at the default role. A role with no rule is reachable by whatever else grants it, like an unmapped Patreon tier.

Matching is exact:

- **Case-insensitive, no folding.** No plus-address or dot folding: `a+b@x` is its own address.
- **A domain rule matches only the final domain.** `me@cs.lmu.edu` does not match `lmu.edu`. List subdomains explicitly.

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

You supply the issuer URL, a display name for the login button, and the client credentials. The CLI fetches `<issuer>/.well-known/openid-configuration` and writes the three endpoints into the deploy, so the running middleware never fetches discovery. If discovery is unreachable you can enter the endpoints by hand. It warns when the issuer does not advertise the `email` scope or PKCE `S256`.

The same session then prompts each non-default role for its rule. Entries are comma-separated; anything containing an `@` past the first character is an email, everything else a domain:

```
Grant roles by email and/or domain (comma-separated, e.g.
'dean@lmu.edu, lion.lmu.edu'). Enter keeps the current rule, 'none'
clears it (password-only).
Exact matches only; list subdomains explicitly.
  student [lion.lmu.edu]:
  staff (Enter to skip): dean@lmu.edu, lmu.edu
```

The client secret is written to `.env` at the vault root as `OAUTH_CLIENT_SECRET` (gitignored) and uploaded as a Cloudflare secret on push. Everything else lands in `.vaults/config.json`, which is safe to commit.

### 3. Push

```bash
vaults push
```

The login page shows a "Sign in with *&lt;display name&gt;*" button once at least one role has a rule.

To inspect or remove the configuration:

```bash
vaults oidc status
vaults oidc clear
```

## Notes

- The flow uses PKCE (`S256`) and a signed, short-lived CSRF state cookie, the same hardening as the Patreon round-trip.
- OIDC and Patreon can be configured on the same vault. Each button runs its own flow and grants the highest role that provider's rules match; signing in again through the other button replaces the session.
- OIDC can replace password auth. Add roles with `--no-password` (or press Enter at the prompt) and the login page drops the password form and role picker, leaving only the provider button. See [[Role gating]].
