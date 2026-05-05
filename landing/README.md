# Mossfoot Test Vault

> **🌐 Live demo: [test.vaults.wizzlethorpe.com](https://test.vaults.wizzlethorpe.com)**

A small Obsidian vault used as a working demo of every feature
[Wizzlethorpe Vaults](https://github.com/wizzlethorpe/vaults-cli) ships.
Browse the live site, sign in at higher tiers to see role gating in
action, then read the source `.md` files in this repo to see how each
page is authored.

## Try the role gating

The deployed site ships with three access tiers. Use the auth box in the
sidebar to sign in:

| Role | Password | Unlocks |
|---|---|---|
| `public` | _(no password — default)_ | Everything you see without signing in |
| `patron` | `patron-pass` | The Witchwood Cult page + a callout in Aelar's bio |
| `dm` | `dm-pass` | All of the above, plus Hidden Caves + DM-only callouts |

Higher tiers see everything below them too — `dm` sees patron + public
content as well. Lower-tier visitors get **structurally** redacted content
(no HTML, no manifest entry, broken wikilinks instead of working anchors)
rather than CSS-hidden content.

## What's demonstrated here

| Feature | Where |
|---|---|
| Wikilinks (bare names + aliases + folders) | Every cross-link; deep-dive at `Features/Wikilinks.md` |
| Obsidian-style callouts | `Features/Callouts.md` |
| Image handling, social meta, auto-discovery | `Features/Images.md` |
| Bases (filtered card / table / list views) | `Features/Bases.md`, embedded on the homepage |
| Role gating (page-level + callout-level) | `Features/Role gating.md` |
| Foundry VTT integration + `foundry_base` clones | `Features/Foundry integration.md` |
| Frontmatter dialog (`{}` button) | Every page's top-right corner |
| Per-page OG / Twitter card meta | View source on any page |
| Audio / passthrough files | `Audio/tavern-jingle.ogg` |
| Custom theme colors via `settings.md` | `settings.md` |
| Auto-generated folder indexes | `NPCs/`, `Items/`, `Lore/`, `Features/` |

## Repo layout

```
test-vault/
├── settings.md          ← user-editable settings (theme, vault name, ignore patterns)
├── .vaultrc.json        ← CLI-managed: roles + password hashes (test passwords; safe)
├── index.md             ← homepage
├── README.md            ← this file (rendered as a wiki page too)
├── NPCs.base            ← cards-view config used on the homepage
├── attachments/         ← images (compressed to webp at build time)
├── Audio/               ← passthrough files (shipped unchanged)
├── NPCs/                ← Aelar, Bram (with `foundry_base` clones)
├── Items/               ← Healing Potion (with `foundry_base` clone)
├── Lore/                ← The Mossfoot Inn (public), Witchwood Cult (patron), Hidden Caves (dm)
└── Features/            ← documentation pages: one per feature
```

## Build it yourself

```bash
# install the CLI
npm install -g @wizzlethorpe/vaults

# clone this repo
git clone https://github.com/wizzlethorpe/test-vault.git
cd test-vault

# preview locally on http://localhost:8788
vaults preview

# or build to a directory
vaults build --output ./dist
```

For a real Cloudflare deploy:

```bash
vaults push    # one-shot wrangler pages deploy
```

## Authoring pattern: how each piece is wired

Each page in this vault is intentionally minimal so you can see what's
happening at a glance:

- **A plain article** — `Lore/The Mossfoot Inn.md`. Just title, image,
  body text, and wikilinks.
- **A page-gated article** — `Lore/Witchwood Cult.md` (patron) and
  `Lore/Hidden Caves.md` (dm). Shows `role:` frontmatter.
- **A page with role-gated callouts** — `NPCs/Aelar.md`. Visible to
  everyone; the patron + dm paragraphs strip per tier.
- **An NPC clone** — `NPCs/Aelar.md` with `foundry_base:` pointing at the
  SRD Scout. Foundry clones it; the `foundry:` block patches HP.
- **An item clone** — `Items/Healing Potion.md` doing the same thing for
  the SRD Potion of Healing.

## ⚠️ A note on the test passwords

`.vaultrc.json` ships with throwaway passwords (`patron-pass`, `dm-pass`)
because this is a **public demo**, not a real vault. Do not reuse these
on any vault that hosts real content.

For your own vault, run `vaults role add <name>` and set a real password —
the CLI prompts for one and stores a salted PBKDF2 hash. The generated
`sessionSecret` should also stay out of git (the default `.gitignore`
covers this on real vaults).

## Reporting bugs / feature requests

This is a demo of the [vaults-cli](https://github.com/wizzlethorpe/vaults-cli)
project. File issues there. PRs to this repo are welcome if you spot a
typo, want to demonstrate a feature better, or have an idea for additional
content.

## License

MIT. See [LICENSE](LICENSE).
