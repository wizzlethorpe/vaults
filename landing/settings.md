---
# Display name for the wiki (shown in header and page titles).
vault_name: Wizzlethorpe Vaults

# WebP quality 1–100 for image compression. Set 0 to disable.
image_quality: 85

# Hard cap (in bytes) on a single file. Larger files are skipped.
max_file_bytes: 26214400

# Glob patterns of files to skip when rendering and syncing. Examples: 'Templates/**', '*.draft.md', 'Private/**'.
ignore:
  - README.md

# Inject the page title as an <h1> at the top. Set false if your notes already start with a '# Title' heading and you don't want the duplicate.
inline_title: true

# CSS width applied to images embedded without an explicit '|N' size hint. Any valid CSS dimension works (300px, 50vw, 100%, etc). Set empty string to leave images at natural size.
default_image_width: 50vw

# Center images in the article body. Set false to leave them flush left.
center_images: true

# Internal-link preview behavior: 'normal' (the default) hovers a preview popover and navigates on click; 'sticky' hovers a preview and pins it open on click (with a 'Go to page' link) instead of navigating; 'none' disables previews entirely so links just navigate.
preview_mode: normal

# Role assigned to pages with no 'role:' frontmatter. Empty string means the lowest-tier role (typically 'public'). Set to e.g. 'dm' for a private-by-default vault. Must be one of your configured roles.
default_role: ""

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

# Markdown text rendered in a small <footer> at the bottom of every page. Supports inline markdown (links, *italic*, **bold**). Set to an empty string to hide the footer entirely.
footer: "Generated with [Wizzlethorpe Vaults](https://vaults.wizzlethorpe.com)."
---

# Vault settings

This file is managed by `vaults`. Edit values above (in the frontmatter).
Unknown keys are removed on the next sync.
