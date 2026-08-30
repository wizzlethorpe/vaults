---
# Display name for the wiki (shown in header and page titles).
vault_name: Wizzlethorpe Vaults

# WebP quality 1–100 for image compression. Set 0 to disable.
image_quality: 85

# Hard cap (in bytes) on a single file. Larger files are skipped.
max_file_bytes: 26214400

# Frontmatter applied to pages that match a glob, before anything else reads them. An ordered list of { match, data }: later rules merge over earlier ones, and a page's own frontmatter always wins. Use it to set a baseline without editing every file — e.g. role for a whole vault, or 'foundry: { journal: false }' for a folder whose pages exist to make compendium documents rather than articles. Applied once, where frontmatter is read, so the wiki, the Foundry sync and the module compiler all see the same page.
default_frontmatter:
  - match: '**'
    data:
      role: public

# Glob patterns of files to skip when rendering and syncing. Examples: 'Templates/**', '*.draft.md', 'Private/**'. Wildcards cross hidden segments, so 'tools/**' also covers 'tools/.venv/**'.
ignore:
  - README.md

# Inject the page title as an <h1> at the top. Set false if your notes already start with a '# Title' heading and you don't want the duplicate.
inline_title: true

# CSS width applied to images embedded without an explicit '|N' size hint. Any valid CSS dimension works (300px, 50vw, 100%, etc). Set empty string to leave images at natural size.
default_image_width: 50vw

# Center images in the article body. Set false to leave them flush left.
center_images: true

# Internal-link preview behavior on pointer (desktop) devices: 'normal' (the default) hovers a preview popover and navigates on click; 'sticky' hovers a preview and pins it open on click (with a 'Go to page' link) instead of navigating; 'none' disables previews entirely so links just navigate.
preview_mode: normal

# Internal-link preview behavior on touch (mobile) devices, where there is no hover: 'sticky' (the default) shows a preview on tap with a 'Go to page' link instead of navigating; 'none' disables previews so taps just navigate. ('normal' has no hover to trigger it on touch and behaves like 'none'.)
preview_mode_mobile: sticky

# Override the accent color (links, headings, highlights). Any CSS color works: '#a8201a', 'crimson', 'rgb(168 32 26)'. Empty = use the built-in scarlet.
accent_color: ""

# Override the background color for the light palette. Any CSS color works: '#f4ecd8', 'wheat', 'rgb(244 236 216)'. Empty = use the built-in parchment.
bg_color: ""

# Override the accent color for the dark palette. Any CSS color works. Empty = use the built-in dark accent (a brighter scarlet).
accent_color_dark: ""

# Override the background color for the dark palette. Any CSS color works. Empty = use the built-in deep warm dark.
bg_color_dark: ""

# Default colour theme: 'auto' (follows the visitor's OS preference), 'light' (parchment + scarlet), or 'dark'. Visitors can flip via the sidebar toggle; their choice persists in localStorage.
theme: auto

# Vault-relative path to an image used as the site favicon (png/jpg/svg/webp). Empty = generated default with the vault's accent color.
favicon: ""

# When a page has no 'image:' frontmatter, fall back to the first embedded image in the body. Used for OG/Twitter social cards, Bases card covers, and Foundry actor/item reskins. Set false to opt out.
auto_image: true

# Ship files with unrecognized extensions to every deploy variant. Default false skips them (with a warning) so a stray file in your vault can't accidentally bypass role gating. Recognized media types (audio/video/pdf/epub) are reference-gated like images regardless of this setting.
include_unknown_files: false

# Everything this vault says about Foundry VTT. 'package' is how it is delivered: 'adventure' packages it as one Adventure document, so importing it once makes every internal link resolve to the documents you imported — what a campaign wants; 'compendium' (the default) produces browsable packs, one per document type, which is what a reference library wants; 'none' ships no integration at all and the deploy drops the importer bundle and sync endpoints. 'player_role' is the highest role your players may read: pages at that role or below import player-visible, everything above stays GM-only, and empty (the default) means none of it is. 'module' is the manifest for 'vaults build --module' — anything Foundry accepts in a module.json, with only 'packs' written for you; leave it empty and the compiler looks for a module.json at the vault root or in foundry/ instead.
foundry:
  package: compendium
  player_role: ''
  system: dnd5e
  core_version: '14.359'
  module: {}

# Public base URL this vault is served from, e.g. 'https://notes.example.com'. Set it and the build emits sitemap.xml and robots.txt so search engines can index the site; leave it empty and neither is written. Only pages in the default (lowest) role are listed — a sitemap naming gated pages would advertise that they exist.
site_url: ""

# Markdown text rendered in a small <footer> at the bottom of every page. Supports inline markdown (links, *italic*, **bold**). Set to an empty string to hide the footer entirely.
footer: "Generated with [Wizzlethorpe Vaults](https://vaults.wizzlethorpe.com)."
---

# Vault settings

This file is managed by `vaults`. Edit values above (in the frontmatter).
Unknown keys are removed on the next sync.
