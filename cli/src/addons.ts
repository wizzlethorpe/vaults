// The one place core reaches for the add-on: a package installed beside the CLI, found by name.

import type { Addon } from "./addon.js";
import { CLI_VERSION } from "./version.js";

export const ADDON_PACKAGE = "@wizzlethorpe/vaults-ttrpg";

let loaded: Promise<Addon | undefined> | undefined;

export function loadAddon(): Promise<Addon | undefined> {
  loaded ??= find();
  return loaded;
}

async function find(): Promise<Addon | undefined> {
  if (process.env["VAULTS_NO_ADDON"] === "1") return undefined;
  let addon: Addon;
  try {
    addon = ((await import(ADDON_PACKAGE)) as { default: Addon }).default;
  } catch (err) {
    if (isAbsent(err)) return undefined;
    throw err;
  }
  const mismatch = versionMismatch(CLI_VERSION, addon.version);
  if (mismatch) throw new Error(mismatch);
  return addon;
}

/** Whether an import failed because the add-on itself is not installed. One of its own imports failing names another package, and must not read as "not installed". */
export function isAbsent(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException;
  return e?.code === "ERR_MODULE_NOT_FOUND" && e.message.includes(`Cannot find package '${ADDON_PACKAGE}'`);
}

/** The two release together and the contract between them is not versioned, so anything but the same version is refused. */
export function versionMismatch(cli: string, addon: string): string | undefined {
  if (cli === addon) return undefined;
  return `${ADDON_PACKAGE} is ${addon} and the CLI is ${cli}. They release together and have to match: `
    + `npm install -g @wizzlethorpe/vaults@latest ${ADDON_PACKAGE}@latest`;
}

/** Appended to a complaint about a setting the CLI does not know, which the missing add-on may own. */
export function installHint(addon: Addon | undefined): string {
  return addon ? "" : ` If it belongs to ${ADDON_PACKAGE}, install that beside the CLI.`;
}
