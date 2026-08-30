// Rewriting article HTML into what a Foundry journal wants.
//
// The decision worth protecting here is that a link resolves to the copy the
// graft actually built, in the pack it built it into. A UUID naming the right
// document in the wrong pack resolves cleanly enough that nobody notices until
// the two copies drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  pathFromHref, uuidFor, rewriteLinks, rewriteAssets, toFoundryHtml, rewriteVaultRefs,
  type LinkIndex,
} from "../src/foundry-html.js";

const index = (packaging: "compendium" | "adventure" = "compendium"): LinkIndex => ({
  moduleId: "my-vault",
  journalPack: "my-vault-journals",
  packaging,
  targets: new Map([
    ["Characters/Marlo.md", { entry: "ent0", page: "pg0" }],
    ["Bestiary/Wolf.md", { entry: "ent1", page: "pg1" }],
  ]),
});

const rewriteAssetsV = (h: string) => rewriteAssets(h, "public");

const link = (href: string, label = "Marlo", cls = "internal-link") =>
  `<a class="${cls}" href="${href}">${label}</a>`;

describe("pathFromHref", () => {
  it("decodes a site href back to a vault path", () => {
    assert.equal(pathFromHref("/Characters/Marlo"), "Characters/Marlo.md");
    assert.equal(pathFromHref("/Characters/Marlo.html"), "Characters/Marlo.md");
    assert.equal(pathFromHref("/Characters/Marlo%20Vex"), "Characters/Marlo Vex.md");
  });

  it("drops the fragment and query, which name a spot on a page, not a page", () => {
    assert.equal(pathFromHref("/Characters/Marlo#gear"), "Characters/Marlo.md");
    assert.equal(pathFromHref("/Characters/Marlo?v=2"), "Characters/Marlo.md");
  });

  it("leaves anything not rooted at the site alone", () => {
    assert.equal(pathFromHref("https://example.com/x"), null);
    assert.equal(pathFromHref("#section"), null);
    assert.equal(pathFromHref("/"), null);
  });

  it("survives a malformed escape rather than throwing mid-build", () => {
    assert.equal(pathFromHref("/Characters/100%"), "Characters/100%.md");
  });
});

describe("uuidFor", () => {
  it("names the imported copy under adventure packaging", () => {
    // Import creates with keepId, so the documents the GM ends up with carry
    // these ids. A Compendium UUID here would send a reader to a second copy
    // of the thing sitting beside the one they are reading.
    assert.equal(uuidFor("Characters/Marlo.md", index("adventure")),
      "JournalEntry.ent0.JournalEntryPage.pg0");
  });

  it("addresses the pack copy the graft built", () => {
    assert.equal(
      uuidFor("Characters/Marlo.md", index()),
      "Compendium.my-vault.my-vault-journals.JournalEntry.ent0.JournalEntryPage.pg0");
  });

  it("sends a link to a journal-less page to its document", () => {
    // `journal: false` means the page's prose never becomes a journal page,
    // so the document is the only thing a reader can be sent to.
    const idx = index();
    idx.targets.set("DM Notes/Scenes/Home.md",
      { doc: { type: "Scene", pack: "my-vault-scenes", id: "homeScene0000000" } });
    assert.equal(uuidFor("DM Notes/Scenes/Home.md", idx),
      "Compendium.my-vault.my-vault-scenes.Scene.homeScene0000000");
    const adv = index("adventure");
    adv.targets.set("DM Notes/Scenes/Home.md",
      { doc: { type: "Scene", pack: "my-vault-scenes", id: "homeScene0000000" } });
    assert.equal(uuidFor("DM Notes/Scenes/Home.md", adv), "Scene.homeScene0000000");
  });

  it("sends a page that also instantiates a document to its prose all the same", () => {
    assert.equal(
      uuidFor("Bestiary/Wolf.md", index()),
      "Compendium.my-vault.my-vault-journals.JournalEntry.ent1.JournalEntryPage.pg1");
  });

  it("returns nothing for a path the vault does not publish", () => {
    assert.equal(uuidFor("Secret/Hidden.md", index()), null);
  });
});

describe("rewriteLinks", () => {
  it("turns an internal link into a UUID enricher carrying its label", () => {
    assert.equal(
      rewriteLinks(link("/Characters/Marlo"), index()),
      "@UUID[Compendium.my-vault.my-vault-journals.JournalEntry.ent0.JournalEntryPage.pg0]{Marlo}");
  });

  it("keeps a link the index cannot place, since a dead UUID reads worse than a dead link", () => {
    const html = link("/Secret/Hidden", "Hidden");
    assert.equal(rewriteLinks(html, index()), html);
  });

  it("leaves an unresolved wikilink as the broken text it already is", () => {
    const html = link("/Characters/Marlo", "Marlo", "internal-link is-unresolved");
    assert.equal(rewriteLinks(html, index()), html);
  });

  it("leaves external and passthrough links alone", () => {
    for (const html of [
      `<a href="https://example.com">out</a>`,
      `<a class="passthrough-link" href="/files/map.pdf">map</a>`,
    ]) assert.equal(rewriteLinks(html, index()), html);
  });

  it("uses the visible text when the label carries markup", () => {
    const html = `<a class="internal-link" href="/Characters/Marlo"><em>Marlo</em> Vex</a>`;
    assert.match(rewriteLinks(html, index()), /\{Marlo Vex\}$/);
  });

  it("escapes braces in a label, which would close the enricher early", () => {
    const html = link("/Characters/Marlo", "Marlo {the} Vex");
    const out = rewriteLinks(html, index());
    assert.match(out, /\{Marlo &lbrace;the&rbrace; Vex\}$/);
  });

  it("emits a bare enricher when there is no label to carry", () => {
    assert.equal(
      rewriteLinks(link("/Characters/Marlo", ""), index()),
      "@UUID[Compendium.my-vault.my-vault-journals.JournalEntry.ent0.JournalEntryPage.pg0]");
  });

  it("rewrites every link in a page independently", () => {
    const html = `<p>${link("/Characters/Marlo")} and ${link("/Bestiary/Wolf", "Wolf")} and ${link("/Secret/Hidden", "Hidden")}</p>`;
    const out = rewriteLinks(html, index());
    assert.match(out, /@UUID\[.*JournalEntryPage\.pg0\]\{Marlo\}/);
    assert.match(out, /@UUID\[.*JournalEntryPage\.pg1\]\{Wolf\}/);
    assert.match(out, /href="\/Secret\/Hidden"/);
  });
});

describe("rewriteAssets", () => {
  it("marks media so the provider can place it wherever it lands", () => {
    assert.equal(
      rewriteAssetsV(`<img src="/attachments/map.webp">`),
      `<img src="@vaults/public/attachments/map.webp">`);
    assert.match(rewriteAssetsV(`<audio src="/a/x.ogg"></audio>`), /@vaults\/public\/a\/x\.ogg/);
    assert.match(rewriteAssetsV(`<video src="/v/x.webm"></video>`), /@vaults\/public\/v\/x\.webm/);
  });

  it("keeps the tag's other attributes", () => {
    assert.equal(
      rewriteAssetsV(`<img alt="Map" src="/a/map.webp" width="400">`),
      `<img alt="Map" src="@vaults/public/a/map.webp" width="400">`);
  });

  it("leaves media already hosted elsewhere alone", () => {
    for (const html of [
      `<img src="https://example.com/x.png">`,
      `<img src="data:image/png;base64,AAA">`,
    ]) assert.equal(rewriteAssetsV(html), html);
  });

  it("marks passthrough links, so a PDF opens inside Foundry too", () => {
    assert.match(
      rewriteAssetsV(`<a class="passthrough-link" href="/files/map.pdf">Map</a>`),
      /href="@vaults\/public\/files\/map\.pdf"/);
  });

  it("leaves internal links to the link rewriter", () => {
    const html = link("/Characters/Marlo");
    assert.equal(rewriteAssetsV(html), html);
  });
});

describe("toFoundryHtml", () => {
  it("resolves links and media in one pass over a page", () => {
    const html = `<p>${link("/Characters/Marlo")}</p><img src="/a/map.webp">`;
    const out = toFoundryHtml(html, index(), "public");
    assert.match(out, /@UUID\[Compendium\.my-vault\./);
    assert.match(out, /src="@vaults\/public\/a\/map\.webp"/);
  });

  it("does not let an already-rewritten link be seen as an asset", () => {
    const out = toFoundryHtml(link("/Characters/Marlo"), index(), "public");
    assert.doesNotMatch(out, /src="@vaults/);
  });
});

describe("rewriteVaultRefs", () => {
  it("converts the authoring form to the wire form", () => {
    assert.equal(rewriteVaultRefs("@vault/attachments/map.webp", "public"), "@vaults/public/attachments/map.webp");
  });

  it("reaches a Scene background, which is nested two levels down", () => {
    const scene = { levels: [{ background: { src: "@vault/a/ground.webp", tint: "#ffffff" } }] };
    const out = rewriteVaultRefs(scene, "public");
    assert.equal(out.levels[0]!.background.src, "@vaults/public/a/ground.webp");
    assert.equal(out.levels[0]!.background.tint, "#ffffff");
  });

  it("reaches through arrays, where tiles and sounds live", () => {
    const out = rewriteVaultRefs({
      tiles: [{ texture: { src: "@vault/a/tile.webp" } }],
      sounds: [{ path: "@vault/audio/room.ogg" }],
    }, "public");
    assert.equal(out.tiles[0]!.texture.src, "@vaults/public/a/tile.webp");
    assert.equal(out.sounds[0]!.path, "@vaults/public/audio/room.ogg");
  });

  it("leaves every other string alone, including one that merely contains the word", () => {
    const before = {
      name: "Forest River",
      img: "icons/svg/mystery-man.svg",
      note: "see @vault/x for details",
      url: "https://example.com/@vault/x",
    };
    assert.deepEqual(rewriteVaultRefs(before, "public"), before);
  });

  it("preserves non-string values rather than stringifying them", () => {
    const before = { width: 2240, lock: true, folder: null, walls: [] };
    assert.deepEqual(rewriteVaultRefs(before, "public"), before);
  });

  it("is idempotent", () => {
    const once = rewriteVaultRefs({ src: "@vault/a.webp" }, "public");
    assert.deepEqual(rewriteVaultRefs(once, "public"), once);
  });
});
