---
title: Mossfoot Test Vault
---

# Mossfoot Test Vault

A live demo of [Wizzlethorpe Vaults](https://github.com/wizzlethorpe/vaults-cli) —
a CLI that turns an Obsidian vault into a self-hosted, role-gated wiki on
Cloudflare Pages. Every page on this site is rendered from a real `.md` file;
the source repo is at [github.com/wizzlethorpe/test-vault](https://github.com/wizzlethorpe/test-vault).

> [!info] Try the role gating
> This vault has three tiers: **public**, **patron**, and **dm**. You're
> reading the public tier right now. Use the auth box in the sidebar to
> sign in as a higher tier:
>
> | Role | Password | Unlocks |
> |---|---|---|
> | `patron` | `patron-pass` | The [[Witchwood Cult]] page + a callout in [[Aelar]]'s page |
> | `dm` | `dm-pass` | All of the above, plus [[Hidden Caves]] + DM callouts |
>
> Pages above your tier 404 directly; lower-tier pages redact role-gated
> callouts inside them. Try Aelar's page at each tier to see the difference.

## What's demonstrated here

| Feature | See it on |
|---|---|
| Wikilinks | [[Features/Wikilinks]] |
| Callouts | [[Features/Callouts]] |
| Images & cover discovery | [[Features/Images]] |
| Bases (filtered/sorted views over your notes) | [[Features/Bases]], scroll down |
| Role gating | [[Features/Role gating]] |
| Foundry VTT integration | [[Features/Foundry integration]] |
| Frontmatter dialog | the `{}` button in the top-right of every page |
| Per-page social-card meta | view source on any page → `og:image`, `og:title`, etc. |

## A small cast

The vault is themed around a fictional roadside inn so the demo content has
some narrative weight. The Bases block below is a live cards view filtered
to NPCs and sorted by name — the same authoring pattern works for items,
locations, sessions, anything you can give consistent frontmatter.

![[NPCs]]

## Audio + passthrough files

The vault ships `Audio/tavern-jingle.ogg` to demonstrate that any file the
build doesn't recognise as a markdown page or image gets shipped to the
deploy unchanged — useful for PDFs, soundscapes, downloadable handouts.

> [!note] Source on GitHub
> Every page on this site has a source `.md` you can read. Click the `{}`
> button at the top-right of any page to see the page's frontmatter, or
> browse the repo at
> [github.com/wizzlethorpe/test-vault](https://github.com/wizzlethorpe/test-vault).

## Set up your own vault

```bash
npm install -g @wizzlethorpe/vaults
cd path/to/your/obsidian-vault
vaults init
vaults preview        # local preview at http://localhost:8788
vaults push           # one-shot deploy to Cloudflare Pages
```

Full docs: [github.com/wizzlethorpe/vaults-cli](https://github.com/wizzlethorpe/vaults-cli).
