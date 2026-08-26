// Tests for LaTeX math rendering ($inline$ and $$display$$ via remark-math +
// rehype-katex). The interesting invariants:
//
//   - KaTeX output must survive the pipeline's sanitize step (rehype-katex
//     runs after rehype-sanitize precisely so its inline styles and MathML
//     aren't stripped — a plugin-order regression is silent otherwise).
//   - Math is parsed before emphasis, so $a_i + b_j$ never turns into <em>.
//   - The katex stylesheet link + /katex/ assets ship only for vaults that
//     actually contain math.
//   - Hover previews render math too (they inject other pages' HTML).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  // settings.md is the source of truth for vault properties, so a test vault
  // configures itself the way a user would. image_quality: 0 skips sharp,
  // which these fixtures need: their "images" are placeholder bytes, not real
  // encodings. Exercising the compression path wants real fixtures instead.
  if (!("settings.md" in files)) {
    files = { "settings.md": "---\nimage_quality: 0\n---\n", ...files };
  }
  const dir = await mkdtemp(join(tmpdir(), "vault-math-"));
  const out = join(dir, "_out");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return { dir, out };
}

async function cleanup(v: Vault): Promise<void> {
  await rm(v.dir, { recursive: true, force: true });
}

async function build(v: Vault): Promise<void> {
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

describe("math rendering", () => {
  it("renders inline and display math to KaTeX markup with styles intact", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Math.md": "Inline $x^2 + y^2 = z^2$ here.\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Math.html"), "utf8");
      assert.match(html, /class="katex"/);
      assert.match(html, /class="katex-display"/);
      // Sanitize must not strip KaTeX's inline styles or MathML — both are
      // load-bearing for correct visual output.
      assert.match(html, /class="strut" style="height:/);
      assert.match(html, /<math/);
      // The source TeX must not leak through as literal text.
      assert.ok(!html.includes("$x^2"));
    } finally {
      await cleanup(v);
    }
  });

  it("parses math before emphasis so underscores stay subscripts", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Subscripts.md": "The sum $a_i + b_j$ converges.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Subscripts.html"), "utf8");
      assert.match(html, /class="katex"/);
      assert.ok(!/<em>/.test(html), "underscores inside math must not become <em>");
    } finally {
      await cleanup(v);
    }
  });

  it("links the katex stylesheet and ships css + woff2 fonts when math is present", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Math.md": "Euler: $e^{i\\pi} + 1 = 0$.\n",
      "Plain.md": "No math on this page.\n",
    });
    try {
      await build(v);
      // Variant-wide link: the math-free page gets it too, because hover
      // previews can inject the math page's HTML into any page.
      for (const page of ["Math.html", "Plain.html"]) {
        const html = await readFile(join(v.out, page), "utf8");
        assert.match(html, /<link rel="stylesheet" href="\/katex\/katex\.min\.css\?v=/, page);
      }
      const css = await readFile(join(v.out, "katex", "katex.min.css"), "utf8");
      assert.ok(css.includes("katex"));
      const fontStat = await stat(join(v.out, "katex", "fonts", "KaTeX_Main-Regular.woff2"));
      assert.ok(fontStat.size > 0);
    } finally {
      await cleanup(v);
    }
  });

  it("ships no katex link or assets for a math-free vault", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Plain.md": "It costs about 5 dollars.\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Plain.html"), "utf8");
      assert.ok(!html.includes("katex"));
      await assert.rejects(stat(join(v.out, "katex")), "katex/ must not be emitted");
    } finally {
      await cleanup(v);
    }
  });

  it("renders math in hover-preview JSON", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Math.md": "A quadratic $ax^2 + bx + c$ opens the page.\n",
    });
    try {
      await build(v);
      const preview = JSON.parse(await readFile(join(v.out, "Math.preview.json"), "utf8"));
      assert.match(preview.summary, /class="katex"/);
    } finally {
      await cleanup(v);
    }
  });
});
