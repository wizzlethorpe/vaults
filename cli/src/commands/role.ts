import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../auth.js";
import { loadSettings, writeSettings } from "../settings.js";

export async function roleAdd(name: string, vaultPath: string): Promise<void> {
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid role name '${name}'. Use letters, digits, '_' or '-' (must start with a letter).`);
  }

  const settings = await loadSettings(vaultPath);
  if (settings.values.roles.includes(name)) {
    throw new Error(`Role '${name}' already exists.`);
  }

  // First role added (or first ever role) is the default — no password.
  // Subsequent roles need a password to gate access.
  const isDefault = settings.values.roles.length === 0;
  settings.values.roles.push(name);

  if (!isDefault) {
    console.log(`Adding role '${name}'. Set a password to gate access:`);
    const pw = await readPassword();
    settings.values.role_passwords[name] = await hashPassword(pw);
  }

  await writeSettings(vaultPath, settings.values);
  console.log(`Added role '${name}'${isDefault ? " (default)" : ""}.`);
  console.log(`  Mark pages with 'role: ${name}' frontmatter or callouts with '> [!${name}]' to gate them.`);
}

export async function roleRemove(name: string, vaultPath: string): Promise<void> {
  const settings = await loadSettings(vaultPath);
  if (!settings.values.roles.includes(name)) {
    throw new Error(`Role '${name}' is not in settings.roles (${settings.values.roles.join(", ") || "empty"}).`);
  }
  if (settings.values.roles[0] === name && settings.values.roles.length > 1) {
    throw new Error(`Can't remove '${name}' — it's the default role. Remove the other roles first or reorder them in settings.md.`);
  }

  settings.values.roles = settings.values.roles.filter((r) => r !== name);
  delete settings.values.role_passwords[name];
  await writeSettings(vaultPath, settings.values);
  console.log(`Removed role '${name}'.`);
  console.log(`  Pages tagged 'role: ${name}' will fall back to the default role on next build.`);
}

export async function roleList(vaultPath: string): Promise<void> {
  const settings = await loadSettings(vaultPath);
  if (settings.values.roles.length === 0) {
    console.log("No roles configured. Run `vaults role add <name>` to add one.");
    return;
  }
  console.log("Roles (lowest → highest):");
  settings.values.roles.forEach((r, i) => {
    const isDefault = i === 0;
    const hasPw = settings.values.role_passwords[r] != null;
    const tag = isDefault ? " (default, public)" : hasPw ? "" : " (no password set!)";
    console.log(`  ${r}${tag}`);
  });
}

async function readPassword(): Promise<string> {
  const isTty = !!stdin.isTTY;
  if (!isTty) {
    // Piped input: read all upfront, dispense lines (matches password.ts).
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    const pw = lines[0] ?? "";
    const confirm = lines[1] ?? "";
    if (!pw) throw new Error("Empty password.");
    if (pw !== confirm) throw new Error("Passwords don't match.");
    return pw;
  }

  // TTY: mask via stdout muting trick.
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
    const answer = await rl.question("");
    return answer;
  } finally {
    muted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stdout as any).write = realWrite;
    stdout.write("\n");
  }
}
