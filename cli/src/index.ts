#!/usr/bin/env node
import { Command } from "commander";
import { push } from "./commands/push.js";

const program = new Command();

program
  .name("vaults")
  .description("Sync an Obsidian vault to a Cloudflare-hosted wiki")
  .version("0.1.0");

program
  .command("push")
  .description("Render and deploy your vault")
  .argument("[vault-path]", "Path to the Obsidian vault", process.cwd())
  .option("-u, --url <url>", "Deployed Pages URL")
  .option("-k, --key <key>", "API key")
  .option("-p, --project-name <name>", "Cloudflare Pages project name")
  .option("-q, --image-quality <n>", "WebP image quality (0 = no compression)", (v) => parseInt(v, 10))
  .option("-n, --vault-name <name>", "Display name for the vault", "Vault")
  .option("--dry-run", "Render and diff without uploading")
  .action(async (vaultPath: string, opts) => {
    try {
      await push(vaultPath, opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
