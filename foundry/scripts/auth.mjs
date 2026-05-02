// Browser-redirect /connect flow for getting a vault bearer token.
//
// Foundry has no place to register a localhost callback, but it doesn't need
// one — the user is already on Foundry's domain. We send them to the vault's
// /connect, the vault signs a token, and redirects them back to the same
// Foundry URL with `?token=...&state=...` in the query. This module's
// page-load hook reads those params, validates state, saves the token.

import { MODULE_ID, SETTINGS, get, set } from "./settings.mjs";

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
 * Redirect the browser to the vault's /connect endpoint. After approval,
 * the vault redirects back here with ?token=...&state=... — handleCallback()
 * picks them up.
 */
export async function startConnect(vaultUrl) {
  if (!vaultUrl) throw new Error("Vault URL is required.");
  const state = crypto.randomUUID();
  await set(SETTINGS.pendingState, state);

  // Where to come back. Strip any pre-existing token/state from the URL so
  // we don't loop into a stale state on the round-trip.
  const here = new URL(window.location.href);
  here.searchParams.delete("token");
  here.searchParams.delete("state");
  const returnTo = here.toString();

  const target = new URL("/connect", vaultUrl);
  target.searchParams.set("return_to", returnTo);
  target.searchParams.set("app", "Foundry VTT");
  target.searchParams.set("state", state);

  window.location.href = target.toString();
}

/**
 * Run on every Foundry page load. If the URL has token + state, validate
 * the state, persist the token, clean up the URL.
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const state = params.get("state");
  if (!token || !state) return;

  const expected = get(SETTINGS.pendingState);
  if (!expected || state !== expected) {
    ui.notifications.error(game.i18n.localize("VAULTS.Connect.StateMismatch"));
    cleanUrl();
    return;
  }

  await set(SETTINGS.token, token);
  await set(SETTINGS.pendingState, "");
  const info = tokenInfo(token);
  if (info?.role) await set(SETTINGS.role, info.role);

  ui.notifications.info(
    game.i18n.format("VAULTS.Connect.Success", { role: info?.role ?? "?" }),
  );
  cleanUrl();
}

function cleanUrl() {
  const u = new URL(window.location.href);
  u.searchParams.delete("token");
  u.searchParams.delete("state");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
}

/** Clear the saved token + role. */
export async function disconnect() {
  await set(SETTINGS.token, "");
  await set(SETTINGS.role, "");
  await set(SETTINGS.lastManifest, {});
}
