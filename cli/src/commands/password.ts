import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../auth.js";
import { loadSettings, writeSettings } from "../settings.js";

interface PasswordOptions {}

export async function password(vaultPath: string, role: string, _opts: PasswordOptions): Promise<void> {
  const settings = await loadSettings(vaultPath);

  if (settings.values.roles.length === 0) {
    throw new Error("settings.roles is empty — run `vaults init` or add roles to settings.md first.");
  }
  if (!settings.values.roles.includes(role)) {
    throw new Error(`Role '${role}' is not in settings.roles (${settings.values.roles.join(", ")}). Add it to settings.md first.`);
  }
  if (settings.values.roles[0] === role) {
    throw new Error(`'${role}' is the default (lowest) role; it doesn't need a password.`);
  }

  const isTty = !!stdin.isTTY;
  const reader = isTty ? interactiveReader() : await pipedReader();

  const pw = await reader.read(`Password for role '${role}': `, isTty);
  if (!pw) throw new Error("Empty password.");
  const confirm = await reader.read(`Confirm: `, isTty);
  if (pw !== confirm) throw new Error("Passwords don't match.");
  reader.close();

  const encoded = await hashPassword(pw);
  settings.values.role_passwords[role] = encoded;
  await writeSettings(vaultPath, settings.values);
  console.log(`\nUpdated settings.md with hash for '${role}'.`);
  console.log("On next `vaults push`, this hash will be deployed to the Function.");
}

interface Reader {
  read(question: string, mask: boolean): Promise<string>;
  close(): void;
}

/** Read entire stdin upfront, then dispense lines on demand. Works after EOF. */
async function pipedReader(): Promise<Reader> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  let i = 0;
  return {
    read: async (q) => {
      stdout.write(q);
      const line = lines[i++] ?? "";
      stdout.write(line + "\n");
      return line;
    },
    close: () => {},
  };
}

function interactiveReader(): Reader {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    read: async (q, mask) => {
      if (!mask) return rl.question(q);
      // Mask: write the prompt, mute stdout while readline is reading,
      // then restore it. Echoed keystrokes are suppressed.
      stdout.write(q);
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
    },
    close: () => rl.close(),
  };
}
