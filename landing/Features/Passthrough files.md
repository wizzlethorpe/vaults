---
title: Passthrough files
---

# Passthrough files

Audio, video, PDFs, EPUBs (files the build doesn't currently render) deploy alongside the wiki. They follow the same per-variant gating as images: a file lands in a deploy variant **only if a visible page in that variant references it**.

## Recognised extensions

| Category | Extensions |
|---|---|
| Audio | `.ogg`, `.mp3`, `.m4a`, `.wav`, `.flac`, `.opus`, `.aac` |
| Video | `.mp4`, `.webm`, `.mov`, `.ogv` |
| Documents | `.pdf`, `.epub` |

Anything else is treated as **unknown** (see the bottom of this page).

## How references are detected

Three patterns count as a reference. As long as a visible page in the
target variant matches one, the file ships to that variant:

```markdown
![[file.ogg]]                  # Obsidian embed (audio plays inline)
[[file.ogg]]                   # Obsidian wikilink
[label](path/to/file.pdf)      # standard markdown link
```

If you want an audio file gated to the DM tier, just reference it from a
DM-only page (or a DM-only callout). The build does the rest.

## Example

This page links to [tavern-jingle.ogg](../Audio/tavern-jingle.ogg), a short 17 KB OGG. Because this page is `public` (no `role:` frontmatter override), the file ships to all three deploy variants.

## Unknown extensions

Anything outside the recognised list is dropped from the deploy by default,
with a warning at build time:

```
  skipping 1 file(s) with unrecognized extensions:
    handouts/data.bin
    Set 'include_unknown_files: true' in settings.md to ship them.
```

This is a safety default: a stray file in your vault can't accidentally
bypass role gating. To opt in, add this to `settings.md`:

```yaml
include_unknown_files: true
```

When enabled, unknown-extension files join the passthrough pool. They still need to be referenced by a visible page (in the target variant) to deploy.

## What about HTTP-referenced files?

`<a href="/audio/foo.ogg">` and similar raw-HTML references are NOT detected by the scanner. Only markdown-level patterns are. If you need to reference a file from raw HTML, also add a markdown-level reference elsewhere on the page (or inside a comment):

```markdown
<!-- ![[foo.ogg]] -->
<a href="/Audio/foo.ogg">play me</a>
```

The HTML comment ensures the file is shipped without affecting the rendered output.
