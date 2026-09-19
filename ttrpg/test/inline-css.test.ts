// Writing stylesheet rules onto elements, for a journal page that keeps no
// stylesheet: the result has to cascade the way the stylesheet would have.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";

import { inlineCss, parseRules, specificity, storedStyle } from "../src/inline-css.js";

const inline = (html: string, css: string): string => {
  const tree = fromHtml(html, { fragment: true });
  inlineCss(tree, css);
  return toHtml(tree);
};

describe("parseRules", () => {
  it("reads top-level rules and drops comments and at-rules", () => {
    const rules = parseRules("/* note */ .a { color: red } @media (max-width: 1px) { .b { color: blue } } .c{margin:0}");
    assert.deepEqual(rules.map((r) => r.selector), [".a", ".c"]);
  });
});

describe("specificity", () => {
  it("ranks ids over classes over types, counting attributes and pseudo-classes as classes", () => {
    assert.ok(specificity("#x") > specificity(".a.b.c"));
    assert.ok(specificity(".a") > specificity("div p"));
    assert.equal(specificity('.statblock i[class*="fa-dice"]'), 201);
    assert.equal(specificity(".callout > *:last-child"), 200);
  });
});

describe("storedStyle", () => {
  // Every expected value here is what Foundry's server sanitiser returned for
  // the same input.
  it("compacts each pair, keeps duplicates and drops the trailing separator", () => {
    assert.equal(storedStyle("color: blue; color: red;"), "color:blue;color:red");
    assert.equal(storedStyle("margin:0!important"), "margin:0 !important");
    assert.equal(storedStyle("--fg: var(--color-text-primary, #1d1a17)"), "--fg:var(--color-text-primary, #1d1a17)");
  });

  it("splits only where a parser would", () => {
    assert.equal(storedStyle('font-family: "Iowan; Old", serif'), 'font-family:"Iowan; Old", serif');
    assert.equal(storedStyle("background: url(data:image/png;base64,AAAA)"), "background:url(data:image/png;base64,AAAA)");
  });
});

describe("inlineCss", () => {
  it("cascades by specificity before source order, as the stylesheet would", () => {
    // The later rule is weaker, so the earlier one has to be written last.
    const out = inline('<div class="callout callout-dm"><div class="callout-title">T</div></div>',
      ".callout-dm > .callout-title { color: red } .callout-title { color: blue }");
    assert.match(out, /<div class="callout-title" style="color: blue; color: red">/);
  });

  it("writes an element's own style last, since an inline style beats the stylesheet", () => {
    assert.match(inline('<p class="x" style="color: red">t</p>', ".x { color: blue; }"), /style="color: blue; color: red"/);
  });

  it("freezes in nothing a script toggles, and skips what cannot match ahead of time", () => {
    const out = inline('<div class="panel" hidden>p</div><a class="card">c</a>',
      ".panel[hidden] { display: none } .card:hover { color: red } .card::after { content: 'x' } .card { color: green }");
    assert.match(out, /<div class="panel" hidden>/);
    assert.match(out, /<a class="card" style="color: green">/);
  });

  it("applies each selector of a list, keeping one inside :is() whole", () => {
    const out = inline('<p class="a">1</p><p class="b">2</p><p class="c">3</p>', ".a, :is(.b, .c) { margin: 0 }");
    assert.equal(out.match(/style="margin: 0"/g)?.length, 3);
  });
});
