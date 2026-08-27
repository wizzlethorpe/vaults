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
