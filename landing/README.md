# Wizzlethorpe Vaults landing vault

Live at [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com).

This folder is the source of the Vaults landing page, and it is a vault itself. Every page on the live site is rendered from the markdown here by [Wizzlethorpe Vaults](https://github.com/wizzlethorpe/vaults), the CLI in `../cli`. It doubles as documentation: read the live site, sign in at higher tiers to see role gating, then read the source here for the authoring patterns.

## Try the role gating

The deployed site has three tiers. Use the auth box in the sidebar.

| Role | Password | Unlocks |
|---|---|---|
| `public` | none (default) | Everything visible without signing in |
| `patron` | `patron-pass` | The Witchwood Cult page and a callout on Aelar's page |
| `dm` | `dm-pass` | All of the above, plus Hidden Caves and the DM-only callouts |

Higher tiers see everything below them. A lower tier gets structurally redacted output: no HTML, no search-index entry, no Foundry entry, and links that render unresolved. Nothing is hidden with CSS.

## What this vault demonstrates

| Feature | Where |
|---|---|
| Wikilinks (bare names, aliases, folders) | every cross-link; `Features/Wikilinks.md` |
| Obsidian-style callouts | `Features/Callouts.md` |
| Image handling, social meta, cover discovery | `Features/Images.md` |
| Bases (filtered card and table views) | `Features/Bases.md`; `Mossfoot/index.md` embeds one |
| Role gating, per page and per callout | `Features/Role gating.md` |
| Foundry VTT integration and `foundry.source` documents | `Features/Foundry integration.md` |
| Audio, video, PDF and JSON passthroughs, gated per variant | `Features/Passthrough files.md` |
| Frontmatter dialog (`{}` button) | any page with frontmatter |
| Per-page OG and Twitter meta | view source on any page |
| Theme colours through `.vaults/settings.yaml` | `.vaults/settings.yaml` |
| Generated folder indexes | `Mossfoot/NPCs/`, `Mossfoot/Items/`, `Mossfoot/Lore/` |

## Layout

```
landing/                 this folder, inside the wizzlethorpe/vaults monorepo
  .vaults/settings.yaml  vault settings: theme, name, ignore patterns, Foundry
  .vaults/config.json    CLI-managed: roles and password hashes (throwaway passwords)
  index.md               the homepage
  README.md              this file, excluded from the wiki by `ignore` in `.vaults/settings.yaml`
  attachments/           images, compressed to WebP at build time
  Features/              one documentation page per feature
  Mossfoot/              the sample campaign, one folder per content kind
    NPCs.base            cards and table views embedded on the Mossfoot index
    Audio/               passthrough files
    NPCs/                Aelar (SRD Scout), Bram (SRD Commoner), Dr. Bixby Wizzlethorpe (SRD Archmage), Mossroot (blank npc)
    Items/               Healing Potion (SRD Potion of Healing)
    Lore/                The Mossfoot Inn (public), Witchwood Cult (patron), Hidden Caves (dm)
    Scenes/ Decks/ Playlists/ Macros/ Tables/ sheets/
```

## Build it yourself

```bash
npm install -g @wizzlethorpe/vaults
git clone https://github.com/wizzlethorpe/vaults.git
cd vaults/landing
vaults preview                 # http://localhost:4173
vaults build --output ./dist   # or build to a directory
vaults push                    # deploy to your own Cloudflare Pages project
```

## Authoring patterns

- A plain article: `Mossfoot/Lore/The Mossfoot Inn.md`. Title, image, body text and wikilinks.
- A page-gated article: `Mossfoot/Lore/Witchwood Cult.md` (patron) and `Mossfoot/Lore/Hidden Caves.md` (dm), through `role:` frontmatter.
- Role-gated callouts inside a public page: `Mossfoot/NPCs/Aelar.md`. The patron and dm callouts are stripped below their tier.
- An NPC built from a compendium document: `Mossfoot/NPCs/Dr. Bixby Wizzlethorpe.md`, with `foundry.source` naming the SRD Archmage and a `foundry.patch` block for HP, CR and token name. `Aelar.md` (SRD Scout) and `Bram.md` (SRD Commoner) follow the same pattern.
- A blank NPC with a statblock: `Mossfoot/NPCs/Mossroot.md`, `foundry.source: Actor:npc`, with the wiki statblock reading its numbers from the same frontmatter.
- An item built from a compendium document: `Mossfoot/Items/Healing Potion.md`, the SRD Potion of Healing.

## The test passwords

`.vaults/config.json` holds hashes of throwaway passwords, and this README publishes the passwords themselves, because this is a public demo. Do not reuse them on a vault that hosts real content.

For your own vault, run `vaults role add <name>` and set a password at the prompt; the CLI stores a salted PBKDF2 hash. The generated `SESSION_SECRET` lives in `.env` at the vault root, and `vaults init` adds `.env` to the vault's `.gitignore`.

## Bugs and feature requests

File issues on [wizzlethorpe/vaults](https://github.com/wizzlethorpe/vaults). Pull requests that fix a typo, demonstrate a feature better, or add content are welcome.

## License

MIT. See [LICENSE](LICENSE).
