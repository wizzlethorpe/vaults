// Bearer tokens for gated vaults, one per origin.
//
// Keyed by origin rather than by vault because that is what the token is scoped
// to: two vaults on one domain share it, and moving a vault to a new domain
// should not silently reuse the old one. The token is a credential, so it lives
// in a GM-only world setting and is never written into a document.

const MODULE_ID = "vaults";
export const TOKENS = "tokens";

export function registerTokenSetting() {
  game.settings.register(MODULE_ID, TOKENS, {
    name: "Vault tokens",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
}

const originOf = (vaultUrl) => {
  try { return new URL(vaultUrl).origin; } catch { return null; }
};

export function tokenFor(vaultUrl) {
  const origin = originOf(vaultUrl);
  return origin ? (game.settings.get(MODULE_ID, TOKENS)[origin] ?? null) : null;
}

export async function storeToken(vaultUrl, token) {
  const origin = originOf(vaultUrl);
  if (!origin) return;
  const all = { ...game.settings.get(MODULE_ID, TOKENS) };
  if (token) all[origin] = token;
  else delete all[origin];
  await game.settings.set(MODULE_ID, TOKENS, all);
}

export async function forgetToken(vaultUrl) {
  await storeToken(vaultUrl, null);
}

/**
 * Ask the GM to connect, and remember the result.
 *
 * The paste flow, the same shape as a device login: open the vault in a
 * browser, sign in there, copy the token back. Foundry cannot receive a
 * redirect, and a password typed into a module dialog would be a password this
 * module has held.
 */
export async function promptForToken(vaultUrl) {
  if (!game.user.isGM) return null;

  const connect = new URL("/connect", vaultUrl);
  connect.searchParams.set("app", "Foundry VTT");
  connect.searchParams.set("delivery", "copy");

  const content = `
    <p>${game.i18n.localize("VAULTS.Connect.Intro")}</p>
    <ol class="vaults-connect">
      <li>
        <a href="${connect.toString()}" target="_blank" rel="noopener noreferrer">
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
          ${game.i18n.localize("VAULTS.Connect.Open")}
        </a>
      </li>
      <li>${game.i18n.localize("VAULTS.Connect.SignIn")}</li>
      <li>
        <textarea name="token" rows="4" style="width:100%"
          placeholder="${game.i18n.localize("VAULTS.Connect.Placeholder")}"></textarea>
      </li>
    </ol>`;

  const token = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.format("VAULTS.Connect.Title", { vault: originOf(vaultUrl) ?? vaultUrl }) },
    content,
    ok: {
      label: game.i18n.localize("VAULTS.Connect.Save"),
      callback: (_event, button) => button.form.elements.token.value.trim(),
    },
    rejectClose: false,
  });

  if (!token) return null;
  await storeToken(vaultUrl, token);
  return token;
}
