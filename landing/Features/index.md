---
title: Features
---

Each page in this folder documents one feature and demonstrates it live. View the source on any of them for the markdown behind it.

| Topic | What you will see |
|---|---|
| [[Wikilinks]] | `[[Page]]`, aliases, image embeds, transclusion, cross-tier behaviour |
| [[Callouts]] | Styled callouts and role-gated paragraph redaction |
| [[Images]] | `image:` frontmatter, cover discovery, social meta, compression |
| [[Bases]] | Filtered and sorted views over your vault: table, cards, list |
| [[Handlers]] | Inline `prefix:` and code-block transforms, with `dice:`, `fm:`, `gallery`, `download`, `foundry-install` and `fvtt-link` built in |
| [[Statblocks]] | D&D 5e creature statblocks from Fantasy Statblocks YAML |
| [[Role gating]] | `public`, `patron` and `dm` tiers, page and callout gating, the auth flow |
| [[Foundry integration]] | Building the vault into Foundry VTT, documents from `foundry.source`, player-visible pages |
| [[Passthrough files]] | Audio, video, PDF, EPUB and JSON files, gated per variant |
| [[Patreon login]] | Roles granted by Patreon tier |
| [[OIDC login]] | Single sign-on against any OIDC issuer, roles granted by email or domain |
| [[Math]] | `$inline$` and `$$display$$` LaTeX, rendered at build time with KaTeX |
| [[Battlemaps]] | Layered, multi-level maps with a grid overlay and PNG export |

Smaller features, without a page of their own:

- **Frontmatter dialog**: the `{}` button in the top-right of any page with frontmatter shows the raw YAML in a copyable box.
- **Generated folder indexes**: a folder without an `index.md` gets one, a Bases table of its contents with a list of subfolders above it. See `Mossfoot/NPCs/index`, `Mossfoot/Items/index` and `Mossfoot/Lore/index`.
- **Dark mode**: the theme picker in the sidebar offers auto, light and dark. `accent_color_dark` and `bg_color_dark` in `settings.md` set the dark palette; `accent_color` and `bg_color` set the light one.
- **Social meta**: every page emits `og:title`, `og:type` and `og:site_name`. A page with a cover image also emits `og:image` and `twitter:image`, with a `summary_large_image` card.
- **Search**: every variant ships its own `_search-index.json`. The search box in the sidebar matches substrings of titles, paths and body text, ranking title matches first.
- **Hover previews**: desktop browsers preview a page on hover, fetching `<path>.preview.json` on demand. `preview_mode` selects the behaviour: `normal` (the default) shows a popover and navigates on click; `sticky` pins the popover open on click, with a "Go to page" link; `none` disables previews.
- **Backlinks**: every page lists the pages that link to it in the right sidebar, computed at build time.
- **External links open in a new tab**: links off-host get `target="_blank" rel="noopener noreferrer"`.
- **Obsidian snippets**: `.obsidian/snippets/*.css` ships as `user.css`, loaded after the default theme. When `.obsidian/appearance.json` exists, only the snippets it enables are included.
- **Page transclusion**: `![[Some Page]]` on its own line inlines that page's rendered body; `![[Some Page#Section]]` inlines one section. See [[Wikilinks]].
- **Sitemap and robots**: with `site_url` set in `settings.md`, the build writes `sitemap.xml` and `robots.txt` listing the default-role pages.
- **Schema migrations**: `vaults migrate` applies pending vault layout changes when the CLI's internal format moves. `--list` shows what exists, `--dry-run` what would change.
