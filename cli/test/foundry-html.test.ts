// Rewriting article HTML into what a Foundry journal wants.
//
// The decision worth protecting here is that a link resolves to the copy the
// graft actually built, in the pack it built it into. A UUID naming the right
// document in the wrong pack resolves cleanly enough that nobody notices until
// the two copies drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  pathFromHref, uuidFor, rewriteLinks, rewriteAssets, toFoundryHtml, rewriteVaultRefs, dualVariantBody, stripWebOnly,
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

  it("decodes the entities the serializer wrote, so an apostrophe resolves", () => {
    // rehype escapes ' in an attribute; percent-decoding alone leaves the
    // entity mid-path and the link silently stays a raw href in Foundry.
    assert.equal(pathFromHref("/Places/Aramond&#x27;s%20Lookout"), "Places/Aramond's Lookout.md");
    assert.equal(pathFromHref("/Places/Aramond&#39;s%20Lookout"), "Places/Aramond's Lookout.md");
    assert.equal(pathFromHref("/Items/Cloak%20&amp;%20Dagger"), "Items/Cloak & Dagger.md");
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
  it("marks media so the Foundry module can place it wherever it lands", () => {
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
});

describe("rewriteVaultRefs", () => {
  it("converts the authoring form to the wire form", () => {
    assert.equal(rewriteVaultRefs("@vault/attachments/map.webp", "public"), "@vaults/public/attachments/map.webp");
  });

  it("reaches through arrays, where tiles and sounds live", () => {
    const out = rewriteVaultRefs({
      tiles: [{ texture: { src: "@vault/a/tile.webp", tint: "#ffffff" } }],
      sounds: [{ path: "@vault/audio/room.ogg" }],
    }, "public");
    assert.equal(out.tiles[0]!.texture.src, "@vaults/public/a/tile.webp");
    assert.equal(out.tiles[0]!.texture.tint, "#ffffff", "sibling values survive");
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

describe("bases cards", () => {
  it("becomes a content-link that keeps its card markup", () => {
    const card = '<a class="bases-card" href="/Characters/Marlo">'
      + '<div class="bases-card-title">Marlo</div></a>';
    const out = rewriteLinks(card, index());
    assert.match(out, /class="bases-card content-link"/);
    assert.match(out, /data-uuid="Compendium\.my-vault\.my-vault-journals\.JournalEntry\.ent0\.JournalEntryPage\.pg0"/);
    assert.match(out, /<div class="bases-card-title">Marlo<\/div>/, "markup survives");
    assert.doesNotMatch(out, /href=/, "the wiki href is gone");
  });

  it("leaves a card pointing at a page the index cannot place", () => {
    const card = '<a class="bases-card" href="/Nowhere/Gone"><div>x</div></a>';
    assert.equal(rewriteLinks(card, index()), card);
  });
});

describe("stripWebOnly", () => {
  it("drops a marked element, nested markup and all", () => {
    const bm = '<div class="vaults-battlemap vaults-web-only"><div class="vaults-bm-bar"><div>tools</div></div></div>';
    assert.equal(stripWebOnly(`<p>before</p>${bm}<p>after</p>`), "<p>before</p><p>after</p>");
  });

  it("drops marked non-div elements by their own tag", () => {
    const fig = '<figure class="vaults-web-only"><img src="x.png"><figcaption>cap</figcaption></figure>';
    assert.equal(stripWebOnly(`${fig}<p>kept</p>`), "<p>kept</p>");
  });

  it("drops each marked element and keeps everything between", () => {
    const a = '<div class="vaults-web-only"><div>x</div></div>';
    assert.equal(stripWebOnly(`${a}<p>mid</p>${a}`), "<p>mid</p>");
  });

  it("does not match the class as a substring", () => {
    const html = '<div class="vaults-web-only-not-really"><p>keep</p></div>';
    assert.equal(stripWebOnly(html), html);
  });

  it("drops a marked void or self-closing element without losing its place", () => {
    // No closing tag to find; leaving it would also skip every marked
    // element after it on the page.
    const html = '<img class="vaults-web-only" src="x.png"><p>a</p><br class="vaults-web-only"/><div class="vaults-web-only"><p>b</p></div><p>c</p>';
    assert.equal(stripWebOnly(html), "<p>a</p><p>c</p>");
  });

  it("runs inside toFoundryHtml, before anything else sees the element", () => {
    const html = '<div class="vaults-web-only"><a class="internal-link" href="/Characters/Marlo">m</a></div><p>t</p>';
    assert.equal(toFoundryHtml(html, index(), "dm"), "<p>t</p>");
  });
});

describe("fvtt-link doc preference", () => {
  const both = (): LinkIndex => {
    const idx = index();
    idx.targets.set("DM Notes/Macros/Toggle Feast.md", {
      entry: "entMacros0000000", page: "pgFeast000000000",
      doc: { type: "Macro", pack: "my-vault-macros", id: "docFeast00000000" },
    });
    return idx;
  };

  it("sends a fvtt-doc-link to the document even when a journal page exists", () => {
    const a = '<a class="internal internal-link fvtt-doc-link" href="/DM%20Notes/Macros/Toggle%20Feast">Feast</a>';
    assert.equal(rewriteLinks(a, both()),
      "@UUID[Compendium.my-vault.my-vault-macros.Macro.docFeast00000000]{Feast}");
  });

  it("sends a plain wikilink to the journal page, as ever", () => {
    const a = '<a class="internal internal-link" href="/DM%20Notes/Macros/Toggle%20Feast">Feast</a>';
    assert.equal(rewriteLinks(a, both()),
      "@UUID[Compendium.my-vault.my-vault-journals.JournalEntry.entMacros0000000.JournalEntryPage.pgFeast000000000]{Feast}");
  });

  it("falls back to the journal page for a page with no document", () => {
    const a = '<a class="internal internal-link fvtt-doc-link" href="/Characters/Marlo">M</a>';
    assert.equal(rewriteLinks(a, index()),
      "@UUID[Compendium.my-vault.my-vault-journals.JournalEntry.ent0.JournalEntryPage.pg0]{M}");
  });
});

describe("dualVariantBody", () => {
  it("carries the GM render as one secret and the player render in the open", () => {
    const out = dualVariantBody("<p>full base, 12 rows</p>", "<p>public base, 4 rows</p>");
    assert.match(out, /^<section class="secret vaults-gm" id="secret-[0-9a-f]{16}"><p>full base, 12 rows<\/p><\/section>/);
    assert.match(out, /<div class="vaults-player-view"><p>public base, 4 rows<\/p><\/div>$/);
  });

  it("is what makes an unmarked difference safe", () => {
    // A base row for a DM-only page is not wrapped in anything; it is simply
    // absent from the player render. Foundry stripping the secret leaves the
    // player exactly the public site's version of the page.
    const out = dualVariantBody('<tr><td>Joywraith</td></tr><tr><td>Bandit</td></tr>', '<tr><td>Bandit</td></tr>');
    const open = out.indexOf('<div class="vaults-player-view">');
    assert.doesNotMatch(out.slice(open), /Joywraith/);
  });
});
