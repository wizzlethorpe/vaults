import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The executable of the wrangler this package depends on. */
function wranglerBin(): string {
  const manifest = require.resolve("wrangler/package.json");
  const { bin } = require(manifest) as { bin: Record<string, string> };
  return join(dirname(manifest), bin["wrangler"]!);
}

/** Run this package's own wrangler. `npx wrangler` runs whichever copy it finds, or fails to run one inside a pnpm workspace. */
export function spawnWrangler(args: string[], options: SpawnOptions): ChildProcess {
  return spawn(process.execPath, [wranglerBin(), ...args], options);
}

/** Whether `wrangler whoami --json` says somebody is signed in. Output that is not its JSON is a failure to ask, and throws. */
export function signedIn(whoamiJson: string): boolean {
  const { loggedIn } = JSON.parse(whoamiJson) as { loggedIn?: unknown };
  if (typeof loggedIn !== "boolean") throw new Error("wrangler whoami did not say whether anyone is signed in");
  return loggedIn;
}
