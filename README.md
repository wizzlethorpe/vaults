# Wizzlethorpe Vaults

[![tests](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/%40wizzlethorpe%2Fvaults)](https://www.npmjs.com/package/@wizzlethorpe/vaults)
[![license](https://img.shields.io/github/license/wizzlethorpe/vaults)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/vaults?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/vaults/releases/latest)

> **🌐 Documentation and live demo: [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com)**

Self-host an Obsidian vault as a static, role-gated wiki on your own Cloudflare account. With the TTRPG add-on, the same vault also imports into Foundry VTT.

The repo holds three pieces, on one history so a `vaults vX.Y.Z` tag pins the exact behaviour of all of them:

- **[`cli/`](cli/)**: `@wizzlethorpe/vaults` (npm). The renderer + deploy CLI. Reads your vault, renders to HTML, deploys to a Cloudflare Pages project on your own account.
- **[`ttrpg/`](ttrpg/)**: `@wizzlethorpe/vaults-ttrpg` (npm). The optional add-on: statblocks, dice, battlemaps, and the `grafts.json` a reader imports into Foundry VTT. The CLI finds it when it is installed beside it, and knows nothing about TTRPGs without it.
- **[`landing/`](landing/)**: A vault that doubles as the project's landing page (deployed at vaults.wizzlethorpe.com) and a working demo of every CLI feature.

## Getting started

```bash
npm install -g @wizzlethorpe/vaults
# or, for a TTRPG vault, the CLI and its add-on together
npm install -g @wizzlethorpe/vaults @wizzlethorpe/vaults-ttrpg
vaults init my-vault && cd my-vault
vaults preview        # local preview
vaults push           # deploy to your Cloudflare account
```

Foundry, with the add-on installed: the deploy serves each reader a `grafts.json` they import with [Graft](https://foundryvtt.com/packages/graft), which builds the content into their world.

## Versioning

The CLI and the add-on share one version. The root `release.sh <X.Y.Z>` bumps both `package.json` files, tags `v<X.Y.Z>`, and publishes both to npm.

## Repo layout

```
.
├── cli/               # TypeScript CLI + Cloudflare Pages template (publishes to npm)
├── ttrpg/             # The TTRPG and Foundry add-on (publishes to npm)
├── landing/           # Demo vault, deployed at vaults.wizzlethorpe.com
├── package.json       # Workspace manifest
├── pnpm-workspace.yaml
└── release.sh         # Bump, tag, publish the CLI and the add-on at one version
```

## Support

Wizzlethorpe Vaults is a free and open-source Wizzlethorpe Labs product. If you find it useful, please consider [supporting us on Patreon](https://www.patreon.com/wizzlethorpe). Check out [wizzlethorpe.com](https://wizzlethorpe.com) for more free tools and content!

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. Short version: working on a single subproject is normal (`cd cli && pnpm typecheck && pnpm test`, etc.); cross-cutting PRs touching CLI and landing together are welcome. Contributions are governed by the [Contributor License Agreement](./CLA.md).

## License

MIT. See [LICENSE](LICENSE).
