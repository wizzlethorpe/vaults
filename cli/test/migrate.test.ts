// Tests for the migration framework.
//
// Coverage:
//   1. The registry runs migrations in order.
//   2. needs() correctly detects pre/post state for the .vaults-dir migration.
//   3. apply() moves .vaultrc.json → .vaults/config.json and
//      .vault-cache/ → .vaults/cache/ atomically (rename), preserving content.
//   4. Re-running an already-applied migration is a no-op (idempotent).
//   5. dry-run reports work without mutating the vault.
//   6. --only filters to one migration; unknown id throws.
//   7. .vaults/.gitignore is written with sane defaults.
//   8. End-to-end: a legacy-layout vault builds correctly after migration.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations, listMigrations } from "../src/migrate/run.js";
import { vaultsDirMigration, ensureVaultsGitignore } from "../src/migrate/0.7-vaults-dir.js";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; }

async function setup(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-mig-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return { dir };
}

async function cleanup(v: Vault): Promise<void> {
  await rm(v.dir, { recursive: true, force: true });
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

// ── Framework wiring ─────────────────────────────────────────────────────

describe("migration framework", () => {
  it("listMigrations returns a stable, ordered list", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(ids.includes("0.7-vaults-dir"));
  });

  it("runMigrations on an empty vault does nothing", async () => {
    const v = await setup({});
    try {
      const result = await runMigrations(v.dir, { silent: true });
      assert.deepEqual(result.applied, []);
    } finally { await cleanup(v); }
  });

  it("--only filters to a single migration", async () => {
    const v = await setup({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
    });
    try {
      const result = await runMigrations(v.dir, { only: "0.7-vaults-dir", silent: true });
      assert.deepEqual(result.applied, ["0.7-vaults-dir"]);
      assert.equal(await exists(join(v.dir, ".vaults/config.json")), true);
      assert.equal(await exists(join(v.dir, ".vaultrc.json")), false);
    } finally { await cleanup(v); }
  });

  it("--only with unknown id throws", async () => {
    const v = await setup({});
    try {
      await assert.rejects(
        () => runMigrations(v.dir, { only: "no-such-migration", silent: true }),
        /unknown migration id/,
      );
    } finally { await cleanup(v); }
  });

  it("dry-run does not mutate the vault", async () => {
    const v = await setup({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
    });
    try {
      const result = await runMigrations(v.dir, { dryRun: true, silent: true });
      assert.deepEqual(result.applied, ["0.7-vaults-dir"]);
      // The legacy file should still be there after a dry run.
      assert.equal(await exists(join(v.dir, ".vaultrc.json")), true);
      assert.equal(await exists(join(v.dir, ".vaults/config.json")), false);
    } finally { await cleanup(v); }
  });
});

// ── 0.7-vaults-dir specifics ─────────────────────────────────────────────

describe("0.7-vaults-dir migration", () => {
  it("needs() detects a legacy .vaultrc.json", async () => {
    const v = await setup({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
    });
    try {
      assert.equal(await vaultsDirMigration.needs(v.dir), true);
    } finally { await cleanup(v); }
  });

  it("needs() detects a legacy .vault-cache/", async () => {
    const v = await setup({});
    await mkdir(join(v.dir, ".vault-cache"), { recursive: true });
    try {
      assert.equal(await vaultsDirMigration.needs(v.dir), true);
    } finally { await cleanup(v); }
  });

  it("needs() returns false on a fresh / already-migrated vault", async () => {
    const v = await setup({});
    try {
      assert.equal(await vaultsDirMigration.needs(v.dir), false);
    } finally { await cleanup(v); }
  });

  it("apply() moves config and cache, preserving content", async () => {
    const cfg = JSON.stringify({ roles: ["public", "patron", "dm"], rolePasswords: { patron: "X", dm: "Y" } });
    const v = await setup({
      ".vaultrc.json": cfg,
      ".vault-cache/rendered/index.html": "<p>cached</p>",
      ".vault-cache/images/q85/foo.webp": "binary-stand-in",
    });
    try {
      await vaultsDirMigration.apply(v.dir);
      // New paths exist with original content.
      assert.equal(await readFile(join(v.dir, ".vaults/config.json"), "utf8"), cfg);
      assert.equal(await readFile(join(v.dir, ".vaults/cache/rendered/index.html"), "utf8"), "<p>cached</p>");
      assert.equal(await readFile(join(v.dir, ".vaults/cache/images/q85/foo.webp"), "utf8"), "binary-stand-in");
      // Legacy paths gone.
      assert.equal(await exists(join(v.dir, ".vaultrc.json")), false);
      assert.equal(await exists(join(v.dir, ".vault-cache")), false);
      // .vaults/.gitignore created.
      const gitignore = await readFile(join(v.dir, ".vaults/.gitignore"), "utf8");
      assert.match(gitignore, /cache\//);
      assert.match(gitignore, /config\.json/);
    } finally { await cleanup(v); }
  });

  it("re-running apply() on an already-migrated vault is a no-op", async () => {
    const v = await setup({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
    });
    try {
      await vaultsDirMigration.apply(v.dir);
      assert.equal(await vaultsDirMigration.needs(v.dir), false);
      // Second apply doesn't blow up (rename of a non-existent legacy file).
      await vaultsDirMigration.apply(v.dir);
      assert.equal(await vaultsDirMigration.needs(v.dir), false);
    } finally { await cleanup(v); }
  });

  it("ensureVaultsGitignore creates .vaults/ on a fresh vault (init path)", async () => {
    // Regression: `vaults init` calls ensureVaultsGitignore directly, with no
    // prior mkdir of .vaults/ (unlike apply(), which creates it first). It must
    // create the directory itself, or the writeFile throws ENOENT.
    const v = await setup({});
    try {
      await ensureVaultsGitignore(v.dir);
      const gitignore = await readFile(join(v.dir, ".vaults/.gitignore"), "utf8");
      assert.match(gitignore, /cache\//);
      assert.match(gitignore, /config\.json/);
    } finally { await cleanup(v); }
  });

  it("does not overwrite an existing .vaults/config.json if both exist", async () => {
    const v = await setup({
      ".vaultrc.json": "LEGACY",
      ".vaults/config.json": "NEW",
    });
    try {
      await vaultsDirMigration.apply(v.dir);
      // The new file wins; the legacy file is left in place for the user
      // to inspect / delete by hand.
      assert.equal(await readFile(join(v.dir, ".vaults/config.json"), "utf8"), "NEW");
    } finally { await cleanup(v); }
  });
});

// ── End-to-end via buildSite() ───────────────────────────────────────────

describe("legacy vault builds after auto-migration", () => {
  it("buildSite() migrates a pre-0.7 vault and produces output", async () => {
    const v = await setup({
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
      "settings.md": "---\nvault_name: Legacy\n---\n",
      "Page.md": "Hello.",
    });
    try {
      const origLog = console.log;
      const origWarn = console.warn;
      console.log = () => {};
      console.warn = () => {};
      try {
        await buildSite({
          vaultPath: v.dir,
          outputDir: join(v.dir, "_out"),
          vaultName: "Legacy",
          imageQuality: 0,
          maxFileBytes: 1 << 30,
        });
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      // The legacy paths got migrated.
      assert.equal(await exists(join(v.dir, ".vaultrc.json")), false);
      assert.equal(await exists(join(v.dir, ".vaults/config.json")), true);
      // Build output rendered.
      assert.equal(await exists(join(v.dir, "_out/Page.html")), true);
    } finally { await cleanup(v); }
  });
});
