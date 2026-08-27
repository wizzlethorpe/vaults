// Pack naming, which is load-bearing in two directions: sync writes into
// these names, and every wikilink and description embed a page produces spells
// one out as part of a Compendium UUID. A rename is not a cosmetic change; it
// orphans every document already synced and breaks every link pointing at one.

import test from "node:test";
import assert from "node:assert/strict";

import { packName, packCollection, getPack, vaultPacks } from "../scripts/packs.mjs";

const VAULT = { id: "marlo-mystery-4ec31e8c", label: "Marlo Mystery" };

test("a pack is named <vault id>-<type key>", () => {
  assert.equal(packName(VAULT, "JournalEntry"), "marlo-mystery-4ec31e8c-journal");
  assert.equal(packName(VAULT, "Actor"), "marlo-mystery-4ec31e8c-actors");
  assert.equal(packName(VAULT, "RollTable"), "marlo-mystery-4ec31e8c-tables");
});

test("the collection id is world-scoped", () => {
  assert.equal(packCollection(VAULT, "Scene"), "world.marlo-mystery-4ec31e8c-scenes");
});

test("a document type with no pack answers null rather than a broken name", () => {
  // Reached through `foundry.base` naming something outside PACK_KEY. A
  // template-literal name would produce "…-undefined", which is a legal pack
  // name and so would be created and written to.
  assert.equal(packName(VAULT, "ActiveEffect"), null);
  assert.equal(packCollection(VAULT, "ActiveEffect"), null);
});

test("two vaults never share a pack", () => {
  const other = { id: "southaven-91b2cc04", label: "Southaven" };
  assert.notEqual(packName(VAULT, "Actor"), packName(other, "Actor"));
});

test("a pack that does not exist reads as absent, not as an error", () => {
  // getPack runs during the drift check, which must not create packs as a
  // side effect of asking whether a document is missing.
  const prev = globalThis.game;
  globalThis.game = { packs: new Map() };
  try {
    assert.equal(getPack(VAULT, "Actor"), null);
    assert.deepEqual(vaultPacks(VAULT), []);
  } finally { globalThis.game = prev; }
});

test("vaultPacks lists only the vault's own packs that exist", () => {
  const prev = globalThis.game;
  const mine = { collection: "world.marlo-mystery-4ec31e8c-actors" };
  globalThis.game = {
    packs: new Map([
      ["world.marlo-mystery-4ec31e8c-actors", mine],
      ["world.southaven-91b2cc04-actors", { collection: "world.southaven-91b2cc04-actors" }],
      ["dnd5e.monsters", { collection: "dnd5e.monsters" }],
    ]),
  };
  try {
    assert.deepEqual(vaultPacks(VAULT), [mine]);
  } finally { globalThis.game = prev; }
});

// ── the UUIDs every link and embed is made of ────────────────────────────────

test("a journal page UUID names the vault's journal pack", async () => {
  const { journalPageUuid } = await import("../scripts/packs.mjs");
  assert.equal(
    journalPageUuid(VAULT, "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
    "Compendium.world.marlo-mystery-4ec31e8c-journal"
    + ".JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb",
  );
});

test("an instance UUID names the pack for that document's own type", async () => {
  const { instanceUuid } = await import("../scripts/packs.mjs");
  // Not the journal pack: an Actor page's link points at the Actor.
  assert.equal(
    instanceUuid(VAULT, "Actor", "cccccccccccccccc"),
    "Compendium.world.marlo-mystery-4ec31e8c-actors.Actor.cccccccccccccccc",
  );
});

test("a wikilink resolves to the journal page, and a doc-target to the document", async () => {
  // targetUuid is what every inbound wikilink becomes. The two branches are
  // the whole reason `foundry.link: doc` exists, and a wrong prefix on either
  // is a dead link that renders as ordinary text rather than failing loudly.
  const { targetUuid } = await import("../scripts/links.mjs");
  const { entryId, pageId, instanceId } = await import("../scripts/ids.mjs");
  const path = "Creatures/Beefy.md";

  const journal = await targetUuid(VAULT, path, {});
  assert.equal(journal, `Compendium.world.${VAULT.id}-journal.JournalEntry.`
    + `${await entryId(VAULT.id, path)}.JournalEntryPage.${await pageId(VAULT.id, path)}`);

  const doc = await targetUuid(VAULT, path, { docTargets: new Map([[path, "Actor"]]) });
  assert.equal(doc, `Compendium.world.${VAULT.id}-actors.Actor.${await instanceId(VAULT.id, path)}`);
});

test("a pinned foundry.id is honoured on both branches", async () => {
  const { targetUuid } = await import("../scripts/links.mjs");
  const path = "Creatures/Beefy.md";
  const idOverrides = new Map([[path, "PINNEDPINNED1234"]]);

  assert.match(await targetUuid(VAULT, path, { idOverrides }),
    /\.JournalEntryPage\.PINNEDPINNED1234$/);
  assert.equal(await targetUuid(VAULT, path, { idOverrides, docTargets: new Map([[path, "Actor"]]) }),
    `Compendium.world.${VAULT.id}-actors.Actor.PINNEDPINNED1234`);
});

// ── pack visibility ─────────────────────────────────────────────────────────

test("a gated vault's packs are shut to players, explicitly", async () => {
  // Not assumed. An unconfigured world pack inherits CompendiumOwnershipField's
  // default of {PLAYER: "OBSERVER", ASSISTANT: "OWNER"}, and a compendium index
  // is not filtered per document — so leaving it unset publishes every DM name
  // and image in the pack to every player.
  const { ensurePack } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  let configured = null;
  const pack = {
    collection: `world.${VAULT.id}-journal`, locked: false, config: {},
    configure: async (c) => { configured = c; },
  };
  globalThis.game = { packs: new Map([[pack.collection, pack]]) };
  try {
    await ensurePack({ ...VAULT, public: false }, "JournalEntry");
    assert.equal(configured.ownership.PLAYER, "NONE");
    assert.equal(configured.ownership.TRUSTED, "NONE");
    assert.equal(configured.ownership.GAMEMASTER, "OWNER");
  } finally { globalThis.game = prev; }
});

test("an already-restricted pack is not rewritten every sync", async () => {
  const { ensurePack } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  let calls = 0;
  const pack = {
    collection: `world.${VAULT.id}-journal`, locked: false,
    config: { ownership: { GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" } },
    configure: async () => { calls++; },
  };
  globalThis.game = { packs: new Map([[pack.collection, pack]]) };
  try {
    await ensurePack({ ...VAULT, public: false }, "JournalEntry");
    assert.equal(calls, 0);
  } finally { globalThis.game = prev; }
});

test("a public vault's packs are left browsable", async () => {
  // Nothing in a public vault is withheld from anyone on the wiki, so there is
  // nothing to protect here and a GM may well want players browsing it.
  const { ensurePack } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  let configured = null;
  const pack = {
    collection: `world.${VAULT.id}-journal`, locked: false, config: {},
    configure: async (c) => { configured = c; },
  };
  globalThis.game = { packs: new Map([[pack.collection, pack]]) };
  try {
    await ensurePack({ ...VAULT, public: true }, "JournalEntry");
    assert.ok(!("PLAYER" in configured.ownership));
  } finally { globalThis.game = prev; }
});

// ── switching packaging ─────────────────────────────────────────────────────

/** A world whose packs are `names`; records which get deleted. */
function withPacks(names) {
  const deleted = [];
  const packs = new Map(names.map((n) => [`world.${n}`, {
    collection: `world.${n}`,
    deleteCompendium: async () => { deleted.push(n); },
  }]));
  globalThis.game = { packs };
  return deleted;
}

test("switching to adventure removes the per-type packs", async () => {
  // Otherwise both shapes sit in the sidebar with nothing to say which is
  // live, and the stale one never updates again.
  const { pruneStalePacks } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  const deleted = withPacks([
    `${VAULT.id}-journal`, `${VAULT.id}-actors`, `${VAULT.id}-adventure`,
  ]);
  try {
    await pruneStalePacks({ ...VAULT, foundryPackage: "adventure" });
    assert.deepEqual(deleted.sort(), [`${VAULT.id}-actors`, `${VAULT.id}-journal`]);
  } finally { globalThis.game = prev; }
});

test("switching to compendium removes the adventure pack", async () => {
  const { pruneStalePacks } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  const deleted = withPacks([`${VAULT.id}-journal`, `${VAULT.id}-adventure`]);
  try {
    await pruneStalePacks({ ...VAULT, foundryPackage: "compendium" });
    assert.deepEqual(deleted, [`${VAULT.id}-adventure`]);
  } finally { globalThis.game = prev; }
});

test("another vault's packs are never touched", async () => {
  // They are named by vault id, and this runs on every sync.
  const { pruneStalePacks } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  const deleted = withPacks([
    `${VAULT.id}-adventure`, "southaven-91b2cc04-journal", "southaven-91b2cc04-adventure",
  ]);
  try {
    await pruneStalePacks({ ...VAULT, foundryPackage: "adventure" });
    assert.deepEqual(deleted, []);
  } finally { globalThis.game = prev; }
});

test("a steady-state sync deletes nothing", async () => {
  const { pruneStalePacks } = await import("../scripts/packs.mjs");
  const prev = globalThis.game;
  const deleted = withPacks([`${VAULT.id}-adventure`]);
  try {
    await pruneStalePacks({ ...VAULT, foundryPackage: "adventure" });
    assert.deepEqual(deleted, []);
  } finally { globalThis.game = prev; }
});
