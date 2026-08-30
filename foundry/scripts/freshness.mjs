// "Your vault has new content" on world load.
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
export function shouldPrompt(fetched, recorded) {
  return !!fetched && fetched !== recorded;
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
    // One vault per module today; the hash recorded is the first that answers.
    let fetched = null;
    for (const marker of markers) {
      const token = marker.gated ? tokenFor(marker.vault) : null;
      if (marker.gated && !token) continue;
      fetched = await fetchHash({ url: marker.vault, token, gated: !!marker.gated });
      if (fetched) break;
    }
    if (!shouldPrompt(fetched, recorded[module.id])) continue;
    // graft's own prompt covers a module never built; record the hash so
    // the load after that build does not ask again for the same push.
    if ((await graft.unbuilt(module.id).catch(() => [])).length > 0) {
      await record(module.id, fetched);
      continue;
    }

    const build = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.format("VAULTS.Fresh.Title", { module: module.title }) },
      content: `<p>${game.i18n.format("VAULTS.Fresh.Body", { module: module.title })}</p>`,
      yes: { label: game.i18n.localize("VAULTS.Fresh.Build") },
      no: { label: game.i18n.localize("VAULTS.Fresh.Later") },
      modal: false,
    }).catch(() => false);

    if (build) await graft.buildPacks(module.id);
    // Recorded either way: a decline means "not this push", not "ask again on
    // every load until I give in".
    await record(module.id, fetched);
  }
}

export const __test = { shouldPrompt, markersOf, fetchHash };
