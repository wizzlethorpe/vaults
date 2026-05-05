---
title: Callouts
---

# Callouts

Obsidian-style callouts are blockquotes that start with `[!type]`. The renderer turns them into styled boxes with a coloured stripe and an icon slot. Standard types map to recognisable styles; **types that match a configured role name are redacted at lower tiers**. That's how page-level content can hide pieces of itself based on the visitor's role.

## Standard types

> [!note] Note
> Anything informational. The default type if you're unsure.

> [!info] Info
> Same energy as note, slightly different colour palette.

> [!tip] Tip
> Use for advice or shortcuts.

> [!warning] Warning
> Use sparingly — colour grabs attention.

> [!quote] Quote
> Best for in-character voice or a famous line.

> [!example] Example
> Code samples, walkthroughs, sample configs.

> [!success] Success
> Green-tinted; use for confirmation or "this works".

> [!failure] Failure
> Red-tinted counterpart to success.

## Anatomy

```markdown
> [!note] Optional title goes here
> Body content. Can span multiple lines.
> Markdown inside callouts works (links, **bold**, lists).
```

If you omit the title, the type name is used as a default label.

> [!info]
> No title was supplied. The header reads "Info" by default.

## Role-gated callouts

When the callout type matches one of your configured roles, the renderer
**strips the entire blockquote** at every variant lower than that role.
This vault has roles `public < patron < dm`, so:

> [!patron] Patron-tier callout
> Public visitors don't see this paragraph at all. It's removed from
> their HTML before rendering, not hidden with CSS. Patrons and the DM see
> it normally.

> [!dm] DM-tier callout
> Only the DM sees this. Patrons get nothing here either. The two callouts
> above and below this one render at their respective tiers.

Toggle between the public/patron/dm tiers (sidebar auth box) to see the
difference. The page renders cleanly at every tier — the surrounding
content adjusts as if the redacted callouts were never authored.

> [!success] After the role-gated callouts
> This callout is unconditionally visible. The redaction is paragraph-scoped,
> not "everything after the first role callout".

