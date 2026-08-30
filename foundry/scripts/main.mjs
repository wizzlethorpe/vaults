// Where Foundry calls in.
//
// This module used to be a sync engine: it fetched a manifest, diffed it,
// pulled page bodies, rewrote links, downloaded images and wrote compendium
// packs, and it held all of that itself. None of that lives here now. The CLI
// compiles a vault into a graft entry list at build time and graft builds it,
// so what is left is one provider that knows how to read a deployed vault, and
// the credential it needs to do so.

import { vaultsProvider } from "./provider.mjs";
import { registerTokenSetting, forgetToken, tokenFor } from "./token.mjs";
import { registerBuiltSetting, promptForUpdates } from "./freshness.mjs";

const MODULE_ID = "vaults";

Hooks.once("init", () => {
  registerTokenSetting();
  registerBuiltSetting();
  game.modules.get(MODULE_ID).api = { tokenFor, forgetToken };
});

// Registered on graft's own hook rather than at init, so this module never has
// to care whether it loaded before graft did.
Hooks.on("graftRegisterProviders", ({ registerProvider }) => {
  registerProvider(vaultsProvider());
});

Hooks.once("ready", async () => {
  if (!game.modules.get("graft")?.active) {
    ui.notifications.warn(game.i18n.localize("VAULTS.Warn.NoGraft"));
    return;
  }
  await promptForUpdates();
});
