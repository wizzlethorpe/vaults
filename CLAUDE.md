# vaults — Claude Instructions

## Prime directive

**Simple and easy to maintain.** Every line you add is a line someone has to understand later. Write code a careful reader can follow top-to-bottom. When in doubt, choose the boring option. This beats every other goal in this file.

## What this is

A monorepo for letting people self-host an Obsidian vault as a static wiki on Cloudflare. The user authors notes in Obsidian; the CLI renders them locally to HTML and pushes to their own Cloudflare account. Cloudflare Pages serves the static wiki. A small Pages Function (auth middleware) gates per-role variants and exposes `/_batch` read APIs the Foundry module uses to pull rendered bodies and media at build time.

**Not** a hosted multi-tenant SaaS today. The architecture is designed to support a managed platform layered on top later (per-user Cloudflare projects, OAuth-issued JWTs that the existing Function trusts).

## Repo layout

```
vaults/                      this repo (single git history)
├── README.md
├── CLAUDE.md                this file
├── ROADMAP.md               where this is going, and why
├── LICENSE
├── package.json             root workspace manifest
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── release.sh               unified release: bumps + tags + per-subproject publish
├── cli/                     @wizzlethorpe/vaults — CLI + Cloudflare Pages template
├── foundry/                 Foundry VTT module (id "vaults")
└── landing/                 Demo vault (deployed at vaults.wizzlethorpe.com)
```

This was previously three submodules pinned by SHA in a parent repo. The submodule model added friction without giving useful isolation: most non-trivial features touch CLI + Foundry + landing in one logical change, which previously meant three commits + a parent SHA bump for one feature. The monorepo unifies them under a single shared version (`v0.7.0`, `v0.8.0`, …) so a release tag pins the exact behavior across all three.

## Where work happens

- **`cli/`** — ~99% of active development. Build with `pnpm --filter @wizzlethorpe/vaults run build`; test with `pnpm --filter @wizzlethorpe/vaults run test`.
- **`foundry/`** — Foundry VTT module (id `vaults`): a [graft](https://github.com/wizzlethorpe/graft) pre-build transform. The CLI compiles a vault into a `grafts.json` entry list at build time (`cli/src/foundry-grafts.ts`); this module fetches that list from the deploy, resolves its `@vaults/<variant>/<path>` references (bodies inline, media into a per-vault world cache, cached by content hash), and hands the entries to graft to build. It also prompts to rebuild when the deploy's `version.json` content hash moves. Folder-as-JournalEntry model: every directory becomes one entry, every `.md` file an embedded JournalEntryPage, and folders without an `index.md` get the wiki's synthesized index page.

  The vault's `foundry.package` setting picks the delivery:
  - `compendium` — one pack per document type, browsable. Links are `@UUID[Compendium.<vault>.<vault>-<type>.…]`: nothing is imported as a unit, so the pack copy is the copy.
  - `adventure` — a single Adventure document. Links are **world** UUIDs, because Foundry's Adventure import creates with keepId and updates what already carries the id, so they resolve to the copies the GM imported. The Adventure pack must declare a `system` or Foundry empties its actors, items and their folders on every read.
  - `none` — no integration; the deploy ships no grafts.json and no `/_batch`.

  Using one shape's links with the other is the bug this arrangement exists to prevent: an imported page linking to a second copy of the thing beside it. A player-visible page's journal body carries both renders — the GM's inside a `<section class="secret">` (which Foundry wraps in a `<secret-block>` element at render), the player variant's in the open.

- **`landing/`** — itself a Vault, deployed at vaults.wizzlethorpe.com. Doubles as the project's landing page AND a working demo of every CLI feature.

When the user gives you a task, default to assuming it's about `cli/` unless the prompt obviously points at the Foundry module or landing demo.

## Architecture in one screen

```
~/Documents/MyVault/        ← user's Obsidian vault (source of truth)
├── settings.md             ← user-editable (Obsidian Properties UI)
├── …content…
└── .vaults/                ← all CLI-managed internal state
    ├── config.json         ← CLI-managed: roles, password hashes, project name, OAuth (Patreon / OIDC) config
    ├── cache/              ← build cache (rendered HTML, image webp cache)
    └── handlers/           ← optional custom inline / code-block handlers
        │
        │  vaults push       (CLI from cli/)
        ▼
user's Cloudflare account (one Pages project per user)
└── Pages assets:
    ├── _variants/<role>/  rendered HTML + body fragments per access tier
    │   ├── <page>.html        full layout (browsed on the wiki)
    │   ├── <page>.body.html       article only (hover previews, transclusion)
    │   ├── <page>.foundry.html    article with Foundry UUID links + @vaults refs
    │   ├── <page>.preview.json    hover-preview JSON
    │   ├── <image>.webp           images referenced from this variant
    │   ├── _foundry/grafts.json   entry list + per-asset content hashes
    │   ├── _foundry/version.json  content hash, read by the rebuild prompt
    │   └── _search-index.json
    ├── styles.css, user.css   shared at root (no role gate)
    ├── _handlers.js, _handlers.css   bundled built-in + user handler assets
    ├── _foundry/module.json, module.zip   the installable vault module (ungated)
    ├── katex/                 KaTeX css + fonts (only when a page has math)
    ├── login.html             multi-role builds only
    └── functions/
        └── _middleware.js     role gate via signed cookie + variant rewrite,
                               plus /connect (token issuance), /_batch (text),
                               /_batch-images (binary), /login, /logout.
```

Single-role builds collapse `_variants/public/...` straight to the deploy root, no functions, no auth.

## Tech decisions (do not re-litigate without user approval)

- **Cloudflare-only target** — Pages + Pages Functions. No D1, KV, R2, or Queues.
- **CLI does the rendering.** The Function is purely a gate / read API — never renders.
- **Pure ESM TypeScript** (`strict: true`, `noUncheckedIndexedAccess: true`).
- **Web Crypto API** for password hashing (PBKDF2-SHA256 @ 100k — Workers caps higher), HMAC cookie/bearer signing. Same code runs in Node and the Workers runtime.
- **picomatch** for ignore-pattern globs. **sharp** for image compression. **gray-matter** for frontmatter. **unified/remark/rehype** for markdown.
- **No MCP server today.** Earlier prototype included a `/mcp` Function; removed to keep deploys under Pages's 20k-file limit.
- **No platform code in this repo.** The future managed platform is a separate concern.
- **Single shared version across cli + foundry.** Both bump together via root `release.sh <X.Y.Z>`. Landing has no version (deploys whenever).

## Coding conventions

### TypeScript

- ES modules only.
- Named exports preferred; default exports only when an external API requires them.
- `async`/`await`, never `.then` chains.
- Files: `kebab-case.ts`. Types: `PascalCase`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- One exported thing per file when practical. Filename matches the export.

### Settings schema

The single source of truth is the `SCHEMA` constant in `cli/src/settings.ts`. To add a setting: add an entry there. The schema drives `init`, parsing, validation, the canonical-format rewriter, and warnings for unknown keys. Any existing `settings.md` files auto-pick-up new fields with their defaults on next `vaults build`.

### Render pipeline

Plugins live in `cli/src/render/` and consume a `RenderContext`. New rendering features almost always become a new plugin or a new context field — keep `pipeline.ts` small.

## What to avoid

- **Dead code.** Remove the callee when you remove the caller.
- **Speculative abstraction.** Extract a helper at the third caller, not the second.
- **Backwards-compat shims** for code that has never included.
- **Defensive programming against your own code.** Validate at system boundaries only.
- **Comments that repeat the code.** Comments explain *why* something non-obvious exists.
- **Scope creep.** Fix the bug, add the feature — nothing adjacent. Flag anything you noticed but did not do.

## Working loop

1. State the smallest change that satisfies the task.
2. Edit existing files over creating new ones.
3. Typecheck (`pnpm typecheck` from root) and run an end-to-end build against a real vault before reporting done.
4. Commit on the active branch and push when authorized.

### Editing `render/auth-template.ts`

The Pages Function is a **template literal**, so anything inside
`renderAuthMiddleware`'s returned string — including comments — must not
contain a backtick or `${`. A stray backtick in a comment closes the template
and the file stops parsing, which reads as an unrelated syntax error dozens of
lines away. `pnpm typecheck` catches it, as does any middleware test, but the
error message never points at the comment.

### Testing a change to `foundry/scripts/`

The module runs as-is in Foundry's browser context; there is no bundle step.
Ship it to the hosted server with `./dev-install.sh --remote` (or into a local
Data dir; see the script header), then reload the browser — Foundry re-reads
module *code* on reload. Two things need more than a reload:

- `module.json` changes (packs, styles, esmodules) need a **server restart**;
  manifests are read at server start.
- Stylesheets are cache-busted by module *version*, which dev-install does not
  bump, so a CSS-only change may need a hard refresh (Ctrl+Shift+R).

A change to what the CLI emits (`grafts.json`, `.foundry.html` bodies) reaches
Foundry through a vault rebuild + `vaults push`, then the in-world rebuild
prompt (or graft's Build button — the rebuild prompt only fires when the
content hash moved, and a vault that has built nothing is offered its first
build instead, since a gated deploy reports no hash until the GM connects).

## Self-check before reporting done

1. Does it typecheck?
2. Did I rebuild a real vault and verify the change end-to-end?
3. Did I delete the code I replaced?
4. Is there a leftover comment, TODO, or `console.log`?
