// Token utilities for the paste-flow connect dialog.
//
// The Foundry module no longer authenticates via an iframe + postMessage.
// Instead, the user clicks "Open vault sign-in page", authenticates in a
// regular browser tab (password OR Patreon — no iframe constraints), and
// pastes the resulting bearer token back. Same GitHub-CLI / device-flow
// pattern, robust to cookie partitioning and provider X-Frame-Options.
//
// What used to live here: prepareConnect (iframe URL + CSRF state) and
// awaitConnectMessage (postMessage listener). Both are gone — see git
// history if you need them.

import { updateVault } from "./vaults.mjs";
import { setVaultManifest } from "./vault-manifests.mjs";

/** Decode a token's role + expiry without verifying; purely for UI. */
export function tokenInfo(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const exp = Number(parts[1]);
  return {
    role: parts[0],
    expiresAt: Number.isFinite(exp) ? new Date(exp * 1000) : null,
  };
}

/** Clear a vault's token + role (does not delete the vault entry). The
 *  separate per-vault sync state is also cleared so the next sync starts
 *  fresh under the (now-cleared) auth. */
export async function disconnect(vaultId) {
  await updateVault(vaultId, { token: "", role: "" });
  await setVaultManifest(vaultId, { lastManifest: {}, lastImageManifest: {} });
}
