# vaults: Claude Instructions

## Prime directive

**Simple and easy to maintain.** Every line you add is a line someone has to understand later. Write code a careful reader can follow top-to-bottom. When in doubt, choose the boring option. This beats every other goal in this file.

## What this is

A monorepo for letting people self-host an Obsidian vault as a static wiki on Cloudflare. The user authors notes in Obsidian; the CLI renders them locally to HTML and pushes to their own Cloudflare account. Cloudflare Pages serves the static wiki. A small Pages Function (auth middleware) gates per-role variants and serves each reader the `grafts.json` they may import into Foundry.

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
├── release.sh               bump, tag, publish the CLI to npm
├── cli/                     @wizzlethorpe/vaults: CLI + Cloudflare Pages template
└── landing/                 Demo vault (deployed at vaults.wizzlethorpe.com)
```

One git history, so a release tag pins the exact behaviour across CLI and landing demo.

## Where work happens

- **`cli/`**: ~99% of active development. Build with `pnpm --filter @wizzlethorpe/vaults run build`; test with `pnpm --filter @wizzlethorpe/vaults run test`.
- **Foundry**: the CLI compiles each role's pages into a self-contained `grafts.json` (`cli/src/foundry-grafts.ts`) which the reader downloads and builds into their world with [graft](https://github.com/wizzlethorpe/graft)'s **Import grafts**. Page bodies are inlined into the entries; media is named in the file's `assets.http` block, which graft's built-in `http` handler fetches with a two-hour bearer the middleware splices in at download. Everything lands in the world, so links are world UUIDs. Folder-as-JournalEntry model: every directory becomes one entry, every `.md` file an embedded JournalEntryPage, and folders without an `index.md` get the wiki's synthesized index page. `foundry.enabled: false` writes nothing.

- **`landing/`**: itself a Vault, deployed at vaults.wizzlethorpe.com. Doubles as the project's landing page AND a working demo of every CLI feature.

When the user gives you a task, default to assuming it's about `cli/` unless the prompt obviously points at the landing demo.

## Architecture in one screen

```
~/Documents/MyVault/        ← user's Obsidian vault (source of truth)
├── …content…
└── .vaults/                ← all CLI-managed internal state
    ├── settings.yaml       ← vault settings, written by `vaults set`
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
    │   ├── <page>.preview.json    hover-preview JSON
    │   ├── <image>.webp           images referenced from this variant
    │   ├── _foundry/grafts.json   the entry list a reader imports, bodies inlined
    │   ├── _foundry/assets-<hash>.zip   media batched for graft, when zip_assets is set
    │   └── _search-index.json
    ├── styles.css, user.css   shared at root (no role gate)
    ├── _handlers.js, _handlers.css   bundled built-in + user handler assets
    ├── katex/                 KaTeX css + fonts (only when a page has math)
    ├── login.html             multi-role builds only
    └── functions/
        └── _middleware.js     role gate via signed cookie + variant rewrite,
                               plus /_foundry/grafts.json (the reader's entry
                               list, token spliced in), /login, /logout.
```

Single-role builds collapse `_variants/public/...` straight to the deploy root, no functions, no auth.

## Tech decisions (do not re-litigate without user approval)

- **Cloudflare-only target**: Pages + Pages Functions. No D1, KV, R2, or Queues.
- **CLI does the rendering.** The Function is purely a gate / read API: never renders.
- **Pure ESM TypeScript** (`strict: true`, `noUncheckedIndexedAccess: true`).
- **Web Crypto API** for password hashing (PBKDF2-SHA256 @ 100k: Workers caps higher), HMAC cookie/bearer signing. Same code runs in Node and the Workers runtime.
- **picomatch** for ignore-pattern globs. **sharp** for image compression. **gray-matter** for frontmatter. **unified/remark/rehype** for markdown.
- **No MCP server.** A `/mcp` Function would cost files against Pages's 20k-file cap.
- **No platform code in this repo.** The future managed platform is a separate concern.
- **The CLI carries the version.** Bumped and published by root `release.sh <X.Y.Z>`. Landing has no version (deploys whenever).

## Coding conventions

### TypeScript

- ES modules only.
- Named exports preferred; default exports only when an external API requires them.
- `async`/`await`, never `.then` chains.
- Files: `kebab-case.ts`. Types: `PascalCase`. Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- One exported thing per file when practical. Filename matches the export.

### Settings schema

The single source of truth is the `SCHEMA` constant in `cli/src/settings.ts`. To add a setting: add an entry there. The schema drives `init`, `vaults set` / `vaults get`, parsing, validation, the canonical-format rewriter, and warnings for unknown keys. Existing vaults pick up a new field with its default on the next `vaults build`.

Settings live in `.vaults/settings.yaml`, out of Obsidian's sight (it hides dot-folders), and are meant to be changed with `vaults set`. `.vaults/config.json` beside it is gitignored because it holds password hashes; settings are not, and must stay readable from a fresh clone.

### Render pipeline

Plugins live in `cli/src/render/` and consume a `RenderContext`. New rendering features almost always become a new plugin or a new context field: keep `pipeline.ts` small.

## What to avoid

- **Dead code.** Remove the callee when you remove the caller.
- **Speculative abstraction.** Extract a helper at the third caller, not the second.
- **Backwards-compat shims** for code that has never shipped.
- **Defensive programming against your own code.** Validate at system boundaries only.
- **Comments that repeat the code.** Comments explain *why* something non-obvious exists.
- **Scope creep.** Fix the bug, add the feature: nothing adjacent. Flag anything you noticed but did not do.

## Working loop

1. State the smallest change that satisfies the task.
2. Edit existing files over creating new ones.
3. Typecheck (`pnpm typecheck` from root) and run an end-to-end build against a real vault before reporting done.
4. Commit on the active branch and push when authorized.

### Editing `render/auth-template.ts`

The Pages Function is a **template literal**, so anything inside
`renderAuthMiddleware`'s returned string: including comments: must not
contain a backtick or `${`. A stray backtick in a comment closes the template
and the file stops parsing, which reads as an unrelated syntax error dozens of
lines away. `pnpm typecheck` catches it, as does any middleware test, but the
error message never points at the comment.

## Self-check before reporting done

1. Does it typecheck?
2. Did I rebuild a real vault and verify the change end-to-end?
3. Did I delete the code I replaced?
4. Is there a leftover comment, TODO, or `console.log`?
