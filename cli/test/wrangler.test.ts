import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { signedIn, spawnWrangler } from "../src/wrangler.js";

describe("spawnWrangler", () => {
  it("runs the CLI's own wrangler from a directory with none anywhere near it", async () => {
    const proc = spawnWrangler(["--version"], { cwd: tmpdir(), stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    proc.stdout!.on("data", (d) => { out += String(d); });
    const code = await new Promise((resolve, reject) => { proc.on("exit", resolve); proc.on("error", reject); });
    assert.equal(code, 0);
    assert.match(out.trim(), /^\d+\.\d+\.\d+$/);
  });
});

describe("signedIn", () => {
  it("reads wrangler's own answer, which it prints signed in or not", () => {
    assert.equal(signedIn('{"loggedIn":true,"email":"a@example.com","accounts":[]}'), true);
    assert.equal(signedIn('{"loggedIn":false}\n'), false);
  });

  it("does not take a failure to ask for being signed out", () => {
    assert.throws(() => signedIn(""), SyntaxError);
    assert.throws(() => signedIn("sh: 1: wrangler: not found"), SyntaxError);
    assert.throws(() => signedIn("{}"), /did not say whether anyone is signed in/);
  });
});
