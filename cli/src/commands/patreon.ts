import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig } from "../config.js";
import { runMigrations } from "../migrate/run.js";
import { htmlEscape } from "../escape.js";

// Fixed port for the one-shot CLI OAuth dance. Reuses `vaults preview`'s
// default port (4173) so a single registered redirect URI covers both
// `vaults patreon configure` (this command) AND any visitor-login testing
// the user does during local preview. Mutually exclusive with a running
// `vaults preview` since both bind the port; that's fine in practice
// (you configure before previewing).
const OAUTH_PORT = 4173;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_PORT}/auth/patreon/callback`;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes is plenty for the user to click Approve

/**
 * `vaults patreon configure` — prompts for Patreon OAuth app credentials and
 * the campaign ID, stores them on `.vaultrc.json`. The client secret rides
 * here too so subsequent `vaults push` can re-upload it as the
 * `PATREON_CLIENT_SECRET` Wrangler secret (mirrors how sessionSecret works).
 *
 * Each creator must register their own Patreon OAuth client at
 * patreon.com/portal/registration; we can't ship a shared one because
 * the redirect URI must be pre-registered per app and Patreon rate-limits
 * + bills per app.
 */
export async function patreonConfigure(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  const existing = cfg.oauth?.patreon;

  if (!stdin.isTTY) {
    throw new Error("vaults patreon configure must be run interactively (need to prompt for client_id/secret).");
  }

  console.log("Patreon OAuth setup");
  console.log("=".repeat(50));
  console.log("");
  if (!existing) {
    console.log("Each Wizzlethorpe Vaults deploy needs its own Patreon OAuth app.");
    console.log("Register one at: https://www.patreon.com/portal/registration");
    console.log("");
    console.log("When prompted for redirect URIs, register both:");
    console.log("  1. Your deploy URL + /auth/patreon/callback");
    console.log("     e.g.  https://your-vault.pages.dev/auth/patreon/callback");
    console.log("           https://your-custom-domain.com/auth/patreon/callback");
    console.log(`  2. ${OAUTH_REDIRECT_URI}`);
    console.log("     (covers this CLI's one-shot setup AND `vaults preview` testing)");
    console.log("");
  } else {
    console.log("Updating existing Patreon configuration. Press Enter to keep current values.");
    console.log("");
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const clientId = (await rl.question(
      `Patreon client ID${existing ? ` [${maskMid(existing.clientId)}]` : ""}: `,
    )).trim() || existing?.clientId || "";
    if (!clientId) throw new Error("Client ID is required.");

    const clientSecret = (await rl.question(
      `Patreon client secret${existing ? " [keep existing]" : ""}: `,
    )).trim() || existing?.clientSecret || "";
    if (!clientSecret) throw new Error("Client secret is required.");

    // Auto-detect path: open a browser to Patreon, exchange the resulting
    // code for a one-shot creator token, fetch /v2/campaigns + tiers,
    // discard the token. The default is yes — finding the campaign ID by
    // hand is real friction.
    const wantsAutoAns = (await rl.question(
      `Auto-detect your campaign + tier list via Patreon OAuth? [Y/n] `,
    )).trim().toLowerCase();
    const wantsAuto = wantsAutoAns !== "n" && wantsAutoAns !== "no";

    let campaignId = "";
    let detectedTiers: Tier[] = [];
    if (wantsAuto) {
      console.log("");
      const detected = await oauthFetchCampaignAndTiers(clientId, clientSecret, rl);
      campaignId = detected.campaignId;
      detectedTiers = detected.tiers;
      console.log("");
      console.log(`Detected campaign: ${campaignId}`);
      if (detectedTiers.length > 0) {
        console.log(`Detected tiers (${detectedTiers.length}):`);
        for (const t of detectedTiers) {
          console.log(`  ${t.id}  ${formatAmount(t.amountCents).padStart(8)}  ${t.title}`);
        }
      } else {
        console.log("No published tiers found on this campaign.");
      }
    } else {
      campaignId = (await rl.question(
        `Patreon campaign ID${existing ? ` [${existing.campaignId}]` : ""}: `,
      )).trim() || existing?.campaignId || "";
      if (!campaignId) throw new Error("Campaign ID is required.");
    }

    // Walk non-default roles and prompt for tier mapping. If we have the
    // tier list (from auto-detect), show a numbered menu. Otherwise prompt
    // for the bare ID. Either way, an existing mapping is the default
    // and "skip" leaves the role password-only.
    const protectedRoles = cfg.roles.slice(1);
    const newTiers: Record<string, string> = { ...(existing?.tiers ?? {}) };
    if (protectedRoles.length > 0) {
      console.log("");
      console.log("Map roles to Patreon tiers. Press Enter to skip a role (password-only).");
      for (const role of protectedRoles) {
        const current = newTiers[role];
        if (detectedTiers.length > 0) {
          console.log("");
          console.log(`  Role: ${role}${current ? `  (currently → tier ${current})` : ""}`);
          for (let i = 0; i < detectedTiers.length; i++) {
            const t = detectedTiers[i]!;
            console.log(`    ${i + 1}. ${t.title} (${formatAmount(t.amountCents)}, id ${t.id})`);
          }
          console.log(`    0. None — keep ${role} password-only`);
          const ans = (await rl.question(`  Pick [0-${detectedTiers.length}]${current ? ` (Enter = keep)` : ""}: `)).trim();
          if (ans === "" && current) continue; // keep existing
          if (ans === "" || ans === "0") { delete newTiers[role]; continue; }
          const idx = parseInt(ans, 10);
          if (isNaN(idx) || idx < 1 || idx > detectedTiers.length) {
            console.log(`    (skipped — '${ans}' is not a number in range)`);
            continue;
          }
          newTiers[role] = detectedTiers[idx - 1]!.id;
        } else {
          const ans = (await rl.question(
            `  Tier ID for '${role}'${current ? ` [${current}]` : " (Enter to skip)"}: `,
          )).trim() || current || "";
          if (!ans) { delete newTiers[role]; continue; }
          if (!/^[0-9]+$/.test(ans)) {
            console.log(`    (skipped — tier IDs are numeric)`);
            continue;
          }
          newTiers[role] = ans;
        }
      }
    }

    cfg.oauth = {
      ...(cfg.oauth ?? {}),
      patreon: {
        clientId,
        clientSecret,
        campaignId,
        ...(Object.keys(newTiers).length > 0 ? { tiers: newTiers } : {}),
      },
    };
    await saveConfig(vaultPath, cfg);
    console.log("");
    console.log("Saved Patreon configuration.");
    if (Object.keys(newTiers).length > 0) {
      console.log("Tier mappings:");
      for (const [role, tier] of Object.entries(newTiers)) {
        console.log(`  ${role.padEnd(16)} → tier ${tier}`);
      }
    } else {
      console.log("No tier mappings yet — run `vaults patreon link <role> <tier-id>` to add some.");
    }
    console.log("Run `vaults push` to upload the client secret to Cloudflare.");
  } finally {
    rl.close();
  }
}

interface Tier { id: string; title: string; amountCents: number; }

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}/mo`;
}

/**
 * One-shot OAuth dance to fetch the creator's campaign + tier list.
 * Spins up a local HTTP server on OAUTH_PORT (must be pre-registered as a
 * redirect URI on the Patreon app), opens the user's browser to the
 * authorize URL, awaits the callback, exchanges the code for an access
 * token, fetches /v2/campaigns + /v2/campaigns/{id}?include=tiers, then
 * discards the token. The user's only persistent state is the campaign
 * ID + tier list saved in `.vaultrc.json`.
 */
async function oauthFetchCampaignAndTiers(
  clientId: string,
  clientSecret: string,
  rl: ReturnType<typeof createInterface>,
): Promise<{ campaignId: string; tiers: Tier[] }> {
  const state = cryptoRandomState();
  const authorize = new URL("https://www.patreon.com/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  authorize.searchParams.set("scope", "campaigns identity");
  authorize.searchParams.set("state", state);

  const codePromise = listenForCallback(state);

  console.log("Opening browser to Patreon for authorisation…");
  console.log("If the browser doesn't open, paste this URL:");
  console.log(`  ${authorize.toString()}`);
  console.log("");
  tryOpenBrowser(authorize.toString());

  const code = await codePromise;

  // Exchange code → access token
  const tokenRes = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: OAUTH_REDIRECT_URI,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text().catch(() => "");
    throw new Error(`Patreon token exchange failed (${tokenRes.status}): ${txt.slice(0, 200)}`);
  }
  const tokenData = await tokenRes.json() as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("Patreon token response had no access_token.");

  // List campaigns owned by the creator (v2 requires explicit fields).
  const campaignsRes = await fetch(
    "https://www.patreon.com/api/oauth2/v2/campaigns?fields%5Bcampaign%5D=creation_name,vanity,patron_count",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!campaignsRes.ok) {
    throw new Error(`/v2/campaigns failed (${campaignsRes.status}). Make sure the OAuth client has the 'campaigns' scope.`);
  }
  type Campaign = { type: string; id: string; attributes: { creation_name?: string; vanity?: string; patron_count?: number } };
  const campaignsBody = await campaignsRes.json() as { data?: Campaign[] };
  const campaigns = campaignsBody.data ?? [];
  if (campaigns.length === 0) {
    throw new Error("No campaigns found on this Patreon account. Are you signed in as the creator?");
  }

  let chosen: Campaign;
  if (campaigns.length === 1) {
    chosen = campaigns[0]!;
  } else {
    console.log("");
    console.log("This account owns multiple campaigns. Pick one:");
    campaigns.forEach((c, i) => {
      const label = c.attributes.creation_name || c.attributes.vanity || `campaign ${c.id}`;
      console.log(`  ${i + 1}. ${label}  (id ${c.id}, ${c.attributes.patron_count ?? "?"} patrons)`);
    });
    while (true) {
      const ans = (await rl.question(`Pick [1-${campaigns.length}]: `)).trim();
      const idx = parseInt(ans, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= campaigns.length) {
        chosen = campaigns[idx - 1]!;
        break;
      }
    }
  }

  // Fetch tier list for the chosen campaign.
  const tiersUrl = `https://www.patreon.com/api/oauth2/v2/campaigns/${chosen.id}`
    + `?include=tiers&fields%5Btier%5D=title,amount_cents,published`;
  const tiersRes = await fetch(tiersUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!tiersRes.ok) {
    throw new Error(`/v2/campaigns/${chosen.id} failed (${tiersRes.status}).`);
  }
  type Included = { type: string; id: string; attributes: { title?: string; amount_cents?: number; published?: boolean } };
  const tiersBody = await tiersRes.json() as { included?: Included[] };
  const tiers: Tier[] = (tiersBody.included ?? [])
    // Only show currently-published tiers; unpublished ones can't gate access.
    .filter((it) => it.type === "tier" && it.attributes?.published !== false)
    .map((it) => ({
      id: it.id,
      title: it.attributes.title ?? "(untitled)",
      amountCents: it.attributes.amount_cents ?? 0,
    }))
    // Sort ascending by amount so the menu reads low → high.
    .sort((a, b) => a.amountCents - b.amountCents);

  return { campaignId: chosen.id, tiers };
}

function listenForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${OAUTH_PORT}`);
      // Patreon redirects to the path we registered; ignore everything else
      // (favicon probes, etc.) so a confused request doesn't tear down the
      // OAuth dance mid-flight.
      if (url.pathname !== "/auth/patreon/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family: system-ui; padding: 2rem;"><h2>Patreon authorisation failed</h2><p>${htmlEscape(err)}</p></body></html>`);
        server.close();
        clearTimeout(timer);
        reject(new Error(`Patreon returned error: ${err}`));
        return;
      }
      if (!code || state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family: system-ui; padding: 2rem;"><h2>Bad callback</h2><p>Missing code or state mismatch.</p></body></html>`);
        server.close();
        clearTimeout(timer);
        reject(new Error("Missing code or state mismatch."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font-family: system-ui; padding: 2rem; text-align: center;"><h2>✓ Authorised</h2><p>You can close this window and return to the CLI.</p></body></html>`);
      server.close();
      clearTimeout(timer);
      resolve(code);
    });
    server.on("error", (e) => {
      reject(new Error(`Couldn't bind localhost:${OAUTH_PORT} (${(e as Error).message}). Another process may be using it.`));
    });
    server.listen(OAUTH_PORT, "127.0.0.1");

    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Patreon OAuth timed out after ${OAUTH_TIMEOUT_MS / 60_000} minutes.`));
    }, OAUTH_TIMEOUT_MS);
  });
}

function tryOpenBrowser(url: string): void {
  // Best-effort. WSL falls back to wslview/xdg-open if installed; pure
  // headless boxes silently no-op and the user copy-pastes the URL.
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const proc = spawn(cmd, args, { detached: true, stdio: "ignore" });
    proc.unref();
    proc.on("error", () => {/* swallow */});
  } catch { /* swallow */ }
}

function cryptoRandomState(): string {
  // 16 random bytes → 32 hex chars; collision-resistant enough for a
  // one-shot CSRF nonce that lives for at most 5 minutes.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function patreonLink(role: string, tierId: string, vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.oauth?.patreon) {
    throw new Error("Patreon is not configured yet. Run `vaults patreon configure` first.");
  }
  if (!cfg.roles.includes(role)) {
    throw new Error(`Role '${role}' does not exist (have: ${cfg.roles.join(", ")}).`);
  }
  if (cfg.roles[0] === role) {
    throw new Error(`'${role}' is the default role; it doesn't gate access, so a tier mapping has no effect.`);
  }
  if (!/^[0-9]+$/.test(tierId.trim())) {
    throw new Error(`Tier ID looks wrong: '${tierId}'. Patreon tier IDs are numeric.`);
  }

  cfg.oauth.patreon.tiers = { ...(cfg.oauth.patreon.tiers ?? {}), [role]: tierId.trim() };
  await saveConfig(vaultPath, cfg);
  console.log(`Linked role '${role}' → Patreon tier ${tierId.trim()}.`);
  console.log(`  Patrons whose pledge grants this tier can now sign in to '${role}'`);
  console.log(`  via the Sign in with Patreon button (alongside the existing password).`);
}

export async function patreonUnlink(role: string, vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.oauth?.patreon?.tiers || !(role in cfg.oauth.patreon.tiers)) {
    throw new Error(`Role '${role}' has no Patreon tier mapping.`);
  }
  delete cfg.oauth.patreon.tiers[role];
  if (Object.keys(cfg.oauth.patreon.tiers).length === 0) delete cfg.oauth.patreon.tiers;
  await saveConfig(vaultPath, cfg);
  console.log(`Unlinked role '${role}' from its Patreon tier. Password access still works.`);
}

export async function patreonClear(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.oauth?.patreon) {
    console.log("No Patreon configuration to clear.");
    return;
  }
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const ans = (await rl.question(
        "Remove the Patreon block (clientId, clientSecret, campaignId, all tier mappings)? [y/N] ",
      )).trim().toLowerCase();
      if (ans !== "y" && ans !== "yes") { console.log("Cancelled."); return; }
    } finally { rl.close(); }
  }
  delete cfg.oauth.patreon;
  // Drop the empty oauth block so saveConfig doesn't persist an empty object.
  if (cfg.oauth && Object.keys(cfg.oauth).length === 0) delete cfg.oauth;
  await saveConfig(vaultPath, cfg);
  console.log("Removed Patreon configuration. Run `vaults push --rotate-secret` if you also want");
  console.log("to invalidate any sessions that were issued via the Patreon path.");
}

export async function patreonStatus(vaultPath: string): Promise<void> {
  await runMigrations(vaultPath);
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.oauth?.patreon) {
    console.log("Patreon: not configured. Run `vaults patreon configure` to enable.");
    return;
  }
  const { clientId, campaignId, tiers } = cfg.oauth.patreon;
  console.log(`Patreon: configured`);
  console.log(`  client ID:    ${maskMid(clientId)}`);
  console.log(`  campaign ID:  ${campaignId}`);
  console.log(`  tier mappings:`);
  if (!tiers || Object.keys(tiers).length === 0) {
    console.log(`    (none) — Sign in with Patreon won't be offered.`);
    return;
  }
  for (const role of cfg.roles) {
    const tier = tiers[role];
    if (tier) console.log(`    ${role.padEnd(16)} → tier ${tier}`);
  }
  const orphans = Object.keys(tiers).filter((r) => !cfg.roles.includes(r));
  for (const role of orphans) {
    console.log(`    ${role.padEnd(16)} → tier ${tiers[role]} (role no longer exists)`);
  }
}

/** Show the first 4 + last 4 chars of a long secret-ish identifier. */
function maskMid(s: string): string {
  if (s.length <= 12) return "***";
  return s.slice(0, 4) + "…" + s.slice(-4);
}
