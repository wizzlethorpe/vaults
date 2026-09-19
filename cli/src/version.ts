// The CLI's own version, read once from package.json so a release-time bump reaches `vaults --version` and the add-on version check.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Package.json sits next to dist/ at runtime, and next to src/ in dev.
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };

export const CLI_VERSION: string = pkg.version;
