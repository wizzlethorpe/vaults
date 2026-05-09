import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Minimal POSIX-shell-friendly .env reader/writer. Just enough to support
// the secrets-only use case (SESSION_SECRET, PATREON_CLIENT_SECRET); not a
// full dotenv replacement. We avoid pulling in `dotenv` as a dep to keep
// the CLI's transitive surface small.
//
// Supported on read:
//   - blank lines and `# comment` lines skipped
//   - `KEY=value` (no spaces around =), unquoted, single, or double quoted
//   - quoted values may contain `\n` (single-line; we don't try multiline)
// Not supported (silently ignored, like most parsers):
//   - shell expansion, `$VAR` substitution, `export KEY=...`, multiline
//
// On write we preserve order, comments, and unrelated lines; only the keys
// we manage get rewritten. New keys are appended.

const ENV_FILE = ".env";

export async function readDotEnv(vaultPath: string): Promise<Record<string, string>> {
  let raw: string;
  try { raw = await readFile(join(vaultPath, ENV_FILE), "utf8"); }
  catch { return {}; }

  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed) out[parsed.key] = parsed.value;
  }
  return out;
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  // Allow `export KEY=...` for users who source .env in their shell.
  const stripped = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const eq = stripped.indexOf("=");
  if (eq <= 0) return null;
  const key = stripped.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = stripped.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Update one or more keys in the vault's .env. Pass `null` for a value to
 * remove that key. Preserves the file's existing layout (comments, line
 * order, unrelated keys) so a hand-edited .env stays readable.
 */
export async function writeDotEnv(vaultPath: string, updates: Record<string, string | null>): Promise<void> {
  const path = join(vaultPath, ENV_FILE);
  let lines: string[] = [];
  let exists = true;
  try { lines = (await readFile(path, "utf8")).split(/\r?\n/); }
  catch { exists = false; }

  const handled = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed || !(parsed.key in updates)) {
      out.push(line);
      continue;
    }
    handled.add(parsed.key);
    const next = updates[parsed.key];
    if (next == null) continue; // delete the line
    out.push(`${parsed.key}=${quoteEnvValue(next)}`);
  }

  // Append new keys not seen in the existing file.
  const appended: string[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val == null || handled.has(key)) continue;
    appended.push(`${key}=${quoteEnvValue(val)}`);
  }
  if (appended.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(...appended);
  }

  // Trim trailing blank lines but keep one, so concatenation stays clean.
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  if (out.length === 0 || out[out.length - 1] !== "") out.push("");

  // Don't write an empty .env if the file didn't already exist and we
  // had nothing to add.
  if (!exists && out.every((l) => l === "")) return;
  await writeFile(path, out.join("\n"));
}

function quoteEnvValue(value: string): string {
  // Bare-token chars that don't need quoting — letters, digits, and a few
  // safe punctuation. Anything else (including spaces or shell glob chars)
  // gets double-quoted with backslash-escapes.
  if (/^[A-Za-z0-9._\-+@%~:/]*$/.test(value)) return value;
  return `"${value.replace(/[\\"$`]/g, (c) => "\\" + c)}"`;
}
