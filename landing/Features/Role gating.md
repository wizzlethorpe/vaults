---
title: Role gating
---

# Role gating

Vaults supports access tiers — multi-role builds emit one variant per
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
entry — the page structurally doesn't exist for them.

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
the variant's styled 404 page.

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

## How the auth flow works

1. Build emits `_variants/<role>/...` for each configured role, plus a
   Pages Function (`functions/_middleware.js`) and a `login.html`.
2. A request to `/some/path` hits the middleware, which:
   - Reads the session cookie (default = lowest role / `public`).
   - Rewrites internally to `/_variants/<role>/some/path`.
   - Returns the role-appropriate variant from Pages's static assets.
3. `/login` POSTs the password; on success the middleware sets a
   PBKDF2-verified, HMAC-signed session cookie and redirects.
4. `/logout` clears the cookie.

The session secret is generated once per vault and stored in
`.vaultrc.json` (gitignored on real vaults; this demo vault commits
its secret because the passwords are throwaway).

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

## Public-tier sync (no password)

For external clients (the Foundry module, the MCP server), unauthenticated
requests fall through to the lowest role automatically. So a public
visitor — or a Foundry world that never authenticated — can pull the
public-tier content via `/_manifest.json` + `/_batch` without any token.
The Foundry module surfaces this as a per-vault setting; see
[[Features/Foundry integration]] for the full integration story.
