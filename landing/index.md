---
title: Wizzlethorpe Vaults
image: wizzlethorpe.webp
---

Wizzlethorpe Vaults turns an Obsidian vault into a self-hosted, role-gated wiki on your own free-tier Cloudflare account, and reads the same vault into Foundry VTT. **This page is itself a deployed vault** ([source](https://github.com/wizzlethorpe/vaults/tree/main/landing)). Every feature described here runs live on this site. Sign in at a higher tier, view source, [set up your own vault](#set-up-your-own-vault), or read the [[Features]].

> [!info] Try the role gating
> This vault has three tiers: **public**, **patron** and **dm**. You are reading the public tier. Use the auth box in the sidebar to sign in as a higher tier:
>
> | Role | Password | Unlocks |
> |---|---|---|
> | `patron` | `patron-pass` | The [[Witchwood Cult]] page and a callout on [[Aelar]]'s page |
> | `dm` | `dm-pass` | All of the above, plus [[Hidden Caves]] and the DM callouts |
>
> Pages above your tier return 404. Pages at your tier omit the callouts above it. Open Aelar's page at each tier to see the difference.

> [!tip] Support Wizzlethorpe Labs
> Wizzlethorpe Vaults is free and open source. If it is useful to you, [support us on Patreon](https://www.patreon.com/wizzlethorpe). More free tools and content at [wizzlethorpe.com](https://wizzlethorpe.com).

## What is demonstrated here

| Feature | See it on |
|---|---|
| Wikilinks | [[Features/Wikilinks]] |
| Callouts | [[Features/Callouts]] |
| Images and cover discovery | [[Features/Images]] |
| Bases (filtered and sorted views over your notes) | [[Features/Bases]] |
| Math (KaTeX) | [[Features/Math]] |
| Battlemaps | [[Features/Battlemaps]] |
| Role gating | [[Features/Role gating]] |
| Sign-in through Patreon or OIDC | [[Features/Patreon login]], [[Features/OIDC login]] |
| Foundry VTT integration | [[Features/Foundry integration]] |
| Frontmatter dialog | the `{}` button in the top-right of any page that has frontmatter |
| Social-card meta | view source on any page for `og:title`; a page with a cover image also carries `og:image` |

## Try it in Foundry VTT

This vault also builds into a Foundry world. Each folder becomes a JournalEntry with one page per note, wikilinks become Foundry document links, and pages with a `foundry.source` block become real Actors, Items, Scenes, tables, decks, playlists and macros, built on your machine from the compendiums you already own.

```foundry-install
label: Add this vault to Foundry
note: Needs the Graft module
```

> [!tip] Import this vault into Foundry
> 1. Sign in at the tier you want Foundry to read, then download the file above. It is your own copy: a `dm` sign-in gets the DM's pages, a public one does not.
> 2. In a dnd5e world with **Graft** enabled, open **Import grafts** on Graft's settings tab and load the file.
> 3. The content lands in the world, foldered to match the vault. Signed in as `dm`, [[Hidden Caves]] and the DM callouts arrive.
> 4. For newer content, download the file again and import it again. The link inside it expires after two hours.

Nothing a vault builds is player-visible by default. `foundry.player_role` in `.vaults/settings.yaml` names the highest tier players may read: set to `patron`, public and patron journal pages arrive with Observer ownership and `dm` pages stay GM-only. Actors, Items and the other documents a page builds are GM-only regardless. See [[Features/Foundry integration]].

## Set up your own vault

```bash
npm install -g @wizzlethorpe/vaults
cd path/to/your/obsidian-vault
vaults init
vaults preview        # local preview at http://localhost:4173
vaults push           # one-shot deploy to Cloudflare Pages
```
