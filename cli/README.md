# vaults

Sync an Obsidian vault to a Cloudflare-hosted wiki. The CLI renders your notes locally to HTML and deploys them to your own Cloudflare Pages account. Supports role-based access (public, patron, dm, …) so different parts of the same vault can be visible to different audiences.

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

- **Per-tier deploys.** A page tagged `role: dm` in its frontmatter only ships to the dm variant. Public visitors *cannot* fetch it — the file structurally doesn't exist in their variant.
- **Images are gated too.** Only images embedded by visible pages are copied into a given variant.
- **Incremental sync.** External clients (the [Foundry VTT module](https://github.com/wizzlethorpe/vaults-foundry)) can pull changes via `/_manifest.json` + `/_batch` endpoints — the CLI computes content hashes so the diff is minimal.

## Commands

| Command | What it does |
|---|---|
| `vaults init` | Write a `settings.md` with sensible defaults. |
| `vaults build` | Render the vault to a local directory (no deploy). |
| `vaults preview` | Render + serve locally via `wrangler pages dev` so you can click around with auth working. |
| `vaults push` | Render + deploy to Cloudflare Pages. |
| `vaults role add <name>` | Add an access tier. The first role becomes the default (no password). |
| `vaults role remove <name>` | Remove an access tier. |
| `vaults role list` | List configured roles. |
| `vaults role promote <name>` / `demote <name>` | Reorder tiers. |
| `vaults password <role>` | Set or change a role's password (PBKDF2-SHA256). |
| `vaults push --rotate-secret` | Generate a fresh `SESSION_SECRET`, invalidating every issued auth token at once. |
| `vaults push --all-warnings` / `vaults build --all-warnings` | Don't truncate the broken-link / missing-image report. |

Run any command with `--help` for the full flag list.

## Settings

`settings.md` lives at the root of your vault and is the single user-editable config:

```yaml
---
vault_name: My Wiki
default_role: public
accent_color: "#7a4a8c"
accent_color_dark: "#b58af5"
favicon: assets/icons/wiki.png
inline_title: true
default_image_width: 50vw
center_images: true
ignore:
  - Templates/**
  - "*.draft.md"
---
```

Open it in Obsidian — the frontmatter shows up as a Properties form.

## Page frontmatter

A page's frontmatter controls its access tier and how it's surfaced:

```yaml
---
role: dm                          # required to view; default is settings.default_role
title: Optional override          # default: filename or first H1
aliases:                          # extra names that resolve to this page from wikilinks
  - Pale Mountains
  - The Pale Mountains
---
```

Wikilinks (`[[Page]]`, `[[Page|alias]]`, `[[NPCs/Page#section]]`), image embeds (`![[image.png]]`), transclusions (`![[Page]]`), and Obsidian callouts all render the same way they do in Obsidian.

## Auth

Multi-role deploys ship with a small Cloudflare Pages Function (`_middleware.js`) that:

- **Gates per-role variants** via a signed cookie (`SameSite=None; Secure; Partitioned`).
- **Issues bearer tokens** through an OAuth-style `/connect` flow used by the [Foundry module](https://github.com/wizzlethorpe/vaults-foundry).
- **Exposes** `/_batch` (text) and `/_batch-images` (binary) for bulk content sync.

Tokens are stateless HMAC-signed JWTs; revocation = rotate `SESSION_SECRET` via `vaults push --rotate-secret`.

## Files this CLI manages locally

| File | Tracked in git? | What it holds |
|---|---|---|
| `settings.md` | yes | User-editable settings. |
| `.vaultrc.json` | **no** | CLI-managed: `SESSION_SECRET`, role password hashes, project name, cached settings. |
| `.vault-cache/` | **no** | Build cache: rendered output, image webp cache. |

`vaults init` adds `.vaultrc.json` and `.vault-cache` to `.gitignore` if your vault is a git repo.

## License

MIT
