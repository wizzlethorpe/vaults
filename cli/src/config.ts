import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * .vaultrc.json holds CLI-managed state. Gitignored. Never hand-edited
 * (the CLI reads/writes via specific commands like `vaults role add`,
 * `vaults password`, `vaults push`).
 */
export interface VaultConfig {
  /** Cloudflare Pages project name (used for `wrangler pages deploy`). */
  projectName?: string;
  /** Image compression quality (1-100). Set 0 to disable conversion. */
  imageQuality: number;
  /** Hard cap on file size (bytes). Files above this are skipped with a warning. */
  maxFileBytes: number;
  /** Hex-encoded HMAC key used to sign session cookies. Generated on first multi-role push. */
  sessionSecret?: string;

  /** Access tiers, lowest → highest. First is the default for untagged content. */
  roles: string[];
  /** "password" today; future: "cloudflare-access", "oauth-jwt". */
  authType: string;
  /** role name → "iter:saltHex:hashHex" produced by `vaults role add` / `vaults password`. */
  rolePasswords: Record<string, string>;
}

const DEFAULT_CONFIG: VaultConfig = {
  imageQuality: 85,
  maxFileBytes: 25 * 1024 * 1024,
  roles: ["public"],
  authType: "password",
  rolePasswords: {},
};

const CONFIG_FILE = ".vaultrc.json";

export async function loadConfig(vaultPath: string, overrides: Partial<VaultConfig>): Promise<VaultConfig> {
  const fileConfig = await readFileConfig(vaultPath);
  const envConfig = readEnvConfig();
  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  };
  // Deep-clone the mutable fields so callers can mutate (push to roles,
  // assign to rolePasswords) without mutating DEFAULT_CONFIG by reference.
  return {
    ...merged,
    roles: [...merged.roles],
    rolePasswords: { ...merged.rolePasswords },
  };
}

/**
 * Persist the full config back to .vaultrc.json. The CLI uses this whenever
 * it mutates auth state (role add/remove/promote/demote, password reset,
 * sessionSecret generation, projectName saved on first push).
 */
export async function saveConfig(vaultPath: string, cfg: VaultConfig): Promise<void> {
  // Strip default-equal fields so the on-disk file stays minimal.
  const out: Partial<VaultConfig> = {};
  for (const k of Object.keys(cfg) as (keyof VaultConfig)[]) {
    const v = cfg[k];
    if (deepEqual(v, DEFAULT_CONFIG[k as keyof VaultConfig] as unknown)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  await writeFile(join(vaultPath, CONFIG_FILE), JSON.stringify(out, null, 2) + "\n");
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
