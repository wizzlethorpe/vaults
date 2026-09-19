// The one place core reaches for the add-on. It is still part of this package; ADDON_PACKAGE is the name it will be installed under.

import type { Addon } from "./addon.js";

export const ADDON_PACKAGE = "@wizzlethorpe/vaults-ttrpg";

let loaded: Promise<Addon | undefined> | undefined;

export function loadAddon(): Promise<Addon | undefined> {
  loaded ??= find();
  return loaded;
}

async function find(): Promise<Addon | undefined> {
  return (await import("./foundry-build.js")).foundryAddon;
}

/** Appended to a complaint about a setting the CLI does not know, which the missing add-on may own. */
export function installHint(addon: Addon | undefined): string {
  return addon ? "" : ` If it belongs to ${ADDON_PACKAGE}, install that beside the CLI.`;
}
