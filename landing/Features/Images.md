---
title: Images
image: moss-tavern.webp
---

Vaults handles images in three places: inline body embeds, `image:` frontmatter
(used for cards, social cards, and Foundry document portraits), and an
auto-discovery fallback when no explicit image is set.

This page has `image: moss-tavern.webp` in frontmatter. Open the `{}` button at the top-right to see the raw YAML, or view source to see the generated `og:image` and Twitter card meta tags in `<head>`.

## Inline body embeds

```markdown
![[aelar-portrait.webp]]              # natural width
![[aelar-portrait.webp|400]]          # explicit pixel width
```

![[aelar-portrait.webp|240]]

Plain Markdown image syntax also works:

```markdown
![A cosy inn](../attachments/moss-tavern.webp)
```

![A cosy inn](../attachments/moss-tavern.webp)

## Frontmatter `image:`

Setting `image:` in the page's frontmatter does three things:

1. **Social meta**: the layout emits `og:image` and `twitter:image` tags
   so link previews on Slack, Discord, and Twitter look right.
2. **Bases card covers**: when a Base view declares `image: image`, the
   cards plugin uses this property to populate each card's cover. (See
   [[Features/Bases]] for the card view in action.)
3. **Foundry portraits**: when the page is cloned into Foundry via
   `foundry.base`, this image becomes the Actor/Item `img` and prototype
   token texture. (See [[Features/Foundry integration]].)

## Auto-discovery

If a page has no `image:` frontmatter, the renderer falls back to **the
first image embed in the body**. [[Bram]]'s page has no explicit `image:`
field but still gets a cover image. The auto-discovery picks his portrait
from the body. Toggle this off with `auto_image: false` in `settings.md`.

## Compression + format conversion

PNG/JPEG/AVIF/TIFF/GIF inputs all get re-encoded to WebP at build time
(quality controlled by `image_quality` in `settings.md`, default 85). The
resulting file includes under `attachments/` (or wherever your source put
it). The original file stays put in your vault, only the deploy gets
the recoded version.

## File caching

Image compression is the slowest part of a build. Vaults caches every
encode keyed on the source file's hash, so repeat builds skip the codec
entirely for unchanged images. The cache lives under `.vaults/cache/images/`
in your vault and is gitignored by default.
