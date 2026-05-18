import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../src/render/preview.js";
import { buildRegistry } from "../src/render/handlers/types.js";
import { BUILTIN_HANDLERS } from "../src/render/handlers/builtin/index.js";
import type { RenderContext } from "../src/render/types.js";

function emptyRenderContext(): RenderContext {
  return {
    pages: new Map(),
    images: new Map(),
    markdownContent: new Map(),
    bases: new Map(),
    defaultImageWidth: "",
    redactRoles: new Set(),
  };
}

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

describe("buildPreview: handlers", () => {
  it("resolves inline `fm:` references in the body summary", async () => {
    const md = "Dravencoles (born `fm: birthday`) appears to be in his mid-twenties.";
    const preview = await buildPreview(md, "Dravencoles", {
      frontmatter: { birthday: "Spring of the Crow" },
      registry: buildRegistry(BUILTIN_HANDLERS),
      renderContext: emptyRenderContext(),
      pagePath: "Characters/Dravencoles.md",
    });
    assert.ok(preview.summary.includes("Spring of the Crow"), `expected fm value in summary, got: ${preview.summary}`);
    assert.ok(!preview.summary.includes("fm: birthday"), "raw fm syntax leaked into preview");
  });

  it("resolves inline handlers inside per-heading section summaries", async () => {
    const md = "## Bio\n\nBorn `fm: birthday`, raised in the mountains.";
    const preview = await buildPreview(md, "Page", {
      frontmatter: { birthday: "Spring of the Crow" },
      registry: buildRegistry(BUILTIN_HANDLERS),
      renderContext: emptyRenderContext(),
      pagePath: "Page.md",
    });
    const bio = preview.headings.bio;
    assert.ok(bio, "expected a 'bio' heading entry");
    assert.ok(bio.summary.includes("Spring of the Crow"), `expected fm value in section summary, got: ${bio.summary}`);
  });

  it("leaves handler syntax intact when no handler context is supplied", async () => {
    const md = "Born `fm: birthday`.";
    const preview = await buildPreview(md, "Page");
    // No registry → no dispatch. Preserves the call-site contract for existing callers.
    assert.ok(preview.summary.includes("fm: birthday"), "expected raw fm syntax to survive without a registry");
  });
});
