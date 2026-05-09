// Single source of truth for the CLI's runtime-visible version.
//
// Read once at module load from package.json so a release-time bump
// propagates to:
//   - `vaults --version`
//   - the manifest's `cli_version` field (so synced clients can warn on
//     skew between the CLI that built the deploy and the client reading it)
//   - any future place that needs to identify the CLI's own version
//
// The manifest also carries `manifest_version` (incremented on breaking
// shape changes) and `id_scheme` (for entry-id derivation), declared here
// because they're protocol-level constants that travel with the CLI.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Package.json sits next to dist/ at runtime, and next to src/ in dev.
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };

export const CLI_VERSION: string = pkg.version;

/**
 * Manifest schema/protocol version. Increment on breaking shape changes
 * (renamed top-level fields, removed fields, semantic shifts). Additive
 * changes don't bump it — clients should ignore unknown fields.
 */
export const MANIFEST_VERSION = 1 as const;

/**
 * Document-id derivation scheme, advertised in the manifest so a future
 * algorithm change (e.g. SHA-1 → SHA-256, longer slice) can be detected
 * by clients holding entries derived under an older scheme.
 *
 *   "v1": SHA-1 of `vaults:<kind>:<vaultId>:<path>`, first 16 hex chars.
 *         Folder-keyed for entry IDs (one JournalEntry per folder).
 */
export const ID_SCHEME = "v1" as const;
