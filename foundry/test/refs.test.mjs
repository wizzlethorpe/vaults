// Vault references.
//
// The variant segment is the part worth guarding. It says which role's
// rendering a value comes from, and a vault only puts a file in a role's
// directory if a page that role can see refers to it. Losing the segment, or
// resolving one variant's reference against another's fetch, hands a reader
// something their role was built to withhold — and it does it silently,
// because the file it serves is a perfectly valid file.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { parseRef, collectRefs, substituteRefs, byVariant, isBody, findRefs } from "../scripts/refs.mjs";

describe("parseRef", () => {
  test("splits a reference into the variant and the path", () => {
    assert.deepEqual(parseRef("@vaults/DM/Actors/Marlo.foundry.html"),
      { variant: "DM", path: "Actors/Marlo.foundry.html" });
  });

  test("keeps the rest of the path intact, however deep", () => {
    assert.equal(parseRef("@vaults/public/a/b/c/d.webp").path, "a/b/c/d.webp");
  });

  test("rejects a reference naming a variant and nothing else", () => {
    // Resolving this to the variant's root would fetch a directory listing.
    assert.equal(parseRef("@vaults/DM"), null);
    assert.equal(parseRef("@vaults/DM/"), null);
  });

  test("rejects anything that is not a reference", () => {
    for (const v of ["@vault/old/form.webp", "icons/svg/mystery-man.svg", "", "@vaults//x.webp", 42, null]) {
      assert.equal(parseRef(v), null, String(v));
    }
  });
});

describe("collectRefs", () => {
  test("finds references at any depth and in arrays", () => {
    const refs = collectRefs({
      pages: [{ text: { content: "@vaults/DM/a.foundry.html" } }],
      levels: [{ background: { src: "@vaults/DM/bg.webp" } }],
      name: "Forest River",
    });
    assert.deepEqual([...refs.keys()], ["@vaults/DM/a.foundry.html", "@vaults/DM/bg.webp"]);
  });

  test("lists each distinct reference once, however often it appears", () => {
    const refs = collectRefs([{ a: "@vaults/DM/x.webp" }, { b: "@vaults/DM/x.webp" }]);
    assert.equal(refs.size, 1);
  });

  test("keeps two variants of the same path apart", () => {
    // The whole point: these are different files with different audiences.
    const refs = collectRefs(["@vaults/DM/x.webp", "@vaults/public/x.webp"]);
    assert.equal(refs.size, 2);
  });
});

describe("byVariant", () => {
  test("groups paths under the variant they are read from", () => {
    const grouped = byVariant(collectRefs([
      "@vaults/DM/a.webp", "@vaults/DM/b.webp", "@vaults/public/c.webp",
    ]));
    assert.deepEqual([...grouped.get("DM")], ["a.webp", "b.webp"]);
    assert.deepEqual([...grouped.get("public")], ["c.webp"]);
  });

  test("never merges variants, which is what would leak", () => {
    const grouped = byVariant(collectRefs(["@vaults/DM/x.webp", "@vaults/public/x.webp"]));
    assert.equal(grouped.size, 2);
    assert.deepEqual([...grouped.get("public")], ["x.webp"]);
  });
});

describe("substituteRefs", () => {
  const resolved = new Map([["@vaults/DM/a.foundry.html", "<p>Body</p>"]]);

  test("replaces a resolved reference in place", () => {
    assert.deepEqual(
      substituteRefs({ pages: [{ text: { content: "@vaults/DM/a.foundry.html" } }] }, resolved),
      { pages: [{ text: { content: "<p>Body</p>" } }] });
  });

  test("leaves an unresolved reference legible rather than blanking it", () => {
    // A document that shows the reference it could not fetch can be diagnosed.
    // One showing an empty string or a broken relative path cannot.
    assert.deepEqual(substituteRefs({ src: "@vaults/DM/missing.webp" }, resolved),
      { src: "@vaults/DM/missing.webp" });
  });

  test("leaves every other value untouched", () => {
    const doc = { name: "Marlo", width: 2240, lock: true, folder: null, walls: [] };
    assert.deepEqual(substituteRefs(doc, resolved), doc);
  });

  test("does not resolve one variant's reference from another's result", () => {
    assert.deepEqual(substituteRefs({ src: "@vaults/public/a.foundry.html" }, resolved),
      { src: "@vaults/public/a.foundry.html" });
  });
});

describe("isBody", () => {
  test("a body is inlined, anything else is downloaded", () => {
    assert.equal(isBody("Actors/Marlo.foundry.html"), true);
    for (const p of ["a.webp", "a.ogg", "a.html", "a.foundry.htm", "a.json"]) {
      assert.equal(isBody(p), false, p);
    }
  });
});

describe("references inside a page body", () => {
  // A body is itself a reference, and the images it uses are inside the HTML
  // it resolves to. Matching only values that *are* a reference left every
  // portrait in every page pointing at a marker, and — because nothing ever
  // asked for those files — never downloaded one either.
  const body = '<p><img src="@vaults/public/attachments/npcs/images/Bixby.webp" alt="x"></p>'
    + '<p>See <a href="@vaults/public/files/map.pdf">the map</a>.</p>';

  test("finds every reference in a string", () => {
    assert.deepEqual(findRefs(body).map((r) => r.path),
      ["attachments/npcs/images/Bixby.webp", "files/map.pdf"]);
  });

  test("stops at the closing quote, not at the end of the document", () => {
    const [ref] = findRefs('<img src="@vaults/DM/a/b.webp" class="wide">');
    assert.equal(ref.path, "a/b.webp");
    assert.equal(ref.raw, "@vaults/DM/a/b.webp");
  });

  test("collects them the same way as a whole-value reference", () => {
    const refs = collectRefs({ pages: [{ text: { content: body } }] });
    assert.equal(refs.size, 2);
  });

  test("substitutes in place, leaving the surrounding HTML intact", () => {
    const resolved = new Map([
      ["@vaults/public/attachments/npcs/images/Bixby.webp", "/worlds/w/vaults-cache/v/public/x.webp"],
    ]);
    const out = substituteRefs(body, resolved);
    assert.match(out, /<img src="\/worlds\/w\/vaults-cache\/v\/public\/x\.webp" alt="x">/);
    assert.match(out, /href="@vaults\/public\/files\/map\.pdf"/, "an unresolved one stays legible");
  });

  test("does not let a page's own prose act as a regex backreference", () => {
    // `$&` in a replacement string means "the whole match". A page discussing
    // shell or regex syntax would corrupt itself on the way in.
    const resolved = new Map([["@vaults/public/a.foundry.html", "<p>Use $& and $1 carefully.</p>"]]);
    assert.equal(substituteRefs("@vaults/public/a.foundry.html", resolved),
      "<p>Use $& and $1 carefully.</p>");
  });

  test("leaves a string with no reference untouched", () => {
    assert.equal(substituteRefs("<p>Plain prose.</p>", new Map()), "<p>Plain prose.</p>");
  });
});

describe("percent-encoded paths", () => {
  // Inside a body the path is a URL, so a filename with a space arrives
  // encoded. The vault serves the file under its real name, and /_batch
  // answers a file it does not have by omitting it rather than failing — so
  // asking for the encoded name loses the image and reports nothing.
  test("decodes the path a body refers to", () => {
    assert.equal(parseRef("@vaults/public/a/Bixby%20Wizzlethorpe.webp").path,
      "a/Bixby Wizzlethorpe.webp");
    assert.equal(findRefs('src="@vaults/DM/a/Great%20Hall.webp"')[0].path, "a/Great Hall.webp");
  });

  test("a whole value may hold a raw space; an embedded one may not", () => {
    // The two arrive differently. A whole value is written by the CLI from
    // frontmatter, where a filename is just a filename. Inside HTML the same
    // path is a URL, and a space there would end the attribute.
    assert.equal(parseRef("@vaults/public/a/Great Hall.webp").path, "a/Great Hall.webp");
    assert.deepEqual(findRefs('src="@vaults/public/a/Great Hall.webp"').map((r) => r.path),
      ["a/Great"]);
  });

  test("collects a whole value whole, space and all", () => {
    // The bug this pins: collectRefs scanned before checking whether the value
    // *was* a reference, so a token path from frontmatter was truncated at its
    // space. The vault was then asked for ".../tokens/Cassius", which it does
    // not have, and Foundry drew an actor with a missing texture — while the
    // portraits beside it worked, because a body's paths are percent-encoded
    // and have no spaces to truncate at.
    const token = "@vaults/DM/attachments/npcs/tokens/Cassius Marlo.token.webp";
    const refs = collectRefs({ prototypeToken: { texture: { src: token } } });
    assert.deepEqual([...refs.keys()], [token]);
    assert.equal(refs.get(token).path, "attachments/npcs/tokens/Cassius Marlo.token.webp");
  });

  test("substitutes a whole value that holds a space", () => {
    const body = "@vaults/DM/Actors/Cassius Marlo.foundry.html";
    assert.equal(substituteRefs(body, new Map([[body, "<p>Prose</p>"]])), "<p>Prose</p>");
  });

  test("keeps a malformed escape rather than throwing mid-build", () => {
    assert.equal(parseRef("@vaults/public/a/100%.webp").path, "a/100%.webp");
  });
});
