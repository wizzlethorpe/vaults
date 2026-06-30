---
title: Features
---

This folder is a working tour of every feature this CLI includes. Each page
is both documentation and a live demo. View the source on any of them to see
the underlying markdown.

| Topic | What you'll see |
|---|---|
| [[Wikilinks]] | `[[Page]]`, aliases, image embeds, cross-tier behaviour |
| [[Callouts]] | Standard types + role-gated paragraph redaction |
| [[Images]] | `image:` frontmatter, auto-discovery, social meta, compression |
| [[Bases]] | Filtered/sorted views over your vault (table, cards, list) |
| [[Handlers]] | Inline `prefix:` and code-block transforms, with `dice:` and `fm:` built in |
| [[Statblocks]] | D&D 5e creature statblocks, Fantasy-Statblocks-compatible YAML |
| [[Role gating]] | `public`/`patron`/`dm` tiers, page + callout gating, auth flow |
| [[Foundry integration]] | Sync to Foundry VTT, `foundry.base` clones, dmRole gating |
| [[Passthrough files]] | Audio/video/PDF/EPUB including with per-variant role gating |
| [[Patreon login]] | Optional OAuth overlay: link roles to Patreon tiers so patrons sign in directly |

Other features that don't need a dedicated page:

- **Frontmatter dialog**: the `{}` button at the top-right of every page
  pops up the raw YAML in a copy-friendly box. Useful for grabbing UUIDs
  out of an existing page or sharing frontmatter snippets.
- **Folder-index synthesis**: any folder without an `index.md` gets one
  auto-generated as a Bases card view of its contents. See `NPCs/index`,
  `Items/index`, `Lore/index` for examples.
- **Dark mode**: theme picker in the sidebar (auto / light / dark). Set
  `accent_color_dark` and `bg_color_dark` in `settings.md` to override
  the dark palette; `accent_color` / `bg_color` cover light mode.
- **OG / Twitter social meta**: every page emits `og:image`, `og:title`,
  `og:type`, `twitter:card`. Resolved cover image rides through.
- **Search**: every variant ships its own `_search-index.json`; the
  client-side search box in the sidebar uses it for fuzzy matching.
- **Hover previews**: desktop browsers preview a page when you hover its
  link, fetching the per-page `<path>.preview.json` lazily. The
  `preview_mode` setting controls the behavior: `normal` (the default)
  hovers a popover and navigates on click; `sticky` hovers a popover and
  pins it open on click, with a "Go to page" link, instead of navigating;
  `none` disables previews so links just navigate.
- **Backlinks**: every page lists pages that link to it in the right
  sidebar, computed at build time.
- **External links open in a new tab**: anything pointing off-host gets
  `target="_blank" rel="noopener"` so visitors don't lose their place.
- **Obsidian snippets**: `.obsidian/snippets/*.css` files ride to the
  deploy as `user.css`, loaded after the default theme.
