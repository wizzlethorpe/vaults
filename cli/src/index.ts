#!/usr/bin/env node
import { Command } from "commander";
import { push } from "./commands/push.js";
import { build } from "./commands/build.js";
import { preview } from "./commands/preview.js";
import { init } from "./commands/init.js";
import { password } from "./commands/password.js";

const program = new Command();

program
  .name("vaults")
  .description("Sync an Obsidian vault to a Cloudflare-hosted wiki")
  .version("0.1.0");

program
  .command("password")
  .description("Set the password for a role (writes a PBKDF2 hash to settings.md)")
  .argument("<role>", "Role name (must already exist in settings.roles)")
  .option("--vault-path <path>", "Path to the vault", process.cwd())
  .action(async (role: string, opts: { vaultPath: string }) => {
    try { await password(opts.vaultPath, role, {}); }
    catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1); }
  });

program
  .command("init")
  .description("Initialise a vault with a settings.md file")
  .argument("[vault-path]", "Path to the Obsidian vault", process.cwd())
  .option("-f, --force", "Overwrite an existing settings.md")
  .action(wrap(init));

program
  .command("build")
  .description("Render the vault to a local output directory")
  .argument("[vault-path]", "Path to the Obsidian vault", process.cwd())
  .option("-o, --output <dir>", "Output directory (default: <vault>/.vault-cache/rendered)")
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .action(wrap(build));

program
  .command("preview")
  .description("Render the vault and serve it locally for preview")
  .argument("[vault-path]", "Path to the Obsidian vault", process.cwd())
  .option("-o, --output <dir>", "Output directory (default: <vault>/.vault-cache/rendered)")
  .option("-p, --port <n>", "Port for the preview server", (v) => parseInt(v, 10), 4173)
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .option("-r, --role <name>", "Which role variant to serve (default = highest role)")
  .action(wrap(preview));

program
  .command("push")
  .description("Render and deploy the vault to Cloudflare")
  .argument("[vault-path]", "Path to the Obsidian vault", process.cwd())
  .option("-u, --url <url>", "Deployed Pages URL")
  .option("-k, --key <key>", "API key")
  .option("-p, --project-name <name>", "Cloudflare Pages project name")
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .option("--dry-run", "Render and diff without uploading")
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
