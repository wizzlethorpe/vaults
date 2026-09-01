---
# Display name for the wiki. Shown in the header and in page titles.
vault_name: Wizzlethorpe Vaults

# WebP quality 1–100 for image compression. Set 0 to disable.
image_quality: 85

# Hard cap (in bytes) on a single file. Larger files are skipped.
max_file_bytes: 26214400

# Frontmatter applied to pages matching a glob, as an ordered list of { match, data }. Later rules merge over earlier ones, and a page's own frontmatter beats all of them. Use it to set a baseline without editing every file, such as a role for the whole vault.
default_frontmatter:
  - match: '**'
    data:
      role: public

# Glob patterns of files to skip, e.g. 'Templates/**' or '*.draft.md'. Wildcards cross hidden segments, so 'tools/**' also covers 'tools/.venv/**'.
ignore:
  - README.md

# Inject the page title as an <h1>. Set false if your notes already start with their own '# Title'.
inline_title: true

# CSS width for images embedded without a '|N' size hint (300px, 50vw, 100%). Empty leaves them at natural size.
default_image_width: 50vw

# Center images in the article body. Set false to leave them flush left.
center_images: true

# Link previews on desktop: 'normal' hovers a preview and navigates on click, 'sticky' pins the preview open on click instead, 'none' disables them.
preview_mode: normal

# Link previews on touch, where there is no hover: 'sticky' shows a preview on tap with a 'Go to page' link, 'none' disables them. 'normal' behaves like 'none' here.
preview_mode_mobile: sticky

# Accent color for links, headings and highlights. Any CSS color. Empty uses the built-in scarlet.
accent_color: ""

# Background color for the light palette. Any CSS color. Empty uses the built-in parchment.
bg_color: ""

# Accent color for the dark palette. Empty uses the built-in brighter scarlet.
accent_color_dark: ""

# Background color for the dark palette. Empty uses the built-in deep warm dark.
bg_color_dark: ""

# Default theme: 'auto' follows the visitor's OS setting, or 'light' or 'dark'. Visitors can flip it from the sidebar and their choice persists.
theme: auto

# Vault-relative path to a favicon image (png/jpg/svg/webp). Empty generates one from the accent color.
favicon: ""

# Fall back to a page's first embedded image when it has no 'image:' frontmatter. Used for social cards, Bases card covers, and Foundry art.
auto_image: true

# Ship files with unrecognized extensions. Default false skips them with a warning, so a stray file cannot bypass role gating. Recognized media (audio, video, pdf, epub) is reference-gated either way.
include_unknown_files: false

# Foundry VTT integration. 'package': 'adventure' ships the vault as one Adventure document you import once, 'compendium' (the default) as browsable packs, one per document type, 'none' ships nothing. 'player_role': the highest role players may read. Pages at or below it arrive player-visible; empty (the default) means none are. 'system': the game system your Actor and Item content targets, e.g. dnd5e. 'core_version': the full quoted Foundry version your exported Scene / Actor JSON came from, e.g. '14.359'. A bare '14' sorts before every release in that generation and costs a Scene its levels. 'module': extra keys merged into the module.json the vault serves, such as 'authors'.
foundry:
  package: compendium
  player_role: ''
  system: dnd5e
  core_version: '14.359'
  module: {}

# Public base URL this vault is served from, e.g. 'https://notes.example.com'. Set it and the build writes sitemap.xml and robots.txt; leave it empty and neither is written. Only default-role pages are listed, so a sitemap cannot advertise gated ones.
site_url: ""

# Markdown rendered in a <footer> on every page. Inline markdown works. Empty hides the footer.
footer: "Generated with [Wizzlethorpe Vaults](https://vaults.wizzlethorpe.com)."
---

# Vault settings

This file is managed by `vaults`. Edit values above (in the frontmatter).
Unknown keys are removed on the next sync.
