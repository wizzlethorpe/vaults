# Wizzlethorpe Vaults

> **🌐 Live at: [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com)**

This repo is the source of the Vaults landing page — and **it's a Vault
itself.** Every feature shown on the live site is rendered live from the
markdown in this repo by [Wizzlethorpe Vaults](https://github.com/wizzlethorpe/vaults-cli),
the CLI that publishes Obsidian vaults as self-hosted, role-gated wikis
on Cloudflare Pages.

The page doubles as documentation: visit the live site, read every
explainer page, log in at higher tiers to see role gating, then read
the source `.md` here to learn the authoring patterns.

## Try the role gating

The deployed site has three access tiers. Use the auth box in the
sidebar:

| Role | Password | Unlocks |
|---|---|---|
| `public` | _(no password — default)_ | Everything you see without signing in |
| `patron` | `patron-pass` | The Witchwood Cult page + a callout in Aelar's bio + Bixby's "Tower" lore |
| `dm` | `dm-pass` | All of the above, plus Hidden Caves + DM-only callouts |

Higher tiers see everything below them. Lower-tier visitors get
**structurally** redacted content (no HTML, no manifest entry, broken
wikilinks instead of working anchors), not CSS-hidden content.

## What this repo demonstrates

| Feature | Where |
|---|---|
| Wikilinks (bare names + aliases + folders) | Every cross-link; deep-dive at `Features/Wikilinks.md` |
| Obsidian-style callouts | `Features/Callouts.md` |
| Image handling, social meta, auto-discovery | `Features/Images.md` |
| Bases (filtered card / table / list views) | `Features/Bases.md`, embedded on the homepage |
| Role gating (page-level + callout-level) | `Features/Role gating.md` |
| Foundry VTT integration + `foundry_base` clones | `Features/Foundry integration.md` |
| Audio / video / PDF passthroughs (per-variant gated) | `Features/Passthrough files.md` |
| Frontmatter dialog (`{}` button) | Every page's top-right corner |
| Per-page OG / Twitter card meta | View source on any page |
| Custom theme colors via `settings.md` | `settings.md` |
| Auto-generated folder indexes | `NPCs/`, `Items/`, `Lore/`, `Features/` |

## Repo layout

```
vaults/                    ← this repo (a working Vault, not a static site)
├── settings.md            ← user-editable settings (theme, vault name, ignore patterns)
├── .vaultrc.json          ← CLI-managed: roles + password hashes (test passwords; safe)
├── index.md               ← homepage at vaults.wizzlethorpe.com
├── README.md              ← this file (excluded from the wiki via settings.md `ignore`)
├── NPCs.base              ← cards-view config used on the homepage
├── attachments/           ← images (compressed to webp at build time)
├── Audio/                 ← passthrough files (audio/video/pdf, role-gated like images)
├── NPCs/                  ← Aelar (SRD Scout), Bram (SRD Commoner), Dr. Bixby Wizzlethorpe (SRD Archmage)
├── Items/                 ← Healing Potion (SRD Potion of Healing)
├── Lore/                  ← The Mossfoot Inn (public), Witchwood Cult (patron), Hidden Caves (dm)
└── Features/              ← documentation pages: one per CLI feature
```

## Build it yourself

```bash
# install the CLI
npm install -g @wizzlethorpe/vaults

# clone this repo
git clone https://github.com/wizzlethorpe/vaults.git
cd vaults

# preview locally on http://localhost:8788
vaults preview

# or build to a directory
vaults build --output ./dist
```

For a real Cloudflare deploy:

```bash
vaults push    # one-shot wrangler pages deploy
```

## Authoring patterns showcased here

Each page in this repo is intentionally minimal so you can see the
patterns at a glance:

- **A plain article** — `Lore/The Mossfoot Inn.md`. Just title, image,
  body text, and wikilinks.
- **A page-gated article** — `Lore/Witchwood Cult.md` (patron) and
  `Lore/Hidden Caves.md` (dm). Shows `role:` frontmatter.
- **A page with role-gated callouts** — `NPCs/Aelar.md`. Visible to
  everyone; the patron + dm paragraphs strip per tier.
- **An NPC clone** — `NPCs/Dr. Bixby Wizzlethorpe.md` with `foundry_base:`
  pointing at the SRD Archmage. Foundry clones it; the `foundry:` block
  patches HP/CR/token name. Same pattern for `NPCs/Aelar.md` (SRD Scout)
  and `NPCs/Bram.md` (SRD Commoner).
- **An item clone** — `Items/Healing Potion.md` doing the same thing for
  the SRD Potion of Healing.

## ⚠️ A note on the test passwords

`.vaultrc.json` ships with throwaway passwords (`patron-pass`, `dm-pass`)
because this is a **public demo + landing page**. Do not reuse these on
any vault that hosts real content.

For your own vault, run `vaults role add <name>` and set a real password —
the CLI prompts for one and stores a salted PBKDF2 hash. The generated
`sessionSecret` should also stay out of git (the default `.gitignore`
covers this).

## Reporting bugs / feature requests

This is a demo of the [vaults-cli](https://github.com/wizzlethorpe/vaults-cli)
project. File issues there. PRs to this repo are welcome if you spot a
typo, want to demonstrate a feature better, or have an idea for additional
content.

## License

MIT. See [LICENSE](LICENSE).
