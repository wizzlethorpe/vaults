# Wizzlethorpe Vaults

[![tests](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/vaults/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/%40wizzlethorpe%2Fvaults)](https://www.npmjs.com/package/@wizzlethorpe/vaults)
[![license](https://img.shields.io/github/license/wizzlethorpe/vaults)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/vaults?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/vaults/releases/latest)

> **🌐 Documentation and live demo: [vaults.wizzlethorpe.com](https://vaults.wizzlethorpe.com)**

Self-host an Obsidian vault as a static, role-gated wiki on your own Cloudflare account, and import the same vault into Foundry VTT.

The repo holds two pieces, on one history so a `vaults vX.Y.Z` tag pins the exact behaviour of both:

- **[`cli/`](cli/)**: `@wizzlethorpe/vaults` (npm). The renderer + deploy CLI. Reads your vault, renders to HTML, deploys to a Cloudflare Pages project on your own account.
- **[`landing/`](landing/)**: A vault that doubles as the project's landing page (deployed at vaults.wizzlethorpe.com) and a working demo of every CLI feature.

## Getting started

```bash
# CLI
npm install -g @wizzlethorpe/vaults
vaults init my-vault && cd my-vault
vaults preview        # local preview
vaults push           # deploy to your Cloudflare account
```

Foundry: the deploy serves each reader a `grafts.json` they import with [Graft](https://foundryvtt.com/packages/graft), which builds the content into their world.

## Versioning

The CLI carries the version. The root `release.sh <X.Y.Z>` bumps `cli/package.json`, tags `v<X.Y.Z>`, and publishes to npm.

## Repo layout

```
.
├── cli/               # TypeScript CLI + Cloudflare Pages template (publishes to npm)
├── landing/           # Demo vault, deployed at vaults.wizzlethorpe.com
├── package.json       # Workspace manifest
├── pnpm-workspace.yaml
└── release.sh         # Bump, tag, publish the CLI
```

## Support

Wizzlethorpe Vaults is a free and open-source Wizzlethorpe Labs product. If you find it useful, please consider [supporting us on Patreon](https://www.patreon.com/wizzlethorpe). Check out [wizzlethorpe.com](https://wizzlethorpe.com) for more free tools and content!

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide. Short version: working on a single subproject is normal (`cd cli && pnpm typecheck && pnpm test`, etc.); cross-cutting PRs touching CLI and landing together are welcome. Contributions are governed by the [Contributor License Agreement](./CLA.md).

## License

MIT. See [LICENSE](LICENSE).
