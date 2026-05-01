import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface VaultConfig {
  /** Cloudflare Pages project name (used for `wrangler pages deploy`). */
  projectName?: string;
  /** Image compression quality (1-100). Set 0 to disable conversion. */
  imageQuality: number;
  /** Hard cap on file size (bytes). Files above this are skipped with a warning. */
  maxFileBytes: number;
  /** Hex-encoded HMAC key used to sign session cookies. Generated on first multi-role push. */
  sessionSecret?: string;
}

const DEFAULT_CONFIG: Partial<VaultConfig> = {
  imageQuality: 85,
  maxFileBytes: 25 * 1024 * 1024,
};

export async function loadConfig(vaultPath: string, overrides: Partial<VaultConfig>): Promise<VaultConfig> {
  const fileConfig = await readFileConfig(vaultPath);
  const envConfig = readEnvConfig();
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  } as VaultConfig;
}

export async function saveSessionSecret(vaultPath: string, secret: string): Promise<void> {
  const path = join(vaultPath, ".vaultrc.json");
  let existing: Partial<VaultConfig> = {};
  try { existing = JSON.parse(await readFile(path, "utf8")) as Partial<VaultConfig>; } catch { /* no file yet */ }
  existing.sessionSecret = secret;
  await writeFile(path, JSON.stringify(existing, null, 2) + "\n");
}

async function readFileConfig(vaultPath: string): Promise<Partial<VaultConfig>> {
  try {
    const raw = await readFile(join(vaultPath, ".vaultrc.json"), "utf8");
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
