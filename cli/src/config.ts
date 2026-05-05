import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readDotEnv, writeDotEnv } from "./dotenv.js";
import { warnSensitive } from "./sensitive.js";

/**
 * `.vaultrc.json` holds CLI-managed CONFIG (project name, role list,
 * password hashes, Patreon clientId/campaignId/tiers). Safe to commit.
 *
 * `.env` holds CLI-managed SECRETS (SESSION_SECRET, PATREON_CLIENT_SECRET).
 * NOT safe to commit; gitignored by `vaults init`.
 *
 * The split lets users version-control config + sync it across machines
 * without leaking the cookie-signing key or Patreon OAuth secret.
 *
 * Legacy: older vaults stored secrets directly in `.vaultrc.json`. Load
 * preserves that for back-compat; the next save extracts them to `.env`
 * automatically.
 */
export interface VaultConfig {
  /** Cloudflare Pages project name (used for `wrangler pages deploy`). */
  projectName?: string;
  /** Image compression quality (1-100). Set 0 to disable conversion. */
  imageQuality: number;
  /** Hard cap on file size (bytes). Files above this are skipped with a warning. */
  maxFileBytes: number;
  /**
   * Hex-encoded HMAC key used to sign session cookies. Generated on first
   * multi-role push. Stored in `.env` as SESSION_SECRET; surfaced here for
   * downstream code that has always read it from VaultConfig.
   */
  sessionSecret?: string;

  /** Access tiers, lowest → highest. First is the default for untagged content. */
  roles: string[];
  /** "password" today; future: "cloudflare-access", "oauth-jwt". */
  authType: string;
  /** role name → "iter:saltHex:hashHex" produced by `vaults role add` / `vaults password`. */
  rolePasswords: Record<string, string>;

  /**
   * Patreon OAuth overlay (optional, additive). Roles always have a password
   * gate; if a role's name appears in `patreon.tiers`, patrons whose pledge
   * grants that tier can ALSO authenticate via Patreon's OAuth flow.
   *
   * `clientId` / `campaignId` / `tiers` ride to the deploy as middleware
   * constants and live in `.vaultrc.json`. `clientSecret` is a real secret
   * (lives in `.env` as PATREON_CLIENT_SECRET); we surface it here so
   * `vaults push` can re-upload it as a Wrangler secret.
   */
  patreon?: PatreonConfig;
}

export interface PatreonConfig {
  clientId: string;
  clientSecret: string;
  campaignId: string;
  /** Role name → Patreon tier ID. Roles not in here only allow password auth. */
  tiers?: Record<string, string>;
}

const DEFAULT_CONFIG: VaultConfig = {
  imageQuality: 85,
  maxFileBytes: 25 * 1024 * 1024,
  roles: ["public"],
  authType: "password",
  rolePasswords: {},
};

const CONFIG_FILE = ".vaultrc.json";

// Env var names — same as the Wrangler secret names so the .env line you
// write is exactly what gets uploaded as the Cloudflare Pages secret.
const ENV_SESSION_SECRET = "SESSION_SECRET";
const ENV_PATREON_CLIENT_SECRET = "PATREON_CLIENT_SECRET";

/**
 * Read config from `.vaultrc.json` + `.env` + process.env.
 *
 * Precedence (lowest → highest): defaults → .vaultrc.json → .env → process.env → overrides.
 *
 * Secrets follow the same precedence but with one extra source: legacy
 * `.vaultrc.json` files that still have `sessionSecret` or
 * `patreon.clientSecret` baked in. Those values get used at load time and
 * silently migrated to `.env` on the next save.
 */
export async function loadConfig(vaultPath: string, overrides: Partial<VaultConfig>): Promise<VaultConfig> {
  const fileConfig = await readFileConfig(vaultPath);
  const dotEnv = await readDotEnv(vaultPath);
  const envConfig = readEnvConfig();
  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  };

  // Secrets: prefer process.env → .env → legacy .vaultrc.json. The latter
  // is back-compat only.
  const sessionFromEnv = process.env[ENV_SESSION_SECRET] || dotEnv[ENV_SESSION_SECRET];
  if (sessionFromEnv) merged.sessionSecret = sessionFromEnv;

  if (merged.patreon) {
    const patreonSecretFromEnv = process.env[ENV_PATREON_CLIENT_SECRET] || dotEnv[ENV_PATREON_CLIENT_SECRET];
    if (patreonSecretFromEnv) {
      merged.patreon = { ...merged.patreon, clientSecret: patreonSecretFromEnv };
    }
  }

  // Deep-clone the mutable fields so callers can mutate (push to roles,
  // assign to rolePasswords) without mutating DEFAULT_CONFIG by reference.
  return {
    ...merged,
    roles: [...merged.roles],
    rolePasswords: { ...merged.rolePasswords },
    ...(merged.patreon ? {
      patreon: { ...merged.patreon, tiers: { ...(merged.patreon.tiers ?? {}) } },
    } : {}),
  };
}

/**
 * Persist config + secrets to disk. Config goes to `.vaultrc.json`
 * (trackable); secrets go to `.env` (gitignored). Per-process one-shot
 * warning if `.env` lives in a git repo without being gitignored.
 *
 * Migration: any legacy secrets we find in `.vaultrc.json` get moved to
 * `.env` on the first save. The user's git history will still contain
 * them, so they should rotate any session secret that was ever pushed.
 */
const warnedVaults = new Set<string>();

export async function saveConfig(vaultPath: string, cfg: VaultConfig): Promise<void> {
  // Build the trackable config. Secrets are excluded; defaults stripped.
  const out: Partial<VaultConfig> = {};
  for (const k of Object.keys(cfg) as (keyof VaultConfig)[]) {
    if (k === "sessionSecret") continue; // → .env
    const v = cfg[k];
    if (k === "patreon" && v) {
      const { clientSecret: _drop, ...rest } = v as PatreonConfig;
      out.patreon = rest as PatreonConfig;
      continue;
    }
    if (deepEqual(v, DEFAULT_CONFIG[k as keyof VaultConfig] as unknown)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  await writeFile(join(vaultPath, CONFIG_FILE), JSON.stringify(out, null, 2) + "\n");

  // Mirror secrets to .env. Use null to delete keys that are no longer set
  // so a user clearing Patreon doesn't leave a stray client secret behind.
  const envUpdates: Record<string, string | null> = {
    [ENV_SESSION_SECRET]: cfg.sessionSecret || null,
    [ENV_PATREON_CLIENT_SECRET]: cfg.patreon?.clientSecret || null,
  };
  // Only touch .env if there's something to set/clear; avoids creating an
  // empty .env in vaults that don't have any secrets.
  const hasAnySecret = Object.values(envUpdates).some((v) => v != null);
  if (hasAnySecret || (await readDotEnv(vaultPath))[ENV_SESSION_SECRET] || (await readDotEnv(vaultPath))[ENV_PATREON_CLIENT_SECRET]) {
    await writeDotEnv(vaultPath, envUpdates);
  }

  if (!warnedVaults.has(vaultPath)) {
    warnedVaults.add(vaultPath);
    if (hasAnySecret) {
      const what = describeSecrets(cfg);
      if (what) await warnSensitive(vaultPath, ".env", what);
    }
  }
}

function describeSecrets(cfg: VaultConfig): string | null {
  const parts: string[] = [];
  if (cfg.sessionSecret) parts.push("the session-signing key");
  if (cfg.patreon?.clientSecret) parts.push("a Patreon client secret");
  if (parts.length === 0) return null;
  return parts.length === 1
    ? parts[0]!
    : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

export async function saveSessionSecret(vaultPath: string, secret: string): Promise<void> {
  const cfg = await loadConfig(vaultPath, {});
  cfg.sessionSecret = secret;
  await saveConfig(vaultPath, cfg);
}

async function readFileConfig(vaultPath: string): Promise<Partial<VaultConfig>> {
  try {
    const raw = await readFile(join(vaultPath, CONFIG_FILE), "utf8");
    return JSON.parse(raw) as Partial<VaultConfig>;
  } catch {
    return {};
  }
}

function readEnvConfig(): Partial<VaultConfig> {
  const out: Partial<VaultConfig> = {};
  if (process.env.VAULT_PROJECT_NAME) out.projectName = process.env.VAULT_PROJECT_NAME;
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ));
  }
  return false;
}
