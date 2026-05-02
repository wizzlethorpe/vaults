import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../auth.js";
import { loadConfig, saveConfig } from "../config.js";

export async function roleAdd(name: string, vaultPath: string): Promise<void> {
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid role name '${name}'. Use letters, digits, '_' or '-' (must start with a letter).`);
  }

  const cfg = await loadConfig(vaultPath, {});
  if (cfg.roles.includes(name)) throw new Error(`Role '${name}' already exists.`);

  // First role added (or first ever role) is the default; no password.
  // Subsequent roles need a password to gate access.
  const isDefault = cfg.roles.length === 0;
  cfg.roles.push(name);

  if (!isDefault) {
    console.log(`Adding role '${name}'. Set a password to gate access:`);
    const pw = await readPassword();
    cfg.rolePasswords[name] = await hashPassword(pw);
  }

  await saveConfig(vaultPath, cfg);
  console.log(`Added role '${name}'${isDefault ? " (default)" : ""}.`);
  console.log(`  Mark pages with 'role: ${name}' frontmatter or callouts with '> [!${name}]' to gate them.`);
}

export async function roleRemove(name: string, vaultPath: string): Promise<void> {
  const cfg = await loadConfig(vaultPath, {});
  if (!cfg.roles.includes(name)) {
    throw new Error(`Role '${name}' is not configured (${cfg.roles.join(", ") || "empty"}).`);
  }
  if (cfg.roles[0] === name && cfg.roles.length > 1) {
    throw new Error(`Can't remove '${name}'; it's the default role. Remove the other roles first.`);
  }

  cfg.roles = cfg.roles.filter((r) => r !== name);
  delete cfg.rolePasswords[name];
  await saveConfig(vaultPath, cfg);
  console.log(`Removed role '${name}'.`);
  console.log(`  Pages tagged 'role: ${name}' will fall back to the default role on next build.`);
}

export async function rolePromote(name: string, vaultPath: string): Promise<void> {
  await reorderRole(name, vaultPath, +1);
}

export async function roleDemote(name: string, vaultPath: string): Promise<void> {
  await reorderRole(name, vaultPath, -1);
}

async function reorderRole(name: string, vaultPath: string, delta: 1 | -1): Promise<void> {
  const cfg = await loadConfig(vaultPath, {});
  const roles = cfg.roles;
  const i = roles.indexOf(name);
  if (i === -1) throw new Error(`Role '${name}' is not configured (${roles.join(", ") || "empty"}).`);
  if (i === 0) throw new Error(`Can't reorder '${name}'; it's the default role.`);

  const j = i + delta;
  if (j < 1 || j >= roles.length) {
    throw new Error(`'${name}' is already at the ${delta > 0 ? "highest" : "lowest non-default"} rank.`);
  }
  [roles[i], roles[j]] = [roles[j]!, roles[i]!];
  await saveConfig(vaultPath, cfg);

  const action = delta > 0 ? "Promoted" : "Demoted";
  console.log(`${action} '${name}' to rank ${j} of ${roles.length - 1}.`);
  console.log(`  New order: ${roles.join(" < ")}`);
}

export async function roleList(vaultPath: string): Promise<void> {
  const cfg = await loadConfig(vaultPath, {});
  if (cfg.roles.length === 0) {
    console.log("No roles configured. Run `vaults role add <name>` to add one.");
    return;
  }
  console.log("Roles (lowest → highest):");
  cfg.roles.forEach((r, i) => {
    const isDefault = i === 0;
    const hasPw = cfg.rolePasswords[r] != null;
    const tag = isDefault ? " (default, public)" : hasPw ? "" : " (no password set!)";
    console.log(`  ${r}${tag}`);
  });
}

async function readPassword(): Promise<string> {
  const isTty = !!stdin.isTTY;
  if (!isTty) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    const pw = lines[0] ?? "";
    const confirm = lines[1] ?? "";
    if (!pw) throw new Error("Empty password.");
    if (pw !== confirm) throw new Error("Passwords don't match.");
    return pw;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const pw = await maskedRead(rl, "Password: ");
    if (!pw) throw new Error("Empty password.");
    const confirm = await maskedRead(rl, "Confirm:  ");
    if (pw !== confirm) throw new Error("Passwords don't match.");
    return pw;
  } finally {
    rl.close();
  }
}

async function maskedRead(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  stdout.write(prompt);
  const realWrite = stdout.write.bind(stdout);
  let muted = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stdout as any).write = ((chunk: unknown, ...rest: unknown[]) =>
    muted ? true : realWrite(chunk as never, ...rest as [])) as typeof realWrite;
  try {
    return await rl.question("");
  } finally {
    muted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stdout as any).write = realWrite;
    stdout.write("\n");
  }
}
