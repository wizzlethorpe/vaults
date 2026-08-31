// "Build your vault" and "your vault has new content", on world load.
//
// The vault writes a content hash beside its entry list; this compares that
// hash against the one recorded at the last build and offers to rebuild when
// they differ. Declining records the hash too, so the same push asks once.

import { url as vaultUrl } from "./api.mjs";
import { tokenFor } from "./token.mjs";

const MODULE_ID = "vaults";
export const BUILT = "builtHashes";

export function registerBuiltSetting() {
  game.settings.register(MODULE_ID, BUILT, {
    name: "Built content hashes",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
}

/** The deploy's current content hash, or null when it cannot be read. */
async function fetchHash(vault) {
  try {
    const res = await fetch(vaultUrl(vault, "/_foundry/version.json"));
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

/** Whether the deploy moved past what this world last handled. */
function shouldPrompt(fetched, recorded) {
  return !!fetched && fetched !== recorded;
}

/**
 * Which dialog a module needs, or null for none.
 *
 * `setup` is its own answer because a gated vault reports no hash until the GM
 * connects, and connecting only happens inside a build.
 */
export function promptKind({ setup, fetched, recorded }) {
  if (setup) return "Setup";
  return shouldPrompt(fetched, recorded) ? "Fresh" : null;
}

async function record(moduleId, hash) {
  const all = { ...game.settings.get(MODULE_ID, BUILT) };
  all[moduleId] = hash;
  await game.settings.set(MODULE_ID, BUILT, all);
}

/** The vault markers in a module's own grafts.json, if any. */
function markersOf(entries) {
  return entries.filter((e) => typeof e?.vault === "string" && e.vault && !e.id);
}

/** The first hash any marker will answer with, or null when none will. */
async function fetchVaultHash(markers) {
  for (const marker of markers) {
    const token = marker.gated ? tokenFor(marker.vault) : null;
    if (marker.gated && !token) continue;
    const hash = await fetchHash({ url: marker.vault, token, gated: !!marker.gated });
    if (hash) return hash;
  }
  return null;
}

export async function promptForUpdates() {
  if (!game.user.isGM) return;
  const graft = game.modules.get("graft")?.api;
  if (!graft) return;
  const recorded = game.settings.get(MODULE_ID, BUILT);

  for (const module of game.modules) {
    if (!module.active || !module.flags?.graft?.entries) continue;
    let markers;
    try { markers = markersOf(await graft.readGrafts(module.id)); }
    catch { continue; }
    // Without this a graft module that is not a vault would take the setup
    // prompt below on the strength of its empty packs alone.
    if (markers.length === 0) continue;

    // A build attempt settles setup even when it fills nothing: a vault that
    // renders no entries would otherwise be asked about on every load forever.
    const attempted = Object.hasOwn(recorded, module.id);
    const setup = !attempted && !(await graft.anyBuilt(module.id));
    const fetched = setup ? null : await fetchVaultHash(markers);
    const kind = promptKind({ setup, fetched, recorded: recorded[module.id] });
    if (!kind) continue;

    const build = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.format(`VAULTS.${kind}.Title`, { module: module.title }) },
      content: `<p>${game.i18n.format(`VAULTS.${kind}.Body`, { module: module.title })}</p>`,
      yes: { label: game.i18n.localize(`VAULTS.${kind}.Build`) },
      no: { label: game.i18n.localize(`VAULTS.${kind}.Later`) },
      modal: false,
    }).catch(() => false);

    if (build) await graft.buildPacks(module.id);
    // Re-read after a build: the token it obtained may make the hash readable
    // for the first time, and a push can land while a long one runs.
    if (build) await record(module.id, await fetchVaultHash(markers));
    // Declining an update means "not this push", so it records. Declining
    // setup records nothing, or the offer would never come back.
    else if (!setup) await record(module.id, fetched);
  }
}

export const __test = { shouldPrompt, promptKind, markersOf, fetchHash, fetchVaultHash };
