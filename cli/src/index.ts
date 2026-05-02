#!/usr/bin/env node
import { Command } from "commander";
import { push } from "./commands/push.js";
import { build } from "./commands/build.js";
import { preview } from "./commands/preview.js";
import { init } from "./commands/init.js";
import { password } from "./commands/password.js";
import { roleAdd, roleDemote, roleList, rolePromote, roleRemove } from "./commands/role.js";

const program = new Command();

// Default vault path: honour $VAULT_PATH first so users can drop
// `export VAULT_PATH=~/Documents/MyVault` in their shell rc and not pass it
// to every command. Falls back to cwd.
const VAULT_PATH_DEFAULT = process.env.VAULT_PATH ?? process.cwd();

program
  .name("vaults")
  .description("Sync an Obsidian vault to a Cloudflare-hosted wiki")
  .version("0.1.0");

const role = program
  .command("role")
  .description("Manage roles (access tiers) in the vault");

role
  .command("add")
  .description("Add a role and (for non-default roles) set its password")
  .argument("<name>", "Role name")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (name: string, vaultPath: string) => {
    try { await roleAdd(name, vaultPath); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

role
  .command("remove")
  .description("Remove a role and its password")
  .argument("<name>", "Role name")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (name: string, vaultPath: string) => {
    try { await roleRemove(name, vaultPath); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

role
  .command("list")
  .description("Show roles configured for this vault")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (vaultPath: string) => {
    try { await roleList(vaultPath); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

role
  .command("promote")
  .description("Increase a role's rank by one (move toward the highest tier)")
  .argument("<name>", "Role name")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (name: string, vaultPath: string) => {
    try { await rolePromote(name, vaultPath); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

role
  .command("demote")
  .description("Decrease a role's rank by one (move toward the default)")
  .argument("<name>", "Role name")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (name: string, vaultPath: string) => {
    try { await roleDemote(name, vaultPath); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

program
  .command("password")
  .description("Reset the password for an existing role")
  .argument("<role>", "Role name (must already exist)")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .action(async (role: string, vaultPath: string) => {
    try { await password(vaultPath, role, {}); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

program
  .command("init")
  .description("Initialise a vault with a settings.md file")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .option("-f, --force", "Overwrite an existing settings.md")
  .action(wrap(init));

program
  .command("build")
  .description("Render the vault to a local output directory")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .option("-o, --output <dir>", "Output directory (default: <vault>/.vault-cache/rendered)")
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .action(wrap(build));

program
  .command("preview")
  .description("Render the vault and serve it locally via `wrangler pages dev` (Functions run)")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .option("-o, --output <dir>", "Output directory (default: <vault>/.vault-cache/rendered)")
  .option("-p, --port <n>", "Port for the preview server", (v) => parseInt(v, 10), 4173)
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .action(wrap(preview));

program
  .command("push")
  .description("Render and deploy the vault to Cloudflare Pages")
  .argument("[vault-path]", "Path to the Obsidian vault", VAULT_PATH_DEFAULT)
  .option("-p, --project-name <name>", "Cloudflare Pages project name")
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .option("--dry-run", "Render without deploying")
  .action(wrap(push));

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});

function wrap<T extends (...args: never[]) => Promise<void>>(fn: T): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  };
}
