---
title: Passthrough files
---

Audio, video, PDFs, EPUBs and JSON ship as they are, alongside the wiki. They follow the same per-variant gating as images: a file lands in a variant **only if a visible page in that variant references it**.

## Recognised extensions

| Category | Extensions |
|---|---|
| Audio | `.ogg`, `.mp3`, `.m4a`, `.wav`, `.flac`, `.opus`, `.aac` |
| Video | `.mp4`, `.webm`, `.mov`, `.ogv` |
| Documents | `.pdf`, `.epub`, `.json` |

Anything else is **unknown** (see the bottom of this page).

## How references are detected

Four kinds of reference count. A file ships to a variant when a visible page in it has any of them:

```markdown
![[file.ogg]]                  # Obsidian embed
[label](path/to/file.pdf)      # markdown link
```

plus a ` ```download ` block naming the file by its vault path (see [[Handlers]]), and an `@vault/PATH` string in the page's frontmatter, which is how a Foundry playlist or scene names its audio.

Audio and video embeds render as `<audio controls>` and `<video controls>` players. Any other passthrough embeds as a link to the file.

To gate an audio file to the DM tier, reference it from a DM-only page or a DM-only callout.

## Example

This page links to [mossfoot-tavern.ogg](../Mossfoot/Audio/mossfoot-tavern.ogg), a 1.4 MB tavern ambience loop mixed from the Sonniss GDC library. This page is `public`, so the file ships to all three variants.

![[mossfoot-tavern.ogg]]

## Unknown extensions

A file outside the recognised list is dropped from the deploy, with a warning at build time, unless a `download` block names it:

```
  skipping 1 file(s) with unrecognized extensions:
    handouts/data.bin
    Run `vaults set include_unknown_files true` to ship them.
```

The warning lists ten paths at most. This default keeps a stray file from bypassing role gating. To opt in:

```bash
vaults set include_unknown_files true
```

Unknown-extension files then join the passthrough pool. They still need a reference from a visible page in the target variant to ship.

## Raw HTML references

`<a href="/audio/foo.ogg">` and other raw-HTML references are not detected. Only markdown links and embeds, `download` blocks and `@vault/` frontmatter references are. To reference a file from raw HTML, add a markdown reference elsewhere on the page, an HTML comment will do:

```markdown
<!-- ![[foo.ogg]] -->
<a href="/Audio/foo.ogg">play me</a>
```

The comment stages the file without affecting the rendered output.
