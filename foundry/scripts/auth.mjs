// Iframe-based /connect flow for getting a vault bearer token.
//
// We host the vault's /connect endpoint in an iframe inside a Foundry
// dialog. The vault's approve page postMessages the issued token back
// to window.parent (us) on the vault origin. Foundry's tab never
// navigates away — so its SPA session and world cookies stay intact.

import { SETTINGS, get, set } from "./settings.mjs";

// Long enough for the user to sign in to the vault first.
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Decode a token's role + expiry without verifying — used purely for UI
 * (showing "connected as patron"). The vault re-validates every request.
 */
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
 * Build the /connect URL for a given vault, including a fresh CSRF state
 * persisted to settings. Returns { src, vaultOrigin, state }.
 */
export async function prepareConnect(vaultUrl) {
  if (!vaultUrl) throw new Error("Vault URL is required.");
  const vaultOrigin = new URL(vaultUrl).origin;
  const state = crypto.randomUUID();
  await set(SETTINGS.pendingState, state);

  const target = new URL("/connect", vaultUrl);
  target.searchParams.set("return_to", window.location.origin + "/");
  target.searchParams.set("app", "Foundry VTT");
  target.searchParams.set("state", state);

  return { src: target.toString(), vaultOrigin, state };
}

/**
 * Listen for the vault's approve postMessage, validate state, persist
 * the token. Returns a { promise, cancel } pair — cancel() detaches the
 * listener (call it when the host dialog closes without approval).
 */
export function awaitConnectMessage({ vaultOrigin, state }) {
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
      // Normally event.origin is the vault's origin. Foundry's runtime
      // applies `sandbox` to nested browsing contexts via its CSP, which
      // gives the iframe an opaque origin reported here as the literal
      // string "null". In that case we fall back to validating the
      // message via the CSRF state — a UUID we just generated and only
      // sent to the vault, so an attacker can't guess it.
      const originOk = event.origin === vaultOrigin || event.origin === "null";
      if (!originOk) return;

      const expected = get(SETTINGS.pendingState);
      if (!expected || data.state !== expected) {
        ui.notifications.error(game.i18n.localize("VAULTS.Connect.StateMismatch"));
        fail(new Error("State mismatch"));
        return;
      }
      if (!data.token) {
        fail(new Error("No token in connect response"));
        return;
      }

      await set(SETTINGS.token, data.token);
      await set(SETTINGS.pendingState, "");
      const info = tokenInfo(data.token);
      if (info?.role) await set(SETTINGS.role, info.role);

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

/** Clear the saved token + role. */
export async function disconnect() {
  await set(SETTINGS.token, "");
  await set(SETTINGS.role, "");
  await set(SETTINGS.lastManifest, {});
}
