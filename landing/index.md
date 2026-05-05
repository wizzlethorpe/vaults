---
title: Wizzlethorpe Vaults
image: wizzlethorpe.webp
---

# Wizzlethorpe Vaults

Wizzlethorpe Vaults is a tool that turns an Obsidian vault into a self-hosted, role-gated, FoundryVTT-importable wiki on your own (free-tier) Cloudflare account. **This page is itself a deployed Vault**. Every feature you read about works live, right here. Poke around, sign in at higher tiers, view source, then [grab the CLI](https://github.com/wizzlethorpe/vaults-cli) and deploy your own!


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

A live [Obsidian Bases](https://obsidian.md/help/bases) cards view filtered to NPCs, sorted by name. The same
authoring pattern works for items, locations, sessions, anything you can
give consistent frontmatter. The eponymous [[Dr. Bixby Wizzlethorpe]] is
in the back booth.

![[NPCs]]


See more about support for Obsidian bases functionality in [[Features/Bases]].

## Audio + passthrough files

This vault includes [tavern-jingle.ogg](Audio/tavern-jingle.ogg) to demonstrate how files that are not (currently) rendered into the wiki are handled. These include audio, video, PDFs, and EPUBs files. These files are included in the deploy **only into variants whose visible pages reference them**, just like images. See [[Features/Passthrough files]] for more details.

## Try it in Foundry VTT

The companion module syncs this vault into a Foundry world: every page becomes a JournalEntry, every wikilink rewires to a Foundry document link, and pages with `foundry_base` frontmatter clone an existing compendium document into the world (NPCs become real Actors, items become real Items).

> [!tip] Import this vault into Foundry
> 1. Install the **Wizzlethorpe Vaults** module: in Foundry → *Add-on
>    Modules* → *Install Module* → search for **Wizzlethorpe Vaults** →
>    Install. (Or browse the listing on the
>    [Foundry package directory](https://foundryvtt.com/packages/vaults).)
> 2. In a dnd5e world, enable the module and click the
>    **Sync Vault** button on the Journal Directory.
> 3. **Add Vault** → paste `https://test.vaults.wizzlethorpe.com` →
>    settings dialog opens with the deploy's name pre-filled.
> 4. Click **Sync**, by default, this imports the public tier.
>    You'll get [[Aelar]] and [[Bram]] as world Actors (cloned from SRD
>    Scout + Commoner) and [[Healing Potion]] as a world Item.
> 5. Click **Authenticate** and log in as the `dm` role. The next sync brings
>    in the DM-only [[Hidden Caves]] page and the DM callouts.
> 6. Open the per-vault settings, set **DM role** to `dm`. Now public- 
>    and patron-tier journals import as player-visible (Observer ownership); 
>    dm pages stay GM-only.

The page-driven Actor/Item descriptions render the wiki article inline via Foundry's `@Embed[…]` enricher, so editing a page and re-syncing updates the doc's description automatically. See [[Features/Foundry integration]] for more details on how the sync works and how to set up your own vault for Foundry.

## Set up your own vault

```bash
npm install -g @wizzlethorpe/vaults
cd path/to/your/obsidian-vault
vaults init
vaults preview        # local preview at http://localhost:8788
vaults push           # one-shot deploy to Cloudflare Pages
```

Full docs: [github.com/wizzlethorpe/vaults-cli](https://github.com/wizzlethorpe/vaults-cli).
