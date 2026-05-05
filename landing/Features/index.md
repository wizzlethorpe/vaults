---
title: Features
---

# Features

This folder is a working tour of every feature this CLI ships. Each page
is both documentation and a live demo — view source on any of them to see
the underlying markdown.

| Topic | What you'll see |
|---|---|
| [[Wikilinks]] | `[[Page]]`, aliases, image embeds, cross-tier behaviour |
| [[Callouts]] | Standard types + role-gated paragraph redaction |
| [[Images]] | `image:` frontmatter, auto-discovery, social meta, compression |
| [[Bases]] | Filtered/sorted views over your vault (table, cards, list) |
| [[Role gating]] | `public`/`patron`/`dm` tiers, page + callout gating, auth flow |
| [[Foundry integration]] | Sync to Foundry VTT, `foundry_base` clones, dmRole gating |

Other features that don't need a dedicated page:

- **Frontmatter dialog** — the `{}` button at the top-right of every page
  pops up the raw YAML in a copy-friendly box. Useful for grabbing UUIDs
  out of an existing page or sharing frontmatter snippets.
- **Folder-index synthesis** — any folder without an `index.md` gets one
  auto-generated as a Bases card view of its contents. See `NPCs/index`,
  `Items/index`, `Lore/index`, `Features/index` (this page would be
  generated if it didn't already exist).
- **OG / Twitter social meta** — every page emits `og:image`, `og:title`,
  `og:type`, `twitter:card`. Resolved cover image rides through.
- **Search** — every variant ships its own `_search-index.json`; the
  client-side search box in the sidebar uses it for fuzzy matching.
- **Hover previews** — desktop browsers preview a page when you hover its
  link, fetching the per-page `<path>.preview.json` lazily.
- **Backlinks** — every page lists pages that link to it in the right
  sidebar, computed at build time.
- **Custom theme colors** — `accent_color` and `bg_color` in `settings.md`
  override the default scarlet-on-parchment palette.
- **Obsidian snippets** — `.obsidian/snippets/*.css` files ship to the
  deploy as `user.css`, loaded after the default theme.
