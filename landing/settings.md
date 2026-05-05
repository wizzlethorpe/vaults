---
# Display name for the wiki (shown in header and page titles).
vault_name: Mossfoot Test Vault

# WebP quality 1–100 for image compression. Set 0 to disable.
image_quality: 85

# Hard cap (in bytes) on a single file. Larger files are skipped.
max_file_bytes: 26214400

# Glob patterns of files to skip when rendering and syncing. Examples: 'Templates/**', '*.draft.md', 'Private/**'.
ignore:
  - README.md

# Inject the page title as an <h1> at the top. Set false if your notes already start with a '# Title' heading and you don't want the duplicate.
inline_title: false

# CSS width applied to images embedded without an explicit '|N' size hint. Any valid CSS dimension works (50vw, 400px, 100%, etc). Set empty string to leave images at natural size.
default_image_width: 50vw

# Center images in the article body. Set false to leave them flush left.
center_images: true

# Role assigned to pages with no 'role:' frontmatter. Empty string means the lowest-tier role (typically 'public'). Set to e.g. 'dm' for a private-by-default vault. Must be one of your configured roles.
default_role: ""

# Override the accent color (links, headings, highlights). Any CSS color works: '#a8201a', 'crimson', 'rgb(168 32 26)'. Empty = use the built-in scarlet.
accent_color: ""

# Override the background color. Any CSS color works: '#f4ecd8', 'wheat', 'rgb(244 236 216)'. Empty = use the built-in parchment.
bg_color: ""

# Vault-relative path to an image used as the site favicon (png/jpg/svg/webp). Empty = generated default with the vault's accent color.
favicon: ""

# When a page has no 'image:' frontmatter, fall back to the first embedded image in the body. Used for OG/Twitter social cards, Bases card covers, and Foundry actor/item reskins. Set false to opt out.
auto_image: true
---

# Vault settings

This file is managed by `vaults`. Edit values above (in the frontmatter).
Unknown keys are removed on the next sync.
