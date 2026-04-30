import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface AppearanceJson {
  enabledCssSnippets?: string[];
}

/**
 * Load Obsidian CSS snippets from <vault>/.obsidian/snippets/*.css.
 *
 * If .obsidian/appearance.json exists, only snippets listed in
 * `enabledCssSnippets` are included. If it's missing, all snippets are
 * included — matches Obsidian's behaviour when the user hasn't configured
 * anything, and gives users a "drop a CSS file in and it works" workflow.
 *
 * Returns a single concatenated CSS string, or empty if no snippets.
 */
export async function loadObsidianSnippets(vaultPath: string): Promise<string> {
  const snippetsDir = join(vaultPath, ".obsidian", "snippets");
  let files: string[];
  try {
    files = (await readdir(snippetsDir)).filter((f) => f.endsWith(".css"));
  } catch {
    return "";
  }
  if (files.length === 0) return "";

  const enabled = await readEnabledList(vaultPath);
  const include = enabled
    ? files.filter((f) => enabled.includes(f.replace(/\.css$/i, "")))
    : files;

  if (include.length === 0) return "";

  const parts: string[] = [];
  for (const file of include.sort()) {
    const body = await readFile(join(snippetsDir, file), "utf8");
    parts.push(`/* === ${file} === */\n${body}\n`);
  }
  return parts.join("\n");
}

async function readEnabledList(vaultPath: string): Promise<string[] | null> {
  try {
    const raw = await readFile(join(vaultPath, ".obsidian", "appearance.json"), "utf8");
    const parsed = JSON.parse(raw) as AppearanceJson;
    return Array.isArray(parsed.enabledCssSnippets) ? parsed.enabledCssSnippets : null;
  } catch {
    return null;
  }
}
