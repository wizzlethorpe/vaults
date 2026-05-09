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

vaults init                          # write a settings.md the renderer will read
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

- **Per-tier deploys.** A page tagged `role: dm` in its frontmatter only ships to the dm variant. Public visitors *cannot* fetch it; the file structurally doesn't exist in their variant.
- **Inline gating with callouts.** Drop a `> [!dm]` callout in an otherwise public page; the entire block is stripped from the public deploy. Same for any other configured role.
- **Images and media are gated too.** Only images, audio, video, PDFs, and EPUBs embedded by visible pages are copied into a given variant. Unknown extensions are skipped by default (toggle `include_unknown_files`).
- **Incremental sync.** External clients (the [Foundry VTT module](https://github.com/wizzlethorpe/vaults)) probe `/_manifest.json` to discover the deploy's name, auth requirements, and role order, then pull `/_batch` (text) and `/_batch-images` (binary) for changed content. Manifest hashes fold in per-page frontmatter, so a role flip or title rename triggers a sync without a body diff.
- **Bases support.** `.base` files render as cards / table / list inside the wiki, just like inside Obsidian.
- **Social meta.** OG / Twitter card tags are auto-generated. Pages without an explicit `image:` frontmatter use the first body embed (toggle with `auto_image`).

## Commands

### Build / deploy

| Command | What it does |
|---|---|
| `vaults init` | Write a `settings.md` with sensible defaults. |
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

Run any command with `--help` for the full flag list.

## Settings

`settings.md` lives at the root of your vault and is the single user-editable config:

```yaml
---
vault_name: My Wiki
default_role: public
accent_color: "#7a4a8c"
bg_color: "#1a1a2e"
favicon: assets/icons/wiki.png
inline_title: true
default_image_width: 300px
center_images: true
auto_image: true
include_unknown_files: false
ignore:
  - Templates/**
  - "*.draft.md"
---
```

Open it in Obsidian; the frontmatter shows up as a Properties form. Unknown keys are warned about and stripped on next push, so the file stays canonical. Auth config (roles, passwords, Patreon credentials) is **not** in `settings.md`; it lives in `.vaultrc.json` and is managed by the CLI.

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

If your handler needs to ship browser-side JavaScript or CSS, declare them with the `assets` field. Paths are relative to the handler file. Every declared asset across all handlers is concatenated into one `_handlers.js` and one `_handlers.css` at the deploy root, deduped by absolute path so a shared utility file is only included once.

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

Multi-role deploys ship with a small Cloudflare Pages Function (`_middleware.js`) that:

- **Gates per-role variants** via a signed cookie (`SameSite=None; Secure; Partitioned`).
- **Issues bearer tokens** through an OAuth-style `/connect` flow used by the [Foundry module](https://github.com/wizzlethorpe/vaults).
- **Handles Patreon login** at `/auth/patreon/login` and `/auth/patreon/callback` when configured.
- **Exposes** `/_batch` (text) and `/_batch-images` (binary) for bulk content sync.
- **Publishes** `/_manifest.json` with the deploy's name, role order, and auth requirements so external clients can probe the deploy before picking an auth flow.

Tokens are stateless HMAC-signed JWTs; revocation = rotate `SESSION_SECRET` via `vaults push --rotate-secret`.

Single-role (public-only) deploys skip the middleware entirely; everything serves as plain static assets.

## Files this CLI manages locally

```
MyVault/
├── settings.md          ← user-editable settings (Obsidian Properties UI)
├── …content…
├── .env                 ← secrets only (SESSION_SECRET, PATREON_CLIENT_SECRET) — gitignored
└── .vaults/             ← all vaults-cli internal state lives here
    ├── .gitignore       ← keeps cache + config out of git automatically
    ├── config.json      ← CLI-managed: roles, password hashes, project name, Patreon config
    ├── cache/           ← build cache (rendered HTML, image webp cache)
    └── handlers/        ← optional: custom inline / code-block handlers
```

`settings.md` lives at the vault root (and only there) so Obsidian renders it as an editable Properties form. Everything else is internal and tucked under `.vaults/`. `vaults init` writes `.vaults/.gitignore` automatically; if your vault is a git repo, this is enough to keep the cache + secrets-bearing config from being tracked.

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
