---
title: Callouts
---

Obsidian-style callouts are blockquotes that start with `[!type]`. The renderer turns them into styled boxes with a coloured stripe and an icon slot. Standard types map to recognisable styles. **Types that match a configured role name are redacted at lower tiers**. That's how page-level content can hide pieces of itself based on the visitor's role.

## Standard types

> [!info] Info
> Same energy as note, slightly different color palette.

> [!tip] Tip
> Use for advice or shortcuts.

> [!warning] Warning
> Use for important caveats or potential pitfalls.

## Anatomy

```markdown
> [!info] Optional title goes here
> Body content. Can span multiple lines.
> Markdown inside callouts works (links, **bold**, lists).
```

The above markdown produces this callout:

> [!info] Optional title goes here
> Body content. Can span multiple lines.
> Markdown inside callouts works (links, **bold**, lists).

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
difference.
