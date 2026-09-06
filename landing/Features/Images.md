---
title: Images
image: moss-tavern.webp
---

Images appear in three places: inline body embeds, `image:` frontmatter (used for cards, social cards and Foundry portraits), and cover discovery when no `image:` is set.

This page has `image: moss-tavern.webp` in its frontmatter. Open the `{}` button at the top-right to see the raw YAML. View source to see the `og:image` and Twitter card meta tags in `<head>`.

## Inline body embeds

```markdown
![[aelar-portrait.webp]]              # default_image_width from settings.md, 300px unless changed
![[aelar-portrait.webp|400]]          # explicit pixel width
![[aelar-portrait.webp|400x300]]      # width and height
```

![[aelar-portrait.webp|240]]

Plain Markdown image syntax also works:

```markdown
![A cosy inn](../attachments/moss-tavern.webp)
```

![A cosy inn](../attachments/moss-tavern.webp)

## Frontmatter `image:`

Setting `image:` in a page's frontmatter does three things:

1. **Social meta**: the layout emits `og:image` and `twitter:image`, so link previews on Slack, Discord and Twitter show the picture.
2. **Bases card covers**: a card view with `image: image` takes each card's cover from this property (see [[Features/Bases]]).
3. **Foundry portraits**: a page built into Foundry through `foundry.source` uses this image as the document's `img`, and for an Actor as the prototype token texture too (see [[Features/Foundry integration]]).

## Cover discovery

A page with no `image:` takes the first image embed in its body as its cover. [[Bram]]'s page has no `image:` and still gets one, from the portrait in his body. Embeds inside code spans and code blocks do not count, so a page that quotes an embed as an example does not adopt it. Turn discovery off with `auto_image: false` in `settings.md`.

## Compression and format conversion

PNG, JPEG, WebP, AVIF, TIFF and GIF inputs are re-encoded to WebP at build time, at the quality `image_quality` sets in `settings.md` (85 by default; `0` disables compression and ships files as they are). SVG passes through untouched. The result lands under `attachments/` or wherever the source lives, mirroring the source path. The source file is not modified; only the deploy carries the recoded copy.

## Caching

Every encode is cached under `.vaults/cache/images/q<quality>/`, keyed on the source file's hash, so a repeat build skips the codec for unchanged images. The cache is gitignored.
