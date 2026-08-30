// Downloading a vault's files into the world, and not downloading them twice.
//
// The vault ships a content hash per file. Without one there is nothing to
// compare and a rebuild re-fetches everything; with one, the expensive half of
// a build (a hundred images over a network, then back up through Foundry's
// upload) happens only for bytes that actually changed. Comparing anything
// weaker than content — the path, or whether a file is simply there — leaves a
// regenerated portrait stale under its old name with nothing saying so.

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { placeAssets } from "../scripts/assets.mjs";

const vault = { url: "https://v.example.com", gated: false };
const wanted = new Map([["DM", new Set(["attachments/marlo.webp"])]]);
const KEY = "DM/attachments/marlo.webp";

let downloaded;
let uploaded;
let saved;
let saveRestore;

function stubFoundry(recorded) {
  downloaded = [];
  uploaded = [];
  saved = null;
  globalThis.game = { world: { id: "w" } };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}` } };
  globalThis.FilePicker = {
    implementation: {
      createDirectory: async () => {},
      upload: async (_where, dir, file) => {
        if (file.name === "placed.json") saved = JSON.parse(await file.text());
        else uploaded.push(`${dir}/${file.name}`);
        return { status: "success" };
      },
    },
  };
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes("placed.json")) {
      return recorded
        ? { ok: true, json: async () => recorded }
        : { ok: false, status: 404 };
    }
    downloaded.push(url);
    return { ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }) };
  };
}

describe("placeAssets", () => {
  beforeEach(() => { saveRestore = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = saveRestore; });

  test("skips a file already here at the same hash, and still resolves it", async () => {
    stubFoundry({ [KEY]: "abc123" });
    const { placed, failed } = await placeAssets(vault, "v", wanted, null, { [KEY]: "abc123" });
    assert.deepEqual(downloaded, []);
    assert.deepEqual(uploaded, []);
    assert.equal(placed.get(KEY), "/worlds/w/vaults-cache/v/DM/attachments/marlo.webp");
    assert.deepEqual(failed, []);
  });

  test("re-fetches a file whose hash moved, which is a regenerated portrait", async () => {
    // Same name, same path, different bytes. The case an exists-on-disk check
    // gets wrong, silently and permanently.
    stubFoundry({ [KEY]: "old000" });
    const { placed } = await placeAssets(vault, "v", wanted, null, { [KEY]: "new111" });
    assert.equal(downloaded.length, 1);
    assert.equal(uploaded.length, 1);
    assert.equal(placed.get(KEY), "/worlds/w/vaults-cache/v/DM/attachments/marlo.webp");
  });

  test("fetches when the vault named no hash for the path", async () => {
    stubFoundry({ [KEY]: "abc123" });
    await placeAssets(vault, "v", wanted, null, {});
    assert.equal(downloaded.length, 1);
  });

  test("fetches when this world has no record at all", async () => {
    stubFoundry(null);
    await placeAssets(vault, "v", wanted, null, { [KEY]: "abc123" });
    assert.equal(downloaded.length, 1);
  });

  test("records what it placed, so the next build can skip it", async () => {
    stubFoundry(null);
    await placeAssets(vault, "v", wanted, null, { [KEY]: "abc123" });
    assert.deepEqual(saved, { [KEY]: "abc123" });
  });

  test("writes no record when there was nothing new to record", async () => {
    stubFoundry({ [KEY]: "abc123" });
    await placeAssets(vault, "v", wanted, null, { [KEY]: "abc123" });
    assert.equal(saved, null);
  });

  test("counts a skipped file towards progress, so the bar still finishes", async () => {
    stubFoundry({ [KEY]: "abc123" });
    const seen = [];
    await placeAssets(vault, "v", wanted, (name) => seen.push(name), { [KEY]: "abc123" });
    assert.deepEqual(seen, ["marlo.webp"]);
  });
});
