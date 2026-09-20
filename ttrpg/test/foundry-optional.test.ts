// `foundry.enabled: false` drops the Foundry integration from a deploy.
//
// `_foundry/` holds the grafts.json a reader imports and the asset zips it
// names. A course site or a research wiki has no use for either, and shouldn't
// be serving them.
//
// Default is true, so existing vaults are unaffected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../../cli/src/build.js";
import { writeSettingsFile } from "../../cli/test/settings-helpers.js";
import type { TtrpgSettings } from "../src/foundry-settings.js";

async function build(settings: string, extra: Record<string, string | Buffer> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-fo-"));
  const out = join(dir, "_out");
  const files = {
    "settings.md": `---\nimage_quality: 0\n${settings}---\n`,
    "index.md": "---\ntitle: Home\n---\nBody.\n",
    ...extra,
  };
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, c);
  }
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { await buildSite({ vaultPath: dir, outputDir: out }); }
  finally { console.log = origLog; console.warn = origWarn; }
  return out;
}

/** A one-pixel PNG, so a page has media for the entry list to name. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

const exists = (p: string) => stat(p).then(() => true, () => false);

describe("foundry.enabled: false", () => {
  it("omits the entry list a reader would build from", async () => {
    const out = await build("foundry:\n  enabled: false\n");
    assert.equal(await exists(join(out, "_foundry/grafts.json")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("ships one by default", async () => {
    // Default is on: a vault that never heard of this setting keeps working.
    const out = await build("");
    assert.equal(await exists(join(out, "_foundry/grafts.json")), true);
    await rm(out, { recursive: true, force: true });
  });

  it("names media only once the vault knows its own URL", async () => {
    // An asset source is absolute, so a deploy that cannot say where it lives
    // would name files pointing at nothing.
    const withArt = { "a.png": png, "index.md": "---\ntitle: Home\n---\n![[a.png]]\n" };
    const read = async (out: string) =>
      JSON.parse(await readFile(join(out, "_foundry/grafts.json"), "utf8")) as
        { assets?: { http: { auth?: Record<string, string>; files: Array<{ source: string | string[] }> } } };

    const without = await build("", withArt);
    assert.equal((await read(without)).assets, undefined);

    const withUrl = await build('site_url: "https://v.example.com"\nzip_assets: 0\n', withArt);
    const files = (await read(withUrl)).assets?.http.files;
    assert.ok(files?.length, "a vault with a URL still named no media");
    assert.match(files[0]!.source as string, /^https:\/\/v\.example\.com\//);
    // Without a version the URL never changes when the image does, and a
    // re-import keeps the old one forever.
    assert.match(files[0]!.source as string, /\?v=[0-9a-f]{16}$/);
    // The middleware fills these slots in; only the build knows the deploy's own origin.
    assert.deepEqual((await read(withUrl)).assets?.http.auth, { "https://v.example.com": "" });
    await rm(without, { recursive: true, force: true });
    await rm(withUrl, { recursive: true, force: true });
  });

  it("leaves the rest of the deploy untouched", async () => {
    const out = await build("foundry:\n  package: none\n");
    for (const f of ["index.html", "index.body.html", "_search-index.json", "styles.css"]) {
      assert.equal(await exists(join(out, f)), true, `${f} must still ship`);
    }
    await rm(out, { recursive: true, force: true });
  });

});

describe("the Function of a two-role deploy", () => {
  const TWO_ROLES = { ".vaultrc.json": JSON.stringify({ roles: ["public", "dm"], rolePasswords: { dm: "100000:0000:0000" } }) };
  const middleware = (out: string) => readFile(join(out, "functions/_middleware.js"), "utf8");

  it("serves the entry list only when the build wrote one", async () => {
    assert.match(await middleware(await build("", TWO_ROLES)), /"path":"\/_foundry\/grafts\.json"/);
    assert.doesNotMatch(await middleware(await build("foundry:\n  enabled: false\n", TWO_ROLES)), /_foundry/);
  });
});

describe("the foundry block", () => {
  it("takes defaults for the keys a vault does not state", async () => {
    const { loadSettings } = await import("../../cli/src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeSettingsFile(dir, "foundry:\n  player_role: dm\n");
    const { values, warnings } = await loadSettings(dir);
    assert.equal((values as TtrpgSettings).foundry.player_role, "dm");
    assert.equal((values as TtrpgSettings).foundry.enabled, true, "unstated keys keep their default");
    assert.deepEqual(warnings, []);
  });

  it("names a misspelled subkey instead of reading it as unset", async () => {
    // The generic type check only asks whether it is an object. Without this a
    // typo reads as an absent key, which is a default rather than a mistake —
    // `player_roll: dm` would silently share nothing.
    const { loadSettings, writeSettings } = await import("../../cli/src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeSettingsFile(dir, "foundry:\n  player_roll: dm\n  system: pf2e\n");
    const { values, warnings } = await loadSettings(dir);
    assert.match(warnings.join("\n"), /unknown key 'foundry\.player_roll'/);
    assert.equal((values as TtrpgSettings).foundry.player_role, "");

    // Kept, after the keys the block does know, and stable from then on.
    await writeSettings(dir, values);
    const again = await loadSettings(dir);
    assert.deepEqual(Object.keys((again.values as TtrpgSettings).foundry),
      ["enabled", "player_role", "system", "core_version", "player_roll"]);
    assert.equal(again.changed, false);
  });

  it("turns the integration off, which is what stops a grafts.json being written", async () => {
    const { loadSettings } = await import("../../cli/src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeSettingsFile(dir, "foundry:\n  enabled: false\n");
    const { values, warnings } = await loadSettings(dir);
    assert.equal((values as TtrpgSettings).foundry.enabled, false);
    assert.deepEqual(warnings, []);
  });
});

describe("zip_assets", () => {
  const art = { "a.png": png, "b.png": png, "index.md": "---\ntitle: Home\n---\n![[a.png]]\n![[b.png]]\n" };
  const read = async (out: string) =>
    JSON.parse(await readFile(join(out, "_foundry/grafts.json"), "utf8")) as
      { assets: { http: { files: Array<{ source: string | string[] }> } } };

  it("lists each file's zip member first and its own URL after, when on", async () => {
    const out = await build('site_url: "https://v.example.com"\nzip_assets: 10\n', art);
    const { files } = (await read(out)).assets.http;
    for (const file of files) {
      assert.ok(Array.isArray(file.source), "a zipped file offered only one source");
      assert.match(file.source[0]!, /\/_foundry\/assets-[0-9a-f]{16}\.zip#/);
      assert.match(file.source[1]!, /\?v=[0-9a-f]{16}$/, "the fallback lost its version");
    }
    const zipName = (files[0]!.source as string[])[0]!.split("/_foundry/")[1]!.split("#")[0]!;
    assert.equal(await exists(join(out, "_foundry", zipName)), true, "the zip it names was not written");
    await rm(out, { recursive: true, force: true });
  });

  it("zips by default, since a host that rate-limits refuses the later files of an import that fetches each one", async () => {
    const out = await build('site_url: "https://v.example.com"\n', art);
    const { files } = (await read(out)).assets.http;
    assert.ok(files.every((f) => Array.isArray(f.source)));
    await rm(out, { recursive: true, force: true });
  });

  it("writes no zip and lists a single URL when set to 0", async () => {
    const out = await build('site_url: "https://v.example.com"\nzip_assets: 0\n', art);
    const { files } = (await read(out)).assets.http;
    assert.ok(files.every((f) => typeof f.source === "string"));
    assert.equal((await readdir(join(out, "_foundry"))).some((f) => f.endsWith(".zip")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("refuses a size Pages would not deploy, and falls back to off", async () => {
    const { loadSettings } = await import("../../cli/src/settings.js");
    const dir = await mkdtemp(join(tmpdir(), "vaults-settings-"));
    await writeSettingsFile(dir, "zip_assets: 40\n");
    const { values, warnings } = await loadSettings(dir);
    assert.equal((values as TtrpgSettings).zip_assets, 0);
    assert.match(warnings.join("\n"), /between 0 and 25/);
  });
});

/** Build and return the warnings, since that is what is under test here. */
async function warningsFrom(settings: string, page = "Body.\n"): Promise<{ out: string; warnings: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "vault-su-"));
  const out = join(dir, "_out");
  await writeSettingsFile(dir, `image_quality: 0\n${settings}`);
  await writeFile(join(dir, "index.md"), page.startsWith("---") ? page : `---\ntitle: Home\n---\n${page}`);
  const warnings: string[] = [];
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {};
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  try { await buildSite({ vaultPath: dir, outputDir: out }); }
  finally { console.log = origLog; console.warn = origWarn; }
  return { out, warnings };
}

describe("site_url with the Foundry integration on", () => {
  it("says so when there is no URL for the entry list to fetch media from", async () => {
    // Every asset source is absolute, so without a site_url the entry list
    // names no files and a build in Foundry arrives with no art.
    const { out, warnings } = await warningsFrom("site_url: \"\"\n");
    assert.match(warnings.join("\n"), /site_url is not set, so the Foundry entry list names no media/);
    await rm(out, { recursive: true, force: true });
  });

  it("is quiet once one is set", async () => {
    const { out, warnings } = await warningsFrom("site_url: \"https://notes.example.com\"\n");
    assert.doesNotMatch(warnings.join("\n"), /site_url is not set/);
    assert.equal(await exists(join(out, "_foundry/grafts.json")), true);
    await rm(out, { recursive: true, force: true });
  });

  it("stays quiet when the integration is off", async () => {
    const { out, warnings } = await warningsFrom("site_url: \"\"\nfoundry:\n  enabled: false\n");
    assert.doesNotMatch(warnings.join("\n"), /site_url is not set/);
    await rm(out, { recursive: true, force: true });
  });
});

describe("foundry.core_version", () => {
  const ACTOR = "---\ntitle: Home\nfoundry:\n  source: Actor:npc\n---\nBody.\n";
  const SITE = "site_url: \"https://notes.example.com\"\n";

  it("is asked for when a page builds a document and no version is set", async () => {
    const { out, warnings } = await warningsFrom(SITE, ACTOR);
    assert.match(warnings.join("\n"), /foundry\.core_version is not set/);
    await rm(out, { recursive: true, force: true });
  });

  it("is not asked for once set, or when no page builds a document", async () => {
    const set = await warningsFrom(`${SITE}foundry:\n  core_version: '14.359'\n`, ACTOR);
    assert.doesNotMatch(set.warnings.join("\n"), /core_version is not set/);
    const journalOnly = await warningsFrom(SITE);
    assert.doesNotMatch(journalOnly.warnings.join("\n"), /core_version is not set/);
    await rm(set.out, { recursive: true, force: true });
    await rm(journalOnly.out, { recursive: true, force: true });
  });
});

describe("the assets block", () => {
  it("lists what the vault serves beside what Moulinette supplies", async () => {
    const out = await build('site_url: "https://v.example.com"\n', {
      "a.png": png,
      "index.md": "---\ntitle: Home\n---\n![[a.png]]\n",
      "Scenes/Yard.md": '---\nfoundry:\n  source: "@moulinette/13648/json/scene/yard.json"\n  type: Scene\n---\nYard.\n',
    });
    const { assets } = JSON.parse(await readFile(join(out, "_foundry/grafts.json"), "utf8")) as
      { assets: { http?: { files: unknown[] }; moulinette?: { files: unknown[] } } };
    assert.ok(assets.http?.files.length, "the vault's own media was dropped");
    assert.deepEqual(assets.moulinette?.files,
      [{ source: "13648/json/scene/yard.json", destination: "graft/moulinette/13648/json/scene/yard.json" }]);
    await rm(out, { recursive: true, force: true });
  });
});
