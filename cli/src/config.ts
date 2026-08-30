import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readDotEnv, writeDotEnv } from "./dotenv.js";
import { warnSensitive } from "./sensitive.js";
import type { OidcRoleRule } from "./render/oidc-match.js";

/**
 * `.vaultrc.json` holds CLI-managed CONFIG (project name, role list,
 * password hashes, Patreon clientId/campaignId/tiers). Safe to commit.
 *
 * `.env` holds CLI-managed SECRETS (SESSION_SECRET, PATREON_CLIENT_SECRET,
 * OAUTH_CLIENT_SECRET). NOT safe to commit; gitignored by `vaults init`.
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
  /**
   * Hex-encoded HMAC key used to sign session cookies. Generated on first
   * multi-role push. Stored in `.env` as SESSION_SECRET; surfaced here for
   * downstream code that has always read it from VaultConfig.
   */
  sessionSecret?: string;

  /** Access tiers, lowest → highest. First is the default for untagged content. */
  roles: string[];
  /** role name → "iter:saltHex:hashHex" produced by `vaults role add` / `vaults password`. */
  rolePasswords: Record<string, string>;

  /**
   * The version last assigned to the vault's Foundry module, with the
   * fingerprint of the manifest it describes. Kept so the version only moves
   * when the module itself does, rather than on every push.
   */
  foundryModule?: { version: string; hash: string };

  /**
   * OAuth provider overlays (optional, additive). Roles always have a password
   * gate; if a role's name appears in any provider's `tiers`, members whose
   * pledge / membership grants that tier can ALSO authenticate via the
   * provider's OAuth flow. New providers (Discord, GitHub Sponsors, …) plug
   * in here without growing the top-level VaultConfig surface.
   *
   * Provider config (clientId / campaignId / tiers) rides to the deploy as
   * middleware constants and lives in `.vaultrc.json`. Secrets (clientSecret)
   * stay in `.env` and are mirrored to Wrangler secrets on push.
   */
  oauth?: {
    patreon?: PatreonConfig;
    oidc?: OidcConfig;
  };
}

export interface PatreonConfig {
  clientId: string;
  clientSecret: string;
  campaignId: string;
  /** Role name → Patreon tier ID. Roles not in here only allow password auth. */
  tiers?: Record<string, string>;
}

/**
 * Generic OIDC provider. The three endpoints are resolved from the issuer's
 * discovery document by `vaults oidc configure` (or entered manually) and
 * baked in here, so the deployed middleware never fetches discovery.
 */
export interface OidcConfig {
  /** Issuer base URL, e.g. "https://lmucs.org". Kept for re-discovery on reconfigure. */
  issuer: string;
  /** Login button label ("Sign in with <displayName>"); defaults to the issuer host. */
  displayName: string;
  clientId: string;
  /** In-memory only; persisted to `.env` as OAUTH_CLIENT_SECRET, never to config.json. */
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  /** Role name → email/domain rule. Roles not in here only allow password auth. */
  roleRules?: Record<string, OidcRoleRule>;
}

const DEFAULT_CONFIG: VaultConfig = {
  roles: ["public"],
  rolePasswords: {},
};

// Resolved at call time so migrations get a chance to move the file
// before any read happens. See cli/src/paths.ts.
import { configPath } from "./paths.js";

// Env var names — same as the Wrangler secret names so the .env line you
// write is exactly what gets uploaded as the Cloudflare Pages secret.
const ENV_SESSION_SECRET = "SESSION_SECRET";
const ENV_PATREON_CLIENT_SECRET = "PATREON_CLIENT_SECRET";
const ENV_OAUTH_CLIENT_SECRET = "OAUTH_CLIENT_SECRET";

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

  if (merged.oauth?.patreon) {
    const patreonSecretFromEnv = process.env[ENV_PATREON_CLIENT_SECRET] || dotEnv[ENV_PATREON_CLIENT_SECRET];
    if (patreonSecretFromEnv) {
      merged.oauth = {
        ...merged.oauth,
        patreon: { ...merged.oauth.patreon, clientSecret: patreonSecretFromEnv },
      };
    }
  }

  if (merged.oauth?.oidc) {
    const oidcSecretFromEnv = process.env[ENV_OAUTH_CLIENT_SECRET] || dotEnv[ENV_OAUTH_CLIENT_SECRET];
    if (oidcSecretFromEnv) {
      merged.oauth = {
        ...merged.oauth,
        oidc: { ...merged.oauth.oidc, clientSecret: oidcSecretFromEnv },
      };
    }
  }

  // Deep-clone the mutable fields so callers can mutate (push to roles,
  // assign to rolePasswords) without mutating DEFAULT_CONFIG by reference.
  return {
    ...merged,
    roles: [...merged.roles],
    rolePasswords: { ...merged.rolePasswords },
    ...(merged.oauth ? {
      oauth: {
        ...(merged.oauth.patreon ? {
          patreon: { ...merged.oauth.patreon, tiers: { ...(merged.oauth.patreon.tiers ?? {}) } },
        } : {}),
        // structuredClone: roleRules nests arrays, manual spreading gets noisy.
        ...(merged.oauth.oidc ? { oidc: structuredClone(merged.oauth.oidc) } : {}),
      },
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
    if (k === "oauth" && v) {
      const oauth = v as VaultConfig["oauth"];
      const persistedOauth: NonNullable<VaultConfig["oauth"]> = {};
      if (oauth?.patreon) {
        const { clientSecret: _drop, ...rest } = oauth.patreon;
        persistedOauth.patreon = rest as PatreonConfig;
      }
      if (oauth?.oidc) {
        const { clientSecret: _drop, ...rest } = oauth.oidc;
        persistedOauth.oidc = rest as OidcConfig;
      }
      out.oauth = persistedOauth;
      continue;
    }
    if (deepEqual(v, DEFAULT_CONFIG[k as keyof VaultConfig] as unknown)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  const cfgPath = configPath(vaultPath);
  await mkdir(dirname(cfgPath), { recursive: true });
  await writeFile(cfgPath, JSON.stringify(out, null, 2) + "\n");

  // Mirror secrets to .env. Use null to delete keys that are no longer set
  // so a user clearing Patreon doesn't leave a stray client secret behind.
  const envUpdates: Record<string, string | null> = {
    [ENV_SESSION_SECRET]: cfg.sessionSecret || null,
    [ENV_PATREON_CLIENT_SECRET]: cfg.oauth?.patreon?.clientSecret || null,
    [ENV_OAUTH_CLIENT_SECRET]: cfg.oauth?.oidc?.clientSecret || null,
  };
  // Only touch .env if there's something to set/clear; avoids creating an
  // empty .env in vaults that don't have any secrets.
  const hasAnySecret = Object.values(envUpdates).some((v) => v != null);
  const existingEnv = await readDotEnv(vaultPath);
  if (hasAnySecret || Object.keys(envUpdates).some((k) => existingEnv[k])) {
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
  if (cfg.oauth?.patreon?.clientSecret) parts.push("a Patreon client secret");
  if (cfg.oauth?.oidc?.clientSecret) parts.push("an OIDC client secret");
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

/**
 * Read `.vaults/config.json`, or `{}` when the vault has none yet.
 *
 * Only a missing file means "no config". Every other failure throws, because
 * `{}` here is indistinguishable from a fresh vault and merges into the
 * defaults — `roles: ["public"]`, no password hashes. One unreadable or
 * malformed config would therefore build a single public variant with no auth
 * middleware and publish every gated page, reporting success the whole way;
 * the next `push` would then write those defaults back over the real roles,
 * hashes, and OAuth config. This is a system boundary, so it validates here.
 */
async function readFileConfig(vaultPath: string): Promise<Partial<VaultConfig>> {
  const path = configPath(vaultPath);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as Partial<VaultConfig>;
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON: ${(err as Error).message}\n`
      + `  Fix or delete the file. Deleting it resets this vault to a single `
      + `public role and discards its password hashes and OAuth config.`,
    );
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
