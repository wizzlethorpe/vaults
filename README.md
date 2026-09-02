# Wizzlethorpe Vaults

[![tests](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/%40wizzlethorpe%2Fvaults)](https://www.npmjs.com/package/@wizzlethorpe/vaults)
[![license](https://img.shields.io/github/license/wizzlethorpe/vaults)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/vaults?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/vaults/releases/latest)

> **🌐 Documentation and live demo: [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com)**

Self-host an Obsidian vault as a static, role-gated wiki on your own Cloudflare account, with optional sync into Foundry VTT.

This is the monorepo for three intertwined pieces. They release in lockstep so a "vaults vX.Y.Z" tag pins the exact behavior across all three:

- **[`cli/`](cli/)**: `@wizzlethorpe/vaults` (npm). The renderer + deploy CLI. Reads your vault, renders to HTML, deploys to a Cloudflare Pages project on your own account.
- **[`foundry/`](foundry/)**: Wizzlethorpe Vaults Foundry VTT module. Pulls a deployed vault into a Foundry world as journal entries, with optional Actor / Item / Scene / RollTable / etc. creation from a per-page `foundry:` block.
- **[`landing/`](landing/)**: A vault that doubles as the project's landing page (deployed at vaults.wizzlethorpe.com) and a working demo of every CLI feature.

## Getting started

```bash
# CLI
npm install -g @wizzlethorpe/vaults
vaults init my-vault && cd my-vault
vaults preview        # local preview
vaults push           # deploy to your Cloudflare account
```

Foundry module: install via the Foundry package directory (search "Wizzlethorpe Vaults") or use the manifest URL `https://github.com/wizzlethorpe/vaults/releases/latest/download/module.json`.

## Versioning

A single shared version applies across all three subprojects. The root `release.sh <X.Y.Z>` bumps `cli/package.json`, `foundry/module.json`, tags `v<X.Y.Z>`, and runs each subproject's release pipeline (npm publish, Foundry GitHub release + CDN upload, landing deploy).

## Repo layout

```
.
├── cli/               # TypeScript CLI + Cloudflare Pages template (publishes to npm)
├── foundry/           # Foundry VTT module (publishes to Foundry package directory + CDN)
├── landing/           # Demo vault, deployed at vaults.wizzlethorpe.com
├── package.json       # Workspace manifest (cli + foundry)
├── pnpm-workspace.yaml
└── release.sh         # Single-command unified release
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. Short version: working on a single subproject is normal (`cd cli && pnpm typecheck && pnpm test`, etc.); cross-cutting PRs touching CLI + Foundry + landing together are welcome. Contributions are governed by the [Contributor License Agreement](./CLA.md).

## License

MIT. See [LICENSE](LICENSE).
