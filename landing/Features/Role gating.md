---
title: Role gating
---

A vault can have access tiers. A multi-role build emits one variant per role, and a Cloudflare Pages Function in front rewrites each request to the right variant from a session cookie. This vault has three tiers: **public** (anyone), **patron** (paying readers) and **dm** (the campaign GM).

> [!info] Test passwords
> | Role | Password |
> |---|---|
> | `patron` | `patron-pass` |
> | `dm` | `dm-pass` |
>
> Use the auth box in the sidebar. A higher tier sees everything below it: `dm` sees patron and public content too.

## Two kinds of gating

### Page-level

Add `role: <name>` to a page's frontmatter and the page is included only in that tier's build and the tiers above it. Lower tiers get no HTML, no body, no search hit, no hover preview and no Foundry entry. The page does not exist for them.

```yaml
---
title: The Witchwood Cult
role: patron
---
```

Examples in this vault:
- [[Witchwood Cult]]: `role: patron`
- [[Hidden Caves]]: `role: dm`

As a public visitor, those links render unresolved (faded and italic, pointing nowhere), and a direct URL returns the 404 page.

### Callout-level

A callout whose **type matches a configured role name** is stripped from every variant below that role:

```markdown
> [!patron] For supporters
> Backers see this paragraph.

> [!dm] DM-only
> Only the GM sees this paragraph.
```

[[Aelar]] has both a `[!patron]` and a `[!dm]` callout. Sign in at each tier to see the difference. The surrounding paragraphs stay; only the role-tagged blockquote is removed.

## Setup

```bash
vaults role add patron     # offers a password; press Enter to skip
vaults role add dm         # same
vaults push                # multi-role build and auth middleware
```

A password is one way to reach a role, not the only one. Press Enter at the prompt (or pass `--no-password`) for a role granted by [[Patreon login|Patreon]] or [[OIDC login|OIDC]] instead:

```bash
vaults role add staff --no-password
vaults oidc configure              # grant 'staff' by email domain
```

**The login page renders only the methods the deploy has.** With no password on any role there is no password form and no role picker, only the provider button. With exactly one password role the picker disappears too. `vaults role list` shows what each role accepts, and the build warns about any role that nothing can reach.

Roles are ordered by the time they were added, lowest first. To reorder:

```bash
vaults role promote dm     # move up
vaults role demote patron  # move down
```

To see what is configured:

```bash
vaults role list
```

## Production hardening

The auth Function does two things by default:

- **Signed, partitioned, HttpOnly session cookies** (HMAC-SHA256).
- **A signed CSRF state cookie** on the Patreon and OIDC round-trips, with a 10-minute TTL.

What it does not do, and what to consider configuring on Cloudflare:

- **Rate limiting on `/login` and `/connect/approve`.** PBKDF2 costs about 100 ms per guess, which slows but does not stop a distributed credential spray. Cloudflare's rate limiting has a free tier; turn it on for those routes if the vault is high-value. Cloudflare's DDoS protection covers volumetric attacks, not a slow trickle.
- **WAF rules.** The free tier includes a managed ruleset.

Rotate the cookie-signing key any time you suspect a leak:

```bash
vaults push --rotate-secret
```

On a multi-role vault this generates a fresh `SESSION_SECRET`, uploads it to Cloudflare, invalidates every issued cookie and bearer token, and writes the new value to the vault's `.env`. On a single-role vault there is no secret to rotate and the flag does nothing.
