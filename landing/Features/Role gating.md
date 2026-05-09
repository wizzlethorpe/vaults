---
title: Role gating
---

Vaults supports access tiers. Multi-role builds emit one variant per
role, with a Cloudflare Pages Function in front that rewrites requests
to the right variant based on a session cookie. This vault has three
tiers: **public** (anyone), **patron** (paying readers), and **dm**
(the campaign GM).

> [!info] Test passwords
> | Role | Password |
> |---|---|
> | `patron` | `patron-pass` |
> | `dm` | `dm-pass` |
>
> Use the auth box in the sidebar. Higher tiers see everything below them
> too — `dm` sees patron + public content as well.

## Two flavours of gating

### Page-level (whole-page invisibility)

Add `role: <name>` to a page's frontmatter and the entire page is **only
included in that tier's build (and higher tiers)**. Lower tiers don't get
the HTML, the body, the search hit, the sitemap entry, or the manifest
entry. The page structurally doesn't exist for them.

```yaml
---
title: The Witchwood Cult
role: patron
---
```

Examples in this vault:
- [[Witchwood Cult]] — `role: patron`
- [[Hidden Caves]] — `role: dm`

Try clicking these as a public visitor: the link itself renders as
"unresolved" (muted text, no anchor), and a direct URL hit returns
the 404 page.

### Callout-level (paragraph-scoped redaction)

Add a callout whose **type matches a configured role name** and the
callout is stripped from every variant lower than that role:

```markdown
> [!patron] For supporters
> Backers see this paragraph.

> [!dm] DM-only
> Only the GM sees this paragraph.
```

[[Aelar]] has both a `[!patron]` and a `[!dm]` callout — toggle tiers and
watch the page change shape. Surrounding paragraphs stay; only the
role-tagged blockquote disappears.

## Setup

```bash
vaults role add patron     # prompts for a password
vaults role add dm         # prompts for a password
vaults push                # multi-role build + auth middleware
```

Roles are ordered by add time, lowest → highest. To reorder:

```bash
vaults role promote dm     # move up
vaults role demote patron  # move down
```

To see what's configured:

```bash
vaults role list
```

## Production hardening

The auth Function does several things by default:

- **Signed, partitioned, HttpOnly session cookies** (HMAC-SHA256).
- **CSRF state cookies** on the Patreon round-trip with a 10-minute TTL.

What it does **not** do, and what you should consider configuring on Cloudflare:

- **Rate limiting on `/login` and `/connect/approve`.** PBKDF2 is slow (~100 ms per guess) but a determined attacker can still brute-force common passwords from a botnet. Cloudflare's Rate Limiting is a paid feature (but there is a free tier). Turn it on for those routes if your vault is high-value. Cloudflare's built-in DDoS protection covers volumetric attacks but not slow-trickle credential spray.
- **WAF rules.** The free tier includes a managed ruleset. Consider enabling it on production deploys.

Rotate the cookie-signing key any time you suspect a leak:

```bash
vaults push --rotate-secret
```

Generates a fresh `SESSION_SECRET`, uploads it to Cloudflare, invalidates
every issued cookie + bearer token immediately, and writes the new value
to your local `.env`.
