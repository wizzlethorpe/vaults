import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/render/preview.js";

describe("buildPreview: code blocks", () => {
  it("strips backtick-fenced code blocks from the summary", async () => {
    const md = [
      "Some intro prose.",
      "",
      "```js",
      "const x = 1;",
      "console.log(x);",
      "```",
      "",
      "Trailing prose.",
    ].join("\n");
    const preview = await buildPreview(md, "Page");
    assert.ok(preview.summary.includes("Some intro prose"));
    assert.ok(preview.summary.includes("Trailing prose"));
    assert.ok(!preview.summary.includes("const x = 1"), "fenced code body leaked into preview");
    assert.ok(!preview.summary.includes("console.log"), "fenced code body leaked into preview");
  });

  it("strips tilde-fenced code blocks from the summary", async () => {
    const md = [
      "Intro.",
      "",
      "~~~",
      "raw block content",
      "~~~",
      "",
      "Outro.",
    ].join("\n");
    const preview = await buildPreview(md, "Page");
    assert.ok(preview.summary.includes("Intro"));
    assert.ok(preview.summary.includes("Outro"));
    assert.ok(!preview.summary.includes("raw block content"), "tilde-fenced body leaked into preview");
  });

  it("strips code blocks from per-heading section summaries too", async () => {
    const md = [
      "# Top",
      "",
      "Lead paragraph.",
      "",
      "## Sub",
      "",
      "```",
      "secret table-of-doom",
      "```",
      "",
      "Sub prose.",
    ].join("\n");
    const preview = await buildPreview(md, "Page");
    const sub = preview.headings.sub;
    assert.ok(sub, "expected a 'sub' heading entry");
    assert.ok(sub.summary.includes("Sub prose"));
    assert.ok(!sub.summary.includes("secret table-of-doom"), "code block leaked into section summary");
  });
});
