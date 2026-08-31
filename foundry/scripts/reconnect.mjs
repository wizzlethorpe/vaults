// Starting a vault over: forget the credential, the download record, and the
// hash last built, then build again.
//
// What this cannot do is delete the cached files. Core's FilePicker uploads and
// makes directories and has no remove, so forgetting the record is the whole
// mechanism: everything downloads again and overwrites what is there. Named for
// the effect rather than for a cache, since a reader who is told a cache was
// cleared would reasonably expect the disk to be emptier.

import { forgetPlaced } from "./assets.mjs";
import { forgetToken } from "./token.mjs";
import { forgetBuilt, vaultsIn } from "./freshness.mjs";
import { vaultKey } from "./provider.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** A Reconnect control on the compendium windows of a vault's own packs. */
export function addReconnectControl(app, controls) {
  if (!game.user.isGM || !Array.isArray(controls)) return;
  const moduleId = app?.collection?.metadata?.packageName;
  if (!moduleId || !vaultsIn(moduleId)) return;
  controls.push({
    icon: "fa-solid fa-arrows-rotate",
    label: "VAULTS.Reconnect.Control",
    action: "vaultsReconnect",
    onClick: () => reconnect(moduleId),
  });
}

/**
 * Forget everything remembered about a module's vaults, then offer to build.
 *
 * The credential goes too, which is the point: signing in again is how a GM
 * reads the vault at a different role, and nothing else clears it.
 */
export async function reconnect(moduleId) {
  const markers = vaultsIn(moduleId);
  if (!markers) return null;
  const module = game.modules.get(moduleId);

  const go = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("VAULTS.Reconnect.Title", { module: module?.title ?? moduleId }) },
    content: `<p>${t("VAULTS.Reconnect.Body", { module: module?.title ?? moduleId })}</p>`,
    yes: { label: t("VAULTS.Reconnect.Confirm") },
    no: { label: t("VAULTS.Reconnect.Cancel") },
  }).catch(() => false);
  if (!go) return null;

  for (const marker of markers) {
    await forgetToken(marker.vault);
    await forgetPlaced(vaultKey(marker.vault));
  }
  await forgetBuilt(moduleId);
  ui.notifications.info(t("VAULTS.Reconnect.Done", { module: module?.title ?? moduleId }));

  const build = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("VAULTS.Reconnect.Title", { module: module?.title ?? moduleId }) },
    content: `<p>${t("VAULTS.Reconnect.BuildNow")}</p>`,
    yes: { label: t("VAULTS.Setup.Build") },
    no: { label: t("VAULTS.Setup.Later") },
  }).catch(() => false);
  if (build) await game.modules.get("graft")?.api?.buildPacks(moduleId);
  return true;
}
