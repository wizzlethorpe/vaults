// Rewriting article HTML into what a Foundry journal wants.
//
// The decision worth protecting here is that a link resolves to the copy the
// graft actually built, in the pack it built it into. A UUID naming the right
// document in the wrong pack resolves cleanly enough that nobody notices until
// the two copies drift.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  pathFromHref, uuidFor, rewriteLinks, rewriteAssets, toFoundryHtml, rewriteVaultRefs, journalBody,
  type LinkIndex,
} from "../src/foundry-html.js";

const index = (): LinkIndex => ({
  targets: new Map([
    ["Characters/Marlo.md", { entry: "ent0", page: "pg0" }],
    ["Bestiary/Wolf.md", { entry: "ent1", page: "pg1" }],
  ]),
});

const rewriteAssetsV = (h: string) => rewriteAssets(h, "vaults/marlo", new Set());
const plain = { secretRoles: new Set<string>(), css: "" };
/** A journal body without the wrapper that carries the palette. */
const inner = (html: string) => html.replace(/^<div style="[^"]*">([\s\S]*)<\/div>$/, "$1");

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
  it("names the copy built into the world", () => {
    // A vault builds into the world, so the documents the reader ends up with
    // carry these ids. A Compendium UUID would send them to a second copy of
    // the thing sitting beside the one they are reading.
    assert.equal(uuidFor("Characters/Marlo.md", index()),
      "JournalEntry.ent0.JournalEntryPage.pg0");
  });

  it("sends a link to a journal-less page to its document", () => {
    // `journal: false` means the page's prose never becomes a journal page,
    // so the document is the only thing a reader can be sent to.
    const idx = index();
    idx.targets.set("DM Notes/Scenes/Home.md",
      { doc: { type: "Scene", id: "homeScene0000000" } });
    assert.equal(uuidFor("DM Notes/Scenes/Home.md", idx), "Scene.homeScene0000000");
  });
});

describe("rewriteLinks", () => {
  it("turns an internal link into a UUID enricher carrying its label", () => {
    assert.equal(
      rewriteLinks(link("/Characters/Marlo"), index()),
      "@UUID[JournalEntry.ent0.JournalEntryPage.pg0]{Marlo}");
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
      "@UUID[JournalEntry.ent0.JournalEntryPage.pg0]");
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
  it("points media at where the asset handler places it", () => {
    assert.equal(
      rewriteAssetsV(`<img src="/attachments/map.webp">`),
      `<img src="vaults/marlo/attachments/map.webp">`);
    assert.match(rewriteAssetsV(`<audio src="/a/x.ogg"></audio>`), /vaults\/marlo\/a\/x\.ogg/);
    assert.match(rewriteAssetsV(`<video src="/v/x.webm"></video>`), /vaults\/marlo\/v\/x\.webm/);
  });

  it("collects the file's own path, not the escaped one the attribute carries", () => {
    // The build ships exactly what this set names. Deriving it from the
    // rendered HTML instead dropped every asset whose name needed escaping.
    const named = new Set<string>();
    const out = rewriteAssets('<img src="/attachments/Cloak%20%26%20Dagger.webp">', "vaults/marlo", named);
    assert.deepEqual([...named], ["attachments/Cloak & Dagger.webp"]);
    assert.equal(out, '<img src="vaults/marlo/attachments/Cloak &amp; Dagger.webp">');
  });

  it("keeps the tag's other attributes", () => {
    assert.equal(
      rewriteAssetsV(`<img alt="Map" src="/a/map.webp" width="400">`),
      `<img alt="Map" src="vaults/marlo/a/map.webp" width="400">`);
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
      /href="vaults\/marlo\/files\/map\.pdf"/);
  });

  it("leaves internal links to the link rewriter", () => {
    const html = link("/Characters/Marlo");
    assert.equal(rewriteAssetsV(html), html);
  });
});

describe("toFoundryHtml", () => {
  it("resolves links and media in one pass over a page", () => {
    const html = `<p>${link("/Characters/Marlo")}</p><img src="/a/map.webp">`;
    const out = toFoundryHtml(html, index(), "vaults/marlo", new Set(), plain);
    assert.match(out, /@UUID\[JournalEntry\.ent0\./);
    assert.match(out, /src="vaults\/marlo\/a\/map\.webp"/);
  });
});

describe("rewriteVaultRefs", () => {
  it("collects the asset a patch names, wherever it sits in the patch", () => {
    const named = new Set<string>();
    rewriteVaultRefs({ background: { src: "@vault/attachments/map.webp" }, tokens: [{ texture: { src: "@vault/t/a.webp" } }] },
      "vaults/marlo", named);
    assert.deepEqual([...named].sort(), ["attachments/map.webp", "t/a.webp"]);
  });

  it("converts the authoring form to the wire form", () => {
    assert.equal(rewriteVaultRefs("@vault/attachments/map.webp", "vaults/marlo", new Set()), "vaults/marlo/attachments/map.webp");
  });

  it("reaches through arrays, where tiles and sounds live", () => {
    const out = rewriteVaultRefs({
      tiles: [{ texture: { src: "@vault/a/tile.webp", tint: "#ffffff" } }],
      sounds: [{ path: "@vault/audio/room.ogg" }],
    }, "vaults/marlo", new Set());
    assert.equal(out.tiles[0]!.texture.src, "vaults/marlo/a/tile.webp");
    assert.equal(out.tiles[0]!.texture.tint, "#ffffff", "sibling values survive");
    assert.equal(out.sounds[0]!.path, "vaults/marlo/audio/room.ogg");
  });

  it("leaves every other string alone, including one that merely contains the word", () => {
    const before = {
      name: "Forest River",
      img: "icons/svg/mystery-man.svg",
      note: "see @vault/x for details",
      url: "https://example.com/@vault/x",
    };
    assert.deepEqual(rewriteVaultRefs(before, "vaults/marlo", new Set()), before);
  });

  it("preserves non-string values rather than stringifying them", () => {
    const before = { width: 2240, lock: true, folder: null, walls: [] };
    assert.deepEqual(rewriteVaultRefs(before, "vaults/marlo", new Set()), before);
  });

  it("is idempotent", () => {
    const once = rewriteVaultRefs({ src: "@vault/a.webp" }, "vaults/marlo", new Set());
    assert.deepEqual(rewriteVaultRefs(once, "vaults/marlo", new Set()), once);
  });
});

describe("bases cards", () => {
  it("becomes a content-link that keeps its card markup", () => {
    const card = '<a class="bases-card" href="/Characters/Marlo">'
      + '<div class="bases-card-title">Marlo</div></a>';
    const out = rewriteLinks(card, index());
    assert.match(out, /class="bases-card content-link"/);
    assert.match(out, /data-uuid="JournalEntry\.ent0\.JournalEntryPage\.pg0"/);
    assert.match(out, /<div class="bases-card-title">Marlo<\/div>/, "markup survives");
    assert.doesNotMatch(out, /href=/, "the wiki href is gone");
  });

  it("leaves a card pointing at a page the index cannot place", () => {
    const card = '<a class="bases-card" href="/Nowhere/Gone"><div>x</div></a>';
    assert.equal(rewriteLinks(card, index()), card);
  });
});

describe("journalBody: what the wiki shows and a journal does not", () => {
  it("drops a marked element, nested markup and all", () => {
    const bm = '<div class="vaults-battlemap vaults-web-only"><div class="vaults-bm-bar"><div>tools</div></div></div>';
    assert.equal(inner(journalBody(`<p>before</p>${bm}<p>after</p>`, plain)), "<p>before</p><p>after</p>");
  });

  it("drops marked void elements without losing its place", () => {
    const html = '<img class="vaults-web-only" src="x.png"><p>a</p><br class="vaults-web-only"><div class="vaults-web-only"><p>b</p></div><p>c</p>';
    assert.equal(inner(journalBody(html, plain)), "<p>a</p><p>c</p>");
  });

  it("does not match the class as a substring", () => {
    const html = '<div class="vaults-web-only-not-really"><p>keep</p></div>';
    assert.equal(inner(journalBody(html, plain)), html);
  });

  it("runs inside toFoundryHtml, before anything else sees the element", () => {
    const html = '<div class="vaults-web-only"><a class="internal-link" href="/Characters/Marlo">m</a></div><p>t</p>';
    assert.equal(inner(toFoundryHtml(html, index(), "vaults/marlo", new Set(), plain)), "<p>t</p>");
  });
});

describe("journalBody: what a player may not see", () => {
  const dm = new Set(["dm"]);
  const dmCallout = '<div class="callout callout-dm" data-callout="dm"><div class="callout-title">Dm</div><p>The mayor is a mimic.</p></div>';
  /** The part of `html` before its first secret, and the rest. */
  const split = (html: string): [string, string] => {
    const at = html.indexOf('<section class="secret"');
    assert.ok(at >= 0, "no secret section at all");
    return [html.slice(0, at), html.slice(at)];
  };

  it("puts a callout gated above the player role behind a Foundry secret", () => {
    const out = journalBody(`<p>The town.</p>${dmCallout}`, { secretRoles: dm, css: "" });
    assert.match(inner(out), /^<p>The town\.<\/p><section class="secret" id="secret-[0-9a-f]{16}"><div class="callout callout-dm"/);
  });

  it("leaves an ordinary callout, and any callout on a page players never open, in the open", () => {
    const note = '<div class="callout callout-note" data-callout="note"><p>x</p></div>';
    assert.doesNotMatch(journalBody(note, { secretRoles: dm, css: "" }), /secret/);
    assert.doesNotMatch(journalBody(dmCallout, plain), /secret/);
  });

  it("puts an embed of a gated page behind a secret", () => {
    const out = journalBody('<p>open</p><div class="embed" data-vaults-role="dm"><p>the cult</p></div>', { secretRoles: dm, css: "" });
    const [open, secret] = split(out);
    assert.doesNotMatch(open, /the cult/);
    assert.match(secret, /the cult/);
  });

  it("splits a table, and the GM copy holds only the rows players may not see", () => {
    // A secret around a row is hoisted out of the table by the HTML parser,
    // which would leave the row itself in the open.
    const table = '<div class="bases-block"><div class="bases-caption">Roster</div><div class="bases-scroll"><table class="bases-table">'
      + "<thead><tr><th>Name</th></tr></thead><tbody>"
      + '<tr data-row="0" data-vaults-role="public"><td>Bandit</td></tr>'
      + '<tr data-row="1" data-vaults-role="dm"><td>Joywraith</td></tr>'
      + "</tbody></table></div></div>";
    const [open, secret] = split(journalBody(table, { secretRoles: dm, css: "" }));
    assert.match(open, /Bandit/);
    assert.doesNotMatch(open, /Joywraith/);
    assert.match(secret, /Joywraith/);
    assert.doesNotMatch(secret, /Bandit/, "the GM copy repeats a row players already see");
    assert.match(secret, /<thead><tr><th>Name<\/th><\/tr><\/thead>/, "under the same columns");
    assert.doesNotMatch(open + secret, /data-vaults-role/, "the marker is build plumbing");
  });

  it("splits cards the same way, never wrapping a card where it stands", () => {
    const cards = '<div class="bases-block bases-cards-block"><div class="bases-cards">'
      + '<a class="bases-card" href="/Bandit" data-vaults-role="public">Bandit</a>'
      + '<a class="bases-card" href="/Joywraith" data-vaults-role="dm">Joywraith</a>'
      + "</div></div>";
    const [open, secret] = split(journalBody(cards, { secretRoles: dm, css: "" }));
    assert.doesNotMatch(open, /Joywraith|<section/);
    assert.match(secret, /<div class="bases-cards"><a class="bases-card" href="\/Joywraith">Joywraith<\/a><\/div>/);
  });

  it("leaves a block alone when no item in it is kept from players", () => {
    const table = '<div class="bases-block"><table class="bases-table"><tbody><tr data-vaults-role="public"><td>Bandit</td></tr></tbody></table></div>';
    assert.doesNotMatch(journalBody(table, { secretRoles: dm, css: "" }), /secret/);
  });
});

describe("journalBody: the stylesheet a journal keeps none of", () => {
  it("writes the rules onto the elements, inside a wrapper carrying the palette they name", () => {
    const out = journalBody('<div class="callout"><p>x</p></div>', { secretRoles: new Set(), css: ".callout { border-left: 4px solid var(--muted); }" });
    assert.match(out, /^<div style="--fg:var\(--color-text-primary, #1d1a17\);--muted:/);
    assert.match(out, /<div class="callout" style="border-left:4px solid var\(--muted\)">/);
  });

  it("writes every style the way Foundry stores it, so a rebuild finds the page unchanged", () => {
    // The server rewrites `a: b; c: d` to `a:b;c:d` on save. Left as written,
    // every styled page differed from its stored copy on every import.
    const out = journalBody('<p class="x" style="height: 1em;">t</p><p style="">u</p>',
      { secretRoles: new Set(), css: ".x { color: blue; margin: 0!important; }" });
    assert.match(out, /<p class="x" style="color:blue;margin:0 !important;height:1em">t<\/p><p>u<\/p>/);
  });

  it("styles the GM copy of a split table like the open one", () => {
    // Styling first would leave the copy, made from the styled block, right by
    // accident; styling a block that is only split later would miss nothing
    // either. The copy is asserted so a reordering that loses it is visible.
    const table = '<div class="bases-block"><table class="bases-table"><tbody>'
      + '<tr data-vaults-role="public"><td>Bandit</td></tr><tr data-vaults-role="dm"><td>Joywraith</td></tr>'
      + "</tbody></table></div>";
    const out = journalBody(table, { secretRoles: new Set(["dm"]), css: ".bases-table td { padding: 1px; }" });
    assert.equal((out.match(/<td style="padding:1px">/g) ?? []).length, 2);
  });

  it("keeps a card's written style when its link becomes a content link", () => {
    const card = '<a class="bases-card" href="/Characters/Marlo">Marlo</a>';
    const out = toFoundryHtml(card, index(), "vaults/marlo", new Set(), { secretRoles: new Set(), css: ".bases-card { display: block; }" });
    assert.match(out, /<a class="bases-card content-link" style="display:block" draggable="true" data-link="" data-uuid="JournalEntry\.ent0\.JournalEntryPage\.pg0">/);
  });
});

describe("fvtt-link doc preference", () => {
  const both = (): LinkIndex => {
    const idx = index();
    idx.targets.set("DM Notes/Macros/Toggle Feast.md", {
      entry: "entMacros0000000", page: "pgFeast000000000",
      doc: { type: "Macro", id: "docFeast00000000" },
    });
    return idx;
  };

  it("sends a fvtt-doc-link to the document even when a journal page exists", () => {
    const a = '<a class="internal internal-link fvtt-doc-link" href="/DM%20Notes/Macros/Toggle%20Feast">Feast</a>';
    assert.equal(rewriteLinks(a, both()),
      "@UUID[Macro.docFeast00000000]{Feast}");
  });

  it("sends a plain wikilink to the journal page, as ever", () => {
    const a = '<a class="internal internal-link" href="/DM%20Notes/Macros/Toggle%20Feast">Feast</a>';
    assert.equal(rewriteLinks(a, both()),
      "@UUID[JournalEntry.entMacros0000000.JournalEntryPage.pgFeast000000000]{Feast}");
  });

  it("falls back to the journal page for a page with no document", () => {
    const a = '<a class="internal internal-link fvtt-doc-link" href="/Characters/Marlo">M</a>';
    assert.equal(rewriteLinks(a, index()),
      "@UUID[JournalEntry.ent0.JournalEntryPage.pg0]{M}");
  });
});
