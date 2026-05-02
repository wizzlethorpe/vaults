// Iframe-based /connect flow for getting a vault bearer token.
//
// The vault's /connect page renders inside a Foundry DialogV2 iframe;
// the approve page postMessages the issued token back to window.parent.
// Foundry's tab never navigates, so its session and world cookies stay
// intact regardless of the host's session-cookie policy.

import { updateVault, getVault } from "./vaults.mjs";

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

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

/**
 * Build the connect URL for a vault and persist a fresh CSRF state on
 * the vault entry. The iframe lands on /logout first, which clears any
 * existing session for this vault before bouncing to /connect; so the
 * user always sees the role chooser, even if they're connecting a vault
 * they're already signed into in another tab. Returns { src, vaultOrigin,
 * state }.
 */
export async function prepareConnect(vault) {
  if (!vault?.url) throw new Error("Vault URL is required.");
  const vaultOrigin = new URL(vault.url).origin;
  const state = crypto.randomUUID();
  await updateVault(vault.id, { pendingState: state });

  const connect = new URL("/connect", vault.url);
  connect.searchParams.set("return_to", window.location.origin + "/");
  connect.searchParams.set("app", "Foundry VTT");
  connect.searchParams.set("state", state);

  // /logout clears any existing role cookie and then redirects to `next`,
  // ensuring the user starts at the login form. The middleware's safeNext
  // accepts relative paths, so we pass the connect URL minus its origin.
  const logout = new URL("/logout", vault.url);
  logout.searchParams.set("next", connect.pathname + connect.search);

  return { src: logout.toString(), vaultOrigin, state };
}

/**
 * Listen for the vault's approve postMessage, validate state, persist
 * the token onto the matching vault entry. Returns a { promise, cancel }
 * pair; cancel() detaches the listener if the host dialog closes.
 */
export function awaitConnectMessage({ vault, vaultOrigin, state }) {
  let settled = false;
  let onMessage = null;
  let timeout = null;

  const promise = new Promise((resolve, reject) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
      resolve(value);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
      reject(err);
    };

    onMessage = async (event) => {
      const data = event.data;
      if (!data || data.type !== "vaults-connect") return;
      // Foundry sandboxes nested browsing contexts; iframes get an opaque
      // origin reported as the literal string "null". CSRF state still
      // proves the message came from the vault we just opened.
      const originOk = event.origin === vaultOrigin || event.origin === "null";
      if (!originOk) return;

      const fresh = getVault(vault.id);
      const expected = fresh?.pendingState;
      if (!expected || data.state !== expected) {
        ui.notifications.error(game.i18n.localize("VAULTS.Connect.StateMismatch"));
        fail(new Error("State mismatch"));
        return;
      }
      if (!data.token) {
        fail(new Error("No token in connect response"));
        return;
      }

      const info = tokenInfo(data.token);
      await updateVault(vault.id, {
        token: data.token,
        role: info?.role || "",
        pendingState: "",
      });

      ui.notifications.info(
        game.i18n.format("VAULTS.Connect.Success", { role: info?.role ?? "?" }),
      );
      finish(info);
    };

    timeout = setTimeout(() => fail(new Error("Connect flow timed out.")), CONNECT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timeout);
    },
  };
}

/** Clear a vault's token + role (does not delete the vault entry). */
export async function disconnect(vaultId) {
  await updateVault(vaultId, { token: "", role: "", lastManifest: {}, lastImageManifest: {} });
}
