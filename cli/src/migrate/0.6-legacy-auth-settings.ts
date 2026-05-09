// Migration: copy legacy auth fields out of settings.md frontmatter into
// the CLI-managed config (formerly .vaultrc.json, now .vaults/config.json).
//
// Earlier versions stored `roles`, `auth_type`, and `role_passwords` in
// settings.md. The settings canonicaliser strips unknown keys, so if we
// don't lift them out before settings.md is rewritten, they're silently
// dropped. This migration copies anything we still see in settings.md
// over to the config — but only when the destination is empty / default,
// so re-running on an already-migrated vault is a no-op.
//
// This was previously inline in build.ts as migrateLegacyAuthFromSettings();
// moved here so all migrations live in one registry.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { Migration } from "./types.js";
import { loadConfig, saveConfig, type VaultConfig } from "../config.js";
import { SETTINGS_FILE } from "../paths.js";

export const legacyAuthSettingsMigration: Migration = {
  id: "0.6-legacy-auth-settings",
  description: "settings.md roles/auth_type/role_passwords → CLI-managed config",

  async needs(vaultPath: string): Promise<boolean> {
    const fm = await readSettingsFrontmatter(vaultPath);
    if (!fm) return false;
    if (!hasAnyLegacyKey(fm)) return false;
    const cfg = await loadConfig(vaultPath, {});
    return liftLegacyAuth(fm, cfg, { dryRun: true }).length > 0;
  },

  async apply(vaultPath: string): Promise<void> {
    const fm = await readSettingsFrontmatter(vaultPath);
    if (!fm) return;
    const cfg = await loadConfig(vaultPath, {});
    const moved = liftLegacyAuth(fm, cfg, { dryRun: false });
    if (moved.length === 0) return;
    await saveConfig(vaultPath, cfg);
    console.log(`    moved ${moved.join(", ")} from settings.md → config`);
  },
};

async function readSettingsFrontmatter(vaultPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(vaultPath, SETTINGS_FILE), "utf8");
    return (matter(raw).data ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasAnyLegacyKey(fm: Record<string, unknown>): boolean {
  return "roles" in fm || "auth_type" in fm || "role_passwords" in fm;
}

/**
 * Single source of truth for which legacy fields qualify for lift, what
 * they get moved to, and (when `dryRun=false`) the actual mutation.
 *
 * Returns the names of fields that qualified (= would move when not a dry
 * run). `needs()` runs this dry; `apply()` runs it for real.
 */
function liftLegacyAuth(
  fm: Record<string, unknown>,
  cfg: VaultConfig,
  opts: { dryRun: boolean },
): string[] {
  const moved: string[] = [];

  if (Array.isArray(fm.roles)) {
    const list = fm.roles.filter((r): r is string => typeof r === "string");
    const isDefault = cfg.roles.length === 0 || (cfg.roles.length === 1 && cfg.roles[0] === "public");
    if (list.length > 0 && isDefault && !arraysEqual(list, ["public"])) {
      if (!opts.dryRun) cfg.roles = list;
      moved.push("roles");
    }
  }

  // `auth_type` was a forward-looking knob (password vs cloudflare-access vs
  // oauth-jwt) that nothing has ever read. The field was removed from
  // VaultConfig; lifting it would be a no-op, so we don't bother.

  if (fm.role_passwords && typeof fm.role_passwords === "object" && !Array.isArray(fm.role_passwords)
      && Object.keys(cfg.rolePasswords).length === 0) {
    const cleaned = filterStringValues(fm.role_passwords as Record<string, unknown>);
    if (Object.keys(cleaned).length > 0) {
      if (!opts.dryRun) cfg.rolePasswords = cleaned;
      moved.push("role_passwords");
    }
  }

  return moved;
}

function filterStringValues(map: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) if (typeof v === "string") out[k] = v;
  return out;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
