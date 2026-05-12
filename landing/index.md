---
title: Wizzlethorpe Vaults
image: wizzlethorpe.webp
---

Wizzlethorpe Vaults is a tool that turns an Obsidian vault into a self-hosted, role-gated, FoundryVTT-importable wiki on your own (free-tier) Cloudflare account. **This page is itself a deployed Vault** (see the [source code](https://github.com/wizzlethorpe/vaults/tree/main/landing)). Every feature you read about works live, right here. Poke around, sign in at higher tiers, view source, [set up your own vault](#set-up-your-own-vault), and check out the [[Features]] for a demo of everything it can do.


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
> Pages above your tier 404 directly. Lower-tier pages redact role-gated
> callouts inside them. Try Aelar's page at each tier to see the difference.

> [!tip] Support Wizzlethorpe Labs
> Wizzlethorpe Vaults is a free and open-source Wizzlethorpe Labs product. If you find it useful, please consider supporting us on [Patreon](https://www.patreon.com/wizzlethorpe). Check out [wizzlethorpe.com](https://wizzlethorpe.com) for more free tools and content!

## What's demonstrated here

| Feature | See it on |
|---|---|
| Wikilinks | [[Features/Wikilinks]] |
| Callouts | [[Features/Callouts]] |
| Images & cover discovery | [[Features/Images]] |
| Bases (filtered/sorted views over your notes) | [[Features/Bases]] |
| Role gating | [[Features/Role gating]] |
| Foundry VTT integration | [[Features/Foundry integration]] |
| Frontmatter dialog | the `{}` button in the top-right of every page |
| Per-page social-card meta | view source on any page → `og:image`, `og:title`, etc. |

## Try it in Foundry VTT

The companion module syncs this vault into a Foundry world: every page becomes a JournalEntry, every wikilink rewires to a Foundry document link, and pages with `foundry.base` frontmatter clone an existing compendium document into the world (NPCs become real Actors, items become real Items).

> [!tip] Import this vault into Foundry
> 1. Install the **Wizzlethorpe Vaults** module: in Foundry → *Add-on
>    Modules* → *Install Module* → search for **Wizzlethorpe Vaults** →
>    Install.
> 2. In a dnd5e world, enable the module and click the
>    **Sync Vault** button on the Journal Directory.
> 3. **Add Vault** → paste `https://vaults.wizzlethorpe.com` →
>    settings dialog opens with the deploy's name pre-filled.
> 4. Click **Sync**, by default, this imports the public tier.
>    You'll get all of the journals, actors, items, scenes, cards, and rolltables defined in this vault.
> 5. Click **Sign In** and log in as the `dm` role. The next sync brings
>    in the DM-only [[Hidden Caves]] page and the DM callouts.
> 6. Open the per-vault settings, set **DM role** to `dm`. Now public- 
>    and patron-tier journals import as player-visible (Observer ownership). DM pages stay GM-only.

See [[Features/Foundry integration]] for more details on how the sync works and how to set up your own vault for Foundry.

## Set up your own vault

```bash
npm install -g @wizzlethorpe/vaults
cd path/to/your/obsidian-vault
vaults init
vaults preview        # local preview at http://localhost:8788
vaults push           # one-shot deploy to Cloudflare Pages
```

