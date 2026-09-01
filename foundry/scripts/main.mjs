// Where Foundry calls in: one graft pre-build transform for deployed vaults, the
// credential it needs, and the freshness prompt.

import { vaultsTransform } from "./transform.mjs";
import { registerTokenSetting, forgetToken, tokenFor } from "./token.mjs";
import { registerBuiltSetting, promptForUpdates, recordBuilt, indexVaults } from "./freshness.mjs";
import { addReconnectControl } from "./reconnect.mjs";

const MODULE_ID = "vaults";

Hooks.once("init", () => {
  registerTokenSetting();
  registerBuiltSetting();
  game.modules.get(MODULE_ID).api = { tokenFor, forgetToken };
});

// Registered on graft's own hook rather than at init, so this module never has
// to care whether it loaded before graft did.
Hooks.on("graftPreBuild", (_moduleId, register) => {
  register(vaultsTransform);
});

// Whoever started the build: the world-load prompt, graft's compendium header,
// or its pack control. Only graft sees them all.
Hooks.on("graftBuilt", (moduleId) => { recordBuilt(moduleId); });

// Which packs belong to a vault is read from a file, and a header control has
// to answer without waiting, so the answer is worked out once here.
Hooks.on("getHeaderControlsCompendium", addReconnectControl);

Hooks.once("ready", async () => {
  if (!game.modules.get("graft")?.active) {
    ui.notifications.warn(game.i18n.localize("VAULTS.Warn.NoGraft"));
    return;
  }
  await indexVaults();
  await promptForUpdates();
});

// Thumbnails for scenes that arrive by import. Foundry only generates one
// when a scene is created through its own UI, so imported scenes sit blank in
// the sidebar. Gated to adventures from graft-flagged modules, so this never
// touches somebody else's import.
Hooks.on("importAdventure", async (adventure, _options, created, updated) => {
  const moduleId = adventure?.pack?.split(".")[0];
  if (!game.modules.get(moduleId)?.flags?.graft?.entries) return;
  const scenes = [...(created?.Scene ?? []), ...(updated?.Scene ?? [])];
  for (const scene of scenes) {
    if (scene.thumb) continue;
    try {
      const { thumb } = await scene.createThumbnail();
      await scene.update({ thumb }, { render: false });
    } catch (err) {
      console.warn(`Vaults | could not make a thumbnail for ${scene.name}:`, err);
    }
  }
});
