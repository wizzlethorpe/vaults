---
title: Callouts
---

Obsidian-style callouts are blockquotes that start with `[!type]`. Each becomes a styled box with a coloured stripe and a title. **A type that matches a configured role name is removed at lower tiers**, so a page can gate part of its body without gating the whole page.

## Types

Styled types: `note` and `info`, `tip` and `hint`, `warning` and `caution`, `danger` and `error`, and `dm`. Any other type renders with the default style.

> [!info] Info
> The same shape as note, in a different colour.

> [!tip] Tip
> Advice or shortcuts.

> [!warning] Warning
> Caveats and pitfalls.

## Anatomy

```markdown
> [!info] Optional title goes here
> Body content. Can span multiple lines.
> Markdown inside callouts works (links, **bold**, lists).
```

The markdown above produces this callout:

> [!info] Optional title goes here
> Body content. Can span multiple lines.
> Markdown inside callouts works (links, **bold**, lists).

Without a title, the type name is the label.

> [!info]
> No title was supplied, so the header reads "Info".

A fold marker after the type makes the callout collapsible: `[!info]+` starts open, `[!info]-` starts collapsed.

## Role-gated callouts

When the callout type matches one of the vault's roles, the whole blockquote is stripped from every variant below that role, before rendering and not with CSS. This vault's roles are public, patron and dm, in that order.

> [!patron] Patron-tier callout
> Patrons and the DM see this paragraph. Public visitors do not.

> [!dm] DM-tier callout
> Only the DM sees this paragraph.

Sign in at each tier (the auth box in the sidebar) to see the difference.
