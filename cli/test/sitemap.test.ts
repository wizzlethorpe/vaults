// sitemap.xml / robots.txt, and the one rule that matters.
//
// A sitemap lists URLs for crawlers, so it must never name a gated page. The
// middleware would refuse the *content* to an unauthorised visitor, but the
// sitemap is served to everyone and naming a page tells the world it exists,
// and where. Only the default (lowest) role feeds it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

async function build(files: Record<string, string>, config?: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vault-sm-"));
  const out = join(dir, "_out");
  const all: Record<string, string> = { ...files };
  if (config) all[".vaults/config.json"] = JSON.stringify(config);
  for (const [p, c] of Object.entries(all)) {
    const full = join(dir, p);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, c);
  }
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { await buildSite({ vaultPath: dir, outputDir: out }); }
  finally { console.log = origLog; console.warn = origWarn; }
  return out;
}

const SETTINGS = (extra = "") => `---\nimage_quality: 0\n${extra}---\n`;
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("sitemap", () => {
  it("is not written without a site_url", async () => {
    // Nothing else in the build knows the deploy's public hostname, and a
    // sitemap needs absolute URLs, so no URL means no sitemap.
    const out = await build({ "settings.md": SETTINGS(), "index.md": "---\ntitle: H\n---\nH\n" });
    assert.equal(await exists(join(out, "sitemap.xml")), false);
    assert.equal(await exists(join(out, "robots.txt")), false);
    await rm(out, { recursive: true, force: true });
  });

  it("never lists a page above the default role", async () => {
    const out = await build({
      "settings.md": SETTINGS('site_url: "https://x.example"\n'),
      "index.md": "---\ntitle: H\n---\nH\n",
      "Public.md": "---\ntitle: P\n---\nP\n",
      "Secret.md": "---\ntitle: S\nrole: staff\n---\nS\n",
    }, { roles: ["public", "staff"], rolePasswords: {} });
    const xml = await readFile(join(out, "sitemap.xml"), "utf8");
    assert.match(xml, /https:\/\/x\.example\/Public/);
    assert.doesNotMatch(xml, /Secret/, "a gated page must not be advertised");
    await rm(out, { recursive: true, force: true });
  });

  it("maps index.md to the bare base URL", async () => {
    const out = await build({
      "settings.md": SETTINGS('site_url: "https://x.example"\n'),
      "index.md": "---\ntitle: H\n---\nH\n",
    });
    const xml = await readFile(join(out, "sitemap.xml"), "utf8");
    assert.match(xml, /<loc>https:\/\/x\.example<\/loc>/);
    assert.doesNotMatch(xml, /<loc>[^<]*\/<\/loc>/, "no trailing slash");
    await rm(out, { recursive: true, force: true });
  });

  it("percent-encodes paths and tolerates a trailing slash on site_url", async () => {
    const out = await build({
      "settings.md": SETTINGS('site_url: "https://x.example/"\n'),
      "index.md": "---\ntitle: H\n---\nH\n",
      "Week 1.md": "---\ntitle: W\n---\nW\n",
    });
    const xml = await readFile(join(out, "sitemap.xml"), "utf8");
    assert.match(xml, /https:\/\/x\.example\/Week%201/);
    assert.doesNotMatch(xml, /x\.example\/\//, "the trailing slash must not double up");
    await rm(out, { recursive: true, force: true });
  });

  it("points robots.txt at the sitemap", async () => {
    const out = await build({
      "settings.md": SETTINGS('site_url: "https://x.example"\n'),
      "index.md": "---\ntitle: H\n---\nH\n",
    });
    assert.match(await readFile(join(out, "robots.txt"), "utf8"), /Sitemap: https:\/\/x\.example\/sitemap\.xml/);
    await rm(out, { recursive: true, force: true });
  });
});
