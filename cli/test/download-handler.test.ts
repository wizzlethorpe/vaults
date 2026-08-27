// The `download` code-block handler and the files it stages.
//
// Gating is not new machinery here: a referenced file ships into the variants
// of the pages that reference it, and the middleware already serves /<path>
// out of _variants/<role>/<path>. So the thing worth testing is that a
// download block actually *stages* its file — including extensions the
// passthrough list calls unknown, which is the whole point.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { downloadFilePaths, parseDownloadBlock } from "../src/render/handlers/builtin/download.js";
import { downloadHandler } from "../src/render/handlers/builtin/download.js";
import { buildSite } from "../src/build.js";

function render(content: string): string {
  const ctx = {
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  } as never;
  return (downloadHandler.render(content, ctx) as { html: string }).html;
}

describe("download block parsing", () => {
  it("reads the keys it knows and ignores the rest", () => {
    const spec = parseDownloadBlock("file: releases/mod.zip\nlabel: My Module\nnote: v1.0.0\nbogus: x");
    assert.equal(spec?.file, "releases/mod.zip");
    assert.equal(spec?.label, "My Module");
    assert.equal(spec?.note, "v1.0.0");
  });

  it("falls back to the filename when no label is given", () => {
    assert.equal(parseDownloadBlock("file: releases/mod.zip")?.label, "mod.zip");
  });

  it("needs a file, and says so rather than rendering a dead link", () => {
    assert.equal(parseDownloadBlock("label: nothing to download"), null);
    assert.match(render("label: nothing"), /vaults-download-error/);
  });

  it("strips leading slashes so /x and x name one file", () => {
    assert.equal(parseDownloadBlock("file: /releases/mod.zip")?.file, "releases/mod.zip");
  });
});

describe("download rendering", () => {
  it("links the file and marks it as a download", () => {
    const html = render("file: releases/mod.zip\nlabel: My Module");
    assert.match(html, /href="\/releases\/mod\.zip" download/);
    assert.match(html, /My Module/);
  });

  it("percent-encodes a path with spaces", () => {
    assert.match(render("file: releases/my module.zip"), /href="\/releases\/my%20module\.zip"/);
  });


});

describe("download staging", () => {
  it("names the file it was given", () => {
    const paths = downloadFilePaths("```download\nfile: releases/mod.zip\n```\n");
    assert.deepEqual(paths, ["releases/mod.zip"]);
  });

  it("ships a .zip, which the passthrough list would otherwise call unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-dl-"));
    const out = join(dir, "_out");
    const files: Record<string, string> = {
      ".vaultrc.json": JSON.stringify({ roles: ["public"], rolePasswords: {} }),
      "settings.md": "---\nimage_quality: 0\n---\n",
      "index.md": "---\ntitle: Home\n---\n\n```download\nfile: releases/mod.zip\nlabel: Module\n```\n",
      "releases/mod.zip": "PK-not-really-a-zip",
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    }
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try {
      await buildSite({ vaultPath: dir, outputDir: out });
      const shipped = await stat(join(out, "releases/mod.zip")).then(() => true, () => false);
      assert.equal(shipped, true, "a download-referenced zip must reach the deploy");
    } finally {
      console.log = origLog; console.warn = origWarn;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- foundry-manifest -----------------------------------------------------
//
// Split from `download` because the two only look alike. A download hands a
// file to a person whose browser carries their session cookie. This hands a
// URL to a machine: Foundry's installer runs on the Foundry server, sees no
// cookie, and has nowhere to put a header, so the URL must authenticate on
// its own.

import {
  foundryManifestHandler, foundryManifestPaths, manifestDownloadPath, parseManifestBlock,
} from "../src/render/handlers/builtin/foundry-manifest.js";

function renderManifest(content: string): string {
  const ctx = { escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") } as never;
  return (foundryManifestHandler.render(content, ctx) as { html: string }).html;
}

describe("foundry-manifest", () => {
  it("needs a manifest and says so", () => {
    assert.equal(parseManifestBlock("label: nope"), null);
    assert.match(renderManifest("label: nope"), /vaults-download-error/);
  });

  it("renders the install button against the manifest path", () => {
    const html = renderManifest("manifest: downloads/module.json\nlabel: My Module");
    assert.match(html, /data-manifest="\/downloads\/module\.json"/);
    assert.match(html, /My Module/);
  });

  it("says Foundry cannot check for updates through the link", () => {
    // The link expires, so Foundry's stored manifest URL stops resolving.
    // Saying so on the page is cheaper than the confused bug report.
    assert.match(renderManifest("manifest: m.json"), /cannot check for updates/);
  });

  it("names only the manifest; the zip comes from the manifest itself", () => {
    assert.deepEqual(
      foundryManifestPaths("```foundry-manifest\nmanifest: downloads/module.json\n```\n"),
      ["downloads/module.json"],
    );
  });

  it("reads a relative download field as a vault path", () => {
    const r = manifestDownloadPath(JSON.stringify({ download: "/downloads/mod.zip" }));
    assert.equal(r.path, "downloads/mod.zip");
    assert.equal(r.absolute, null);
  });

  it("reports an absolute download field rather than treating it as a path", () => {
    // It cannot be signed when the vault is reached over a different hostname
    // than the one it names, so the build warns instead of shipping a module
    // whose install dies on its second fetch.
    for (const url of ["https://x.pages.dev/mod.zip", "//x.pages.dev/mod.zip"]) {
      const r = manifestDownloadPath(JSON.stringify({ download: url }));
      assert.equal(r.path, null);
      assert.equal(r.absolute, url);
    }
  });

  it("stays quiet on a manifest with no download field", () => {
    assert.deepEqual(manifestDownloadPath(JSON.stringify({ id: "x" })), { path: null, absolute: null });
    assert.deepEqual(manifestDownloadPath("not json"), { path: null, absolute: null });
  });
});
