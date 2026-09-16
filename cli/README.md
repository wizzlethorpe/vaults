# vaults

Sync an Obsidian vault to a Cloudflare-hosted wiki. The CLI renders your notes locally to HTML and deploys them to your own Cloudflare Pages account. Supports role-based access (public, patron, dm, …) so different parts of the same vault can be visible to different audiences. Patrons can be authenticated by password or by Patreon OAuth (linking roles to specific Patreon tier IDs).

## Install

```bash
npm install -g @wizzlethorpe/vaults
```

Requires Node.js 22 or newer. Works on macOS, Linux, and Windows.

## Quickstart

From any Obsidian vault:

```bash
cd ~/Documents/MyVault

vaults init                          # write the settings the renderer will read
vaults role add public               # default tier (anyone can read)
vaults role add patron               # tier above public, password-gated
vaults role add dm                   # top tier
vaults password patron               # set a password
vaults password dm
vaults push                          # render + deploy to Cloudflare Pages
```

The first push prompts for a Pages project name and runs `wrangler login` if you aren't authenticated. After that it just renders and deploys.

If you'd rather not `cd` into the vault every time, set `VAULT_PATH=~/Documents/MyVault` in your shell rc and run `vaults` from anywhere.

## How it works

```
~/MyVault/                 ← Obsidian vault (source of truth)
   │  vaults push
   ▼
Cloudflare Pages           ← per-user, your account
   ├── _variants/<role>/   ← rendered HTML, scoped by access tier
   ├── styles.css, login.html
   └── functions/_middleware.js   ← auth gate (cookie/bearer based)
```

- **Per-tier deploys.** A page tagged `role: dm` in its frontmatter only includes to the dm variant. Public visitors *cannot* fetch it; the file structurally doesn't exist in their variant.
- **Inline gating with callouts.** Drop a `> [!dm]` callout in an otherwise public page; the entire block is stripped from the public deploy. Same for any other configured role.
- **Images and media are gated too.** Only images, audio, video, PDFs, and EPUBs embedded by visible pages are copied into a given variant. Unknown extensions are skipped by default (toggle `include_unknown_files`).
- **Foundry integration.** The build compiles each role's pages into a self-contained `_foundry/grafts.json`. A reader downloads their own copy and builds it into their world with [graft](https://github.com/wizzlethorpe/graft)'s **Import grafts**. Page bodies are inlined and art is listed in the file's `assets` block, fetched with a two-hour token, so a reader's download only ever holds what their role may read.
- **Bases support.** `.base` files render as cards / table / list inside the wiki, just like inside Obsidian.
- **LaTeX math.** `$inline$` and `$$display$$` math render server-side via KaTeX, matching Obsidian's syntax. The stylesheet and fonts are self-hosted and only ship for vaults that contain math.
- **Social meta.** OG / Twitter card tags are auto-generated. Pages without an explicit `image:` frontmatter use the first body embed (toggle with `auto_image`).

## Commands

### Build / deploy

| Command | What it does |
|---|---|
| `vaults init` | Write a `.vaults/settings.yaml` with sensible defaults. |
| `vaults get [key]` | Show one setting, or every setting. |
| `vaults set <key> <value>` | Change a setting, e.g. `vaults set foundry.system pf2e`. |
| `vaults build` | Render the vault to a local directory (no deploy). |
| `vaults preview` | Render + serve locally via `wrangler pages dev` so you can click around with auth working. |
| `vaults push` | Render + deploy to Cloudflare Pages. |
| `vaults push --dry-run` | Render without deploying. |
| `vaults push --rotate-secret` | Generate a fresh `SESSION_SECRET`, invalidating every issued auth token at once. |
| `vaults push --all-warnings` / `vaults build --all-warnings` | Don't truncate the broken-link / missing-image report. |

### Roles and passwords

| Command | What it does |
|---|---|
| `vaults role add <name>` | Add an access tier. The first role becomes the default (no password). |
| `vaults role remove <name>` | Remove an access tier. |
| `vaults role list` | List configured roles. |
| `vaults role promote <name>` / `demote <name>` | Reorder tiers. |
| `vaults password <role>` | Set or change a role's password (PBKDF2-SHA256). |

### Patreon OAuth (optional)

Link roles to Patreon tier IDs, so any patron at that tier can sign in with Patreon and pick up the corresponding role. Coexists with passwords; either grants the role.

| Command | What it does |
|---|---|
| `vaults patreon configure` | Prompts for Patreon OAuth client credentials and walks you through picking a campaign. The client secret is stored as a Wrangler secret on next push. |
| `vaults patreon link <role> <tier-id>` | Map a role to a numeric Patreon tier ID. |
| `vaults patreon unlink <role>` | Remove a role's tier mapping (password access stays). |
| `vaults patreon status` | Show current configuration and tier mappings. |
| `vaults patreon clear` | Remove the entire Patreon configuration. |

You'll need to register a Patreon OAuth client at <https://www.patreon.com/portal/registration> and add `https://your-deploy-url/auth/patreon/callback` as a redirect URI before running `configure`.

### OIDC login (optional)

Point the vault at any standards-compliant OIDC issuer (Google, Microsoft, Okta, a self-hosted provider) and grant roles by email address or email domain. Coexists with passwords and Patreon; any of them grants the role.

| Command | What it does |
|---|---|
| `vaults oidc configure` | Prompts for the issuer URL, resolves its discovery document (or takes endpoints manually), takes client credentials, and walks each role's email/domain rules. |
| `vaults oidc status` | Show the issuer, endpoints, and per-role rules. |
| `vaults oidc clear` | Remove the entire OIDC configuration. |

Role rules match exactly and case-insensitively: an email entry (`dean@lmu.edu`) matches only that address (plus-addresses are distinct), and a domain entry (`lion.lmu.edu`) matches only that exact domain after the `@` — subdomains are not implied, so list them explicitly. A visitor matching several roles gets the highest one. Sign-in uses the authorization-code flow with PKCE; identity comes from the issuer's userinfo endpoint, and whatever email it reports is trusted, so only configure an issuer you trust.

Register these redirect URIs on your OAuth client before running `configure`: `https://your-deploy-url/auth/oidc/callback` and `http://localhost:4173/auth/oidc/callback` (the latter covers `vaults preview` testing). The client ID lives in `.vaults/config.json`; the client secret lives only in `.env` as `OAUTH_CLIENT_SECRET` and is uploaded as a Wrangler secret on every push. Removing someone's email from a rule takes effect when their session cookie expires (7 days); use `vaults push --rotate-secret` to log everyone out immediately.

Run any command with `--help` for the full flag list.

## Settings

Everything about how a vault renders lives in `.vaults/settings.yaml`. Change it with the CLI:

```bash
vaults get                                  # every setting and its current value
vaults get foundry.system                   # one value, bare, so it pipes
vaults set vault_name "My Wiki"
vaults set accent_color "#7a4a8c"
vaults set folder_notes true
vaults set ignore '[Templates/**, "*.draft.md"]'
```

A string setting takes the value verbatim; anything else is read as YAML, which is how a list or a nested object reaches it. A value the schema rejects is refused rather than quietly replaced by a default, and every write reformats the whole file, so it stays canonical and unknown keys are dropped.

The file is a normal YAML file with a comment above each key, and hand-editing works. It sits under `.vaults/` because Obsidian hides dot-folders, which keeps it out of the note list, the quick switcher and the graph.

Auth config (roles, passwords, OAuth credentials) is separate, in `.vaults/config.json` with secrets in `.vaults/.env`. That file is gitignored because it holds password hashes; `settings.yaml` is not, and belongs in the repo with the vault.

Every folder gets a page. By default the build generates one, listing the folder's subfolders and a table of its notes. Two ways to write your own instead: put an `index.md` in the folder, or set `folder_notes: true` and name the note after the folder it sits in (`Places/Places.md`), which is the convention Obsidian's folder-note plugins use. Either way the note is served at the folder's URL, and `[[Places]]` reaches it. An `index.md` wins if a folder somehow has both.

## Page frontmatter

A page's frontmatter controls its access tier and how it's surfaced:

```yaml
---
role: dm                          # required to view; default is settings.default_role
title: Optional override          # default: filename or first H1
aliases:                          # extra names that resolve to this page from wikilinks
  - Pale Mountains
  - The Pale Mountains
image: assets/banner.webp         # optional cover image (OG / Twitter / Bases / Foundry)
foundry:                          # optional Foundry instantiation
  base: Compendium.dnd5e.monsters.Actor.bandit   # template UUID, OR Type[:subtype] for blank doc
  data:                                          # deep-merge overlay
    system.attributes.hp.value: 22
---
```

Wikilinks (`[[Page]]`, `[[Page|alias]]`, `[[NPCs/Page#section]]`), image embeds (`![[image.png]]`), transclusions (`![[Page]]`), and Obsidian callouts all render the same way they do in Obsidian.

## Custom handlers

Vault authors can extend the renderer with custom inline-code and code-block transforms. Drop a Node ESM module into `.vaults/handlers/<name>.mjs` that exports a `handler` (or `handlers: Handler[]`); vaults-cli loads them at build time and runs them over every page.

- **Inline handler**: matches inline code like `` `prefix: content` ``.
- **Code-block handler**: matches fenced ` ```language ` blocks.

Both return either `{ markdown }` (re-processed through the rest of the pipeline) or `{ html }` (sanitized and inserted as-is).

```js
// .vaults/handlers/seealso.mjs
export const handler = {
  codeBlock: "seealso",
  render: (content) => ({
    markdown: content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => `- [[${p.trim()}]]`)
      .join("\n"),
  }),
};
```

### Browser-side assets

If your handler needs to include browser-side JavaScript or CSS, declare them with the `assets` field. Paths are relative to the handler file. Every declared asset across all handlers is concatenated into one `_handlers.js` and one `_handlers.css` at the deploy root, deduped by absolute path so a shared utility file is only included once.

```js
// .vaults/handlers/widget.mjs
export const handler = {
  codeBlock: "widget",
  assets: {
    scripts: ["./widget.runtime.js"],
    styles: ["./widget.css"],
  },
  render: (content) => ({
    html: `<div class="widget" data-config="${content}"></div>`,
  }),
};
```

```js
// .vaults/handlers/widget.runtime.js
(function () {
  document.querySelectorAll('.widget').forEach((el) => {
    // wire up el.dataset.config into something interactive
  });
})();
```

The deployed page references `/_handlers.js` (deferred) and `/_handlers.css`; the runtime then finds and hydrates the handler's HTML. Wrap your runtime in an IIFE to avoid global pollution.

**File-naming convention.** Handler module files end in `.mjs`. Browser-side runtime / CSS files end in `.js` / `.css`. The loader only treats `.mjs` files as handler modules; `.js` files in the same directory are picked up only if a handler's `assets.scripts` references them.

### Built-ins

- **`dice:` (inline)** — `` `dice: 1d20+5` `` renders as a clickable button on the deploy that re-rolls on click. Mirrors [Obsidian Dice Roller](https://github.com/javalent/dice-roller) syntax.

User handlers can override built-ins of the same name. Trust model: handlers run with the same permissions as the rest of the build, so only run `vaults push` on vaults whose contents you trust.

## Auth

Multi-role deploys include with a small Cloudflare Pages Function (`_middleware.js`) that:

- **Gates per-role variants** via a signed cookie (`SameSite=None; Secure; Partitioned`).
- **Handles Patreon login** at `/auth/patreon/start` and `/auth/patreon/callback`, and **OIDC login** at `/auth/oidc/start` and `/auth/oidc/callback`, when configured.
- **Serves `/_foundry/grafts.json`** as the caller's own role variant, with a two-hour bearer spliced into its `assets` block so graft can fetch the media it names.

Tokens are stateless HMAC-signed JWTs; revocation = rotate `SESSION_SECRET` via `vaults push --rotate-secret`.

Single-role (public-only) deploys skip the middleware entirely; everything serves as plain static assets.

## Files this CLI manages locally

```
MyVault/
├── …content…
├── .env                 ← secrets only (SESSION_SECRET, PATREON_CLIENT_SECRET, OAUTH_CLIENT_SECRET) — gitignored
└── .vaults/             ← all vaults-cli internal state lives here
    ├── .gitignore       ← keeps cache + config out of git automatically
    ├── settings.yaml    ← vault settings; `vaults set` writes it, and it belongs in git
    ├── config.json      ← CLI-managed: roles, password hashes, project name, OAuth (Patreon / OIDC) config
    ├── cache/           ← build cache (rendered HTML, image webp cache)
    └── handlers/        ← optional: custom inline / code-block handlers
```

Nothing the CLI manages sits in the vault proper, so Obsidian shows your notes and only your notes. `vaults init` writes `.vaults/.gitignore` automatically; if your vault is a git repo, that keeps the cache and the secrets-bearing config out while leaving `settings.yaml` tracked.

## Migrations

vaults-cli runs schema and layout migrations automatically before every `build` / `push` / `preview`. They're idempotent: already-migrated vaults pay only the cost of a few `stat()` calls.

To run them manually or inspect what would change:

```bash
vaults migrate --list      # show all known migrations
vaults migrate --dry-run   # show what would apply on this vault
vaults migrate             # apply pending migrations
```

If you're upgrading from a pre-0.7 vault, the first run of any command will move `.vaultrc.json` → `.vaults/config.json` and `.vault-cache/` → `.vaults/cache/` and write a `.vaults/.gitignore`. Renames are atomic on the same filesystem so even large caches migrate instantly.

## License

MIT
