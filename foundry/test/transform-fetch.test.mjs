// The entry list is fetched with the reader's credential.
//
// Fetched without one, this does not fail. The vault answers with the entry
// list for someone who is not signed in — a real list, of real entries, just
// the public half. The GM gets their players' view of the vault and nothing
// anywhere says the rest exists. That silence is why this is pinned: a build
// that produced 26 of 53 entries looked like a complete success.

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { url } from "../scripts/api.mjs";
import { substituteRefs } from "../scripts/refs.mjs";

describe("vault URLs carry the bearer", () => {
  test("a token rides as a query param, so cross-origin GETs stay preflight-free", () => {
    const u = new URL(url({ url: "https://v.example.com", token: "abc.123" }, "/_foundry/grafts.json"));
    assert.equal(u.pathname, "/_foundry/grafts.json");
    assert.equal(u.searchParams.get("_token"), "abc.123");
  });

  test("no token means no param, rather than an empty one", () => {
    const u = new URL(url({ url: "https://v.example.com" }, "/_foundry/grafts.json"));
    assert.equal(u.searchParams.has("_token"), false);
  });

  test("survives a vault URL with a trailing slash", () => {
    assert.equal(
      new URL(url({ url: "https://v.example.com/" }, "/_foundry/grafts.json")).pathname,
      "/_foundry/grafts.json");
  });
});

describe("fetchEntries", () => {
  const calls = [];
  let original;

  beforeEach(() => {
    calls.length = 0;
    original = globalThis.fetch;
    globalThis.fetch = async (u) => {
      calls.push(String(u));
      return { ok: true, json: async () => ({ format: 1, entries: [{ id: "a", pack: "p", patch: {} }] }) };
    };
  });
  afterEach(() => { globalThis.fetch = original; });

  test("asks for the entry list as the signed-in reader", async () => {
    const { __test } = await import("../scripts/transform.mjs");
    await __test.fetchEntries({ url: "https://v.example.com", token: "tok", gated: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /_token=tok/);
  });

  test("reports the status when the vault refuses", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    const { __test } = await import("../scripts/transform.mjs");
    await assert.rejects(
      () => __test.fetchEntries({ url: "https://v.example.com", token: "bad", gated: true }),
      /403/);
  });

  test("carries the asset hashes back with the entries", async () => {
    // What lets a rebuild skip a file it already has. Absent, every build
    // re-downloads every image.
    const { __test } = await import("../scripts/transform.mjs");
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ format: 1, entries: [], assets: { "DM/a.webp": "abc123" } }),
    });
    const { assets } = await __test.fetchEntries({ url: "https://v.example.com", gated: false });
    assert.deepEqual(assets, { "DM/a.webp": "abc123" });
  });

  test("treats a vault that named no assets as naming none", async () => {
    const { __test } = await import("../scripts/transform.mjs");
    const { assets } = await __test.fetchEntries({ url: "https://v.example.com", gated: false });
    assert.deepEqual(assets, {});
  });

  test("rejects a body that is not an entry list", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ nope: true }) });
    const { __test } = await import("../scripts/transform.mjs");
    await assert.rejects(
      () => __test.fetchEntries({ url: "https://v.example.com", gated: false }),
      /no entries/);
  });
});


describe("resolving to a fixed point", () => {
  // References nest: a body is a reference, and its images are named inside
  // the HTML it resolves to. These drive the real resolveRefs with its IO
  // injected: `serve` maps raw references to what fetching them returns, and
  // `passes` counts the rounds the loop actually took.
  async function resolveAll(entries, serve) {
    const { __test } = await import("../scripts/transform.mjs");
    const lookup = new Map(Object.entries(serve).map(([raw, value]) => {
      const rest = raw.slice("@vaults/".length);
      const slash = rest.indexOf("/");
      return [`${rest.slice(0, slash)}\u0000${decodeURIComponent(rest.slice(slash + 1))}`, value];
    }));
    let passes = 0;
    const io = {
      fetchSourceBatch: async (_vault, list, variant) => {
        passes++;
        return new Map(list
          .filter((path) => lookup.has(`${variant ?? "dm"}\u0000${path}`))
          .map((path) => [path, lookup.get(`${variant ?? "dm"}\u0000${path}`)]));
      },
      placeAssets: async (_vault, _vaultId, wanted) => {
        passes++;
        const placed = new Map();
        const failed = [];
        for (const [variant, paths] of wanted) {
          for (const path of paths) {
            const hit = lookup.get(`${variant}\u0000${path}`);
            if (hit) placed.set(`${variant}/${path}`, hit);
            else failed.push({ id: `${variant}/${path}`, reason: "not served by the vault" });
          }
        }
        return { placed, failed };
      },
    };
    const { resolved, warnings } = await __test.resolveRefs(
      { url: "https://v.example.com", gated: true }, "v", entries, {}, io);
    return { out: substituteRefs(entries, resolved), passes, warnings };
  }

  const BODY = "@vaults/dm/Actors/Cassius Marlo.foundry.html";
  const IMG = "@vaults/dm/attachments/Cassius%20Marlo.webp";

  test("reaches an image named inside a body, leaving no marker behind", async () => {
    const { out } = await resolveAll([{ text: { content: BODY } }], {
      [BODY]: `<p><img src="${IMG}"></p>`,
      [IMG]: "/worlds/w/cache/Cassius%20Marlo.webp",
    });
    assert.equal(out[0].text.content, '<p><img src="/worlds/w/cache/Cassius%20Marlo.webp"></p>');
  });

  test("takes exactly the passes the nesting needs", async () => {
    const flat = await resolveAll([{ img: IMG }], { [IMG]: "/local.webp" });
    assert.equal(flat.passes, 1);
    const nested = await resolveAll([{ text: { content: BODY } }], {
      [BODY]: `<img src="${IMG}">`, [IMG]: "/local.webp",
    });
    assert.equal(nested.passes, 2);
  });

  test("would follow a deeper nesting without being told to", async () => {
    const A = "@vaults/dm/a.foundry.html", B = "@vaults/dm/b.foundry.html";
    const { out, passes } = await resolveAll([{ text: { content: A } }], {
      [A]: `<p>${B}</p>`, [B]: `<img src="${IMG}">`, [IMG]: "/local.webp",
    });
    assert.equal(out[0].text.content, '<p><img src="/local.webp"></p>');
    assert.equal(passes, 3);
  });

  test("settles when something cannot be fetched, rather than asking again", async () => {
    // Asked for once. Otherwise a missing file is requested every pass and the
    // loop never ends.
    const { out, passes, warnings } = await resolveAll([{ img: "@vaults/dm/missing.webp" }], {});
    assert.equal(out[0].img, "@vaults/dm/missing.webp", "left legible");
    assert.equal(passes, 1);
    assert.ok(warnings.some((w) => /not served/.test(w.reason)), "and says so");
  });

  test("does not grow a body that references itself", async () => {
    const { out, passes } = await resolveAll([{ text: { content: BODY } }], {
      [BODY]: `<p>see ${BODY}</p>`,
    });
    assert.equal(out[0].text.content, `<p>see ${BODY}</p>`);
    assert.ok(passes <= 2, `settled in ${passes} passes`);
  });
});

describe("reporting progress", () => {
  // Fetching a vault is the slow part of a build, and it all happens before
  // graft has an entry to count — so the bar sat at 0% for a minute or more
  // with nothing to distinguish a slow build from a stuck one.
  let saved;
  const calls = [];

  beforeEach(() => {
    saved = globalThis.game;
    globalThis.game = {
      modules: new Map([["graft", { api: { progress: {
        phase: (name, count) => calls.push(["phase", name, count]),
        step: (msg) => calls.push(["step", msg]),
        note: (msg) => calls.push(["note", msg]),
      } } }]]),
    };
    calls.length = 0;
  });
  afterEach(() => { globalThis.game = saved; });

  test("names a phase and its size before the slow part starts", async () => {
    const { __test } = await import("../scripts/transform.mjs");
    const ui = __test.bar();
    ui.phase("Downloading assets", 42);
    assert.deepEqual(calls[0], ["phase", "Downloading assets", 42]);
  });

  test("advances one step per file", async () => {
    const { __test } = await import("../scripts/transform.mjs");
    const ui = __test.bar();
    ui.step("Cassius Marlo.webp");
    assert.deepEqual(calls[0], ["step", "Cassius Marlo.webp"]);
  });

  test("is a no-op when graft exposes no bar, rather than failing the build", async () => {
    // An older graft, or one whose API moved. A missing progress bar must cost
    // the bar and nothing else.
    globalThis.game = { modules: new Map([["graft", { api: {} }]]) };
    const { __test } = await import("../scripts/transform.mjs");
    assert.doesNotThrow(() => { __test.bar().phase("x", 1); __test.bar().step("y"); });
  });

  test("survives graft not being there at all", async () => {
    globalThis.game = { modules: new Map() };
    const { __test } = await import("../scripts/transform.mjs");
    assert.doesNotThrow(() => __test.bar().step("y"));
  });

  test("survives a bar that throws", async () => {
    globalThis.game = { modules: new Map([["graft", { api: { progress: {
      phase() { throw new Error("notification API changed"); },
      step() { throw new Error("notification API changed"); },
    } } }]]) };
    const { __test } = await import("../scripts/transform.mjs");
    assert.doesNotThrow(() => { __test.bar().phase("x", 1); __test.bar().step("y"); });
  });
});
