import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface VaultConfig {
  /** The deployed Pages URL, e.g. "https://my-vault.pages.dev". */
  url: string;
  /** API key (matches the API_KEY secret on the deployment). */
  apiKey: string;
  /** Image compression quality (1-100). Set 0 to disable conversion. */
  imageQuality: number;
  /** Hard cap on file size (bytes). Files above this are skipped with a warning. */
  maxFileBytes: number;
  /** Cloudflare Pages project name (used for `wrangler pages deploy`). */
  projectName?: string;
  /** Hex-encoded HMAC key used to sign session cookies. Generated on first push. */
  sessionSecret?: string;
}

export async function saveSessionSecret(vaultPath: string, secret: string): Promise<void> {
  const path = join(vaultPath, ".vaultrc.json");
  let existing: Partial<VaultConfig> = {};
  try { existing = JSON.parse(await readFile(path, "utf8")) as Partial<VaultConfig>; } catch { /* no file yet */ }
  existing.sessionSecret = secret;
  await writeFile(path, JSON.stringify(existing, null, 2) + "\n");
}

const DEFAULT_CONFIG: Partial<VaultConfig> = {
  imageQuality: 85,
  maxFileBytes: 25 * 1024 * 1024,
};

export async function loadConfig(vaultPath: string, overrides: Partial<VaultConfig>): Promise<VaultConfig> {
  const fileConfig = await readFileConfig(vaultPath);
  const envConfig = readEnvConfig();

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envConfig,
    ...overrides,
  } as VaultConfig;

  if (!merged.url) throw new Error("Missing config: url (set in .vaultrc.json, VAULT_URL, or --url)");
  if (!merged.apiKey) throw new Error("Missing config: apiKey (set in .vaultrc.json, VAULT_API_KEY, or --key)");

  return merged;
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
  if (process.env.VAULT_URL) out.url = process.env.VAULT_URL;
  if (process.env.VAULT_API_KEY) out.apiKey = process.env.VAULT_API_KEY;
  if (process.env.VAULT_PROJECT_NAME) out.projectName = process.env.VAULT_PROJECT_NAME;
  return out;
}
