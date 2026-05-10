// End-to-end tests for role-based access gating.
//
// All assertions go through buildSite() against a temp on-disk vault: this
// is the same code path that runs in production, so a regression in any of
// the gating layers (per-variant page filtering, callout redaction, manifest
// emission, body-meta hashing) shows up here.
//
// We deliberately avoid the bases-style "test the helper directly" pattern
// because role gating is woven across scan / render / build / manifest, and
// a unit test of any single layer would let a regression in another layer
// slip through.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";

interface Vault { dir: string; out: string; }

/** Build a temp vault from a path → contents map; caller must `cleanup`. */
async function setupVault(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-role-"));
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
  // buildSite logs progress to stdout (Scanning..., Pages..., Built in...).
  // Useful when running the CLI; pure noise in test output. Swallow during
  // the test call; expected warnings (broken cross-tier wikilinks) are
  // verified separately by inspecting the rendered HTML.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
      vaultName: "Test",
      // 0 disables image compression; the test vaults below ship no images
      // anyway, but this also skips an unrelated sharp warm-up cost.
      imageQuality: 0,
      maxFileBytes: 1 << 30,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

interface ManifestEntry {
  path: string;
  hash: string;
  meta?: { role: string; foundry?: { base?: string } };
}
interface Manifest { auth: { required: boolean; roles: string[] }; files: ManifestEntry[]; }

/** Three-role vaultrc with placeholder password hashes (roleAdd hashes match this shape). */
const VAULTRC_3 = JSON.stringify({
  roles: ["public", "patron", "dm"],
  rolePasswords: {
    patron: "100000:0000:0000",
    dm: "100000:0000:0000",
  },
});

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

const VARIANT = (role: string, path: string) => `_variants/${role}/${path}`;

// ── Page-level role gating ────────────────────────────────────────────────

describe("role gating: page visibility", () => {
  it("role: dm pages are absent from public + patron variants, present in dm", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open\n\nVisible to everyone.",
      "Secret.md": "---\nrole: dm\n---\n# Secret\n\nDM only.",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "Secret.html"))), false);
      assert.equal(await exists(join(v.out, VARIANT("patron", "Secret.html"))), false);
      assert.equal(await exists(join(v.out, VARIANT("dm", "Secret.html"))), true);
      // The default-tier page rides everywhere.
      assert.equal(await exists(join(v.out, VARIANT("public", "Open.html"))), true);
      assert.equal(await exists(join(v.out, VARIANT("patron", "Open.html"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "Open.html"))), true);
    } finally { await cleanup(v); }
  });

  it("role: patron pages are absent from public, present in patron + dm", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Half.md": "---\nrole: patron\n---\n# Half\n\nFor supporters.",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "Half.html"))), false);
      assert.equal(await exists(join(v.out, VARIANT("patron", "Half.html"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "Half.html"))), true);
    } finally { await cleanup(v); }
  });

  it("role-gated pages don't appear in the lower-tier variant's search index", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open",
      "Secret.md": "---\nrole: dm\n---\n# Top Secret",
    });
    try {
      await build(v);
      const publicSearch = await readJson(join(v.out, VARIANT("public", "_search-index.json"))) as Array<{ title: string }>;
      const titles = publicSearch.map((e) => e.title);
      assert.ok(titles.includes("Open"), "public search should include public-tier pages");
      assert.ok(!titles.includes("Top Secret"), "public search must not leak DM titles");
    } finally { await cleanup(v); }
  });

  it("a page tagged with a role outside the configured set falls back to default with a warning", async () => {
    // Captures the legitimate-typo case (`role: dn` instead of `dm`): the
    // page must NOT silently land in the highest tier — it should fall back
    // to public so the typo doesn't accidentally publish DM-only content.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Typo.md": "---\nrole: dn\n---\n# Page with typo",
    });
    try {
      await build(v);
      // Falls back to default (public), so it appears at every tier.
      assert.equal(await exists(join(v.out, VARIANT("public", "Typo.html"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "Typo.html"))), true);
    } finally { await cleanup(v); }
  });
});

// ── Callout-level redaction ───────────────────────────────────────────────

describe("role gating: callouts", () => {
  it("[!dm] callouts are stripped from public + patron variants", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "NPC.md": [
        "# NPC",
        "",
        "Public bio paragraph.",
        "",
        "> [!dm] Secret motivation",
        "> The party shouldn't know this.",
        "",
        "Trailing public paragraph.",
      ].join("\n"),
    });
    try {
      await build(v);
      const pub = await readFile(join(v.out, VARIANT("public", "NPC.body.html")), "utf8");
      const pat = await readFile(join(v.out, VARIANT("patron", "NPC.body.html")), "utf8");
      const dm = await readFile(join(v.out, VARIANT("dm", "NPC.body.html")), "utf8");

      assert.ok(!pub.includes("Secret motivation"), "public variant must not leak DM callout title");
      assert.ok(!pub.includes("party shouldn't know"), "public variant must not leak DM callout body");
      assert.ok(!pub.includes("callout-dm"), "public variant must not contain the dm callout class");
      assert.ok(pub.includes("Public bio paragraph"), "non-redacted content should remain");
      assert.ok(pub.includes("Trailing public paragraph"), "content after the redacted callout should remain");

      assert.ok(!pat.includes("Secret motivation"), "patron variant must not leak DM callout");

      assert.ok(dm.includes("Secret motivation"));
      assert.ok(dm.includes("callout-dm"));
    } finally { await cleanup(v); }
  });

  it("[!patron] callouts are stripped from public only", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "NPC.md": [
        "# NPC",
        "",
        "> [!patron] Patreon-only lore",
        "> Backers see this.",
      ].join("\n"),
    });
    try {
      await build(v);
      const pub = await readFile(join(v.out, VARIANT("public", "NPC.body.html")), "utf8");
      const pat = await readFile(join(v.out, VARIANT("patron", "NPC.body.html")), "utf8");
      const dm = await readFile(join(v.out, VARIANT("dm", "NPC.body.html")), "utf8");

      assert.ok(!pub.includes("Patreon-only lore"));
      assert.ok(pat.includes("Patreon-only lore"));
      assert.ok(dm.includes("Patreon-only lore"));
    } finally { await cleanup(v); }
  });

  it("a callout with no title uses the type name as the header (body stays intact)", async () => {
    // Regression: the CALLOUT_RE used `\\s*` (which includes \\n) between the
    // type bracket and the title, so an empty-title callout swallowed the
    // entire body line into the title and left the body empty. Switching
    // to `[ \\t]*` keeps the header generation correct.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Page.md": [
        "# Page",
        "",
        "> [!info]",
        "> Body content stays in the body, not the title.",
      ].join("\n"),
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, VARIANT("public", "Page.body.html")), "utf8");
      assert.match(html, /<div class="callout-title">Info<\/div>/, "default title should be type-cased");
      assert.match(html, /Body content stays in the body, not the title\./);
      assert.ok(!html.includes('<div class="callout-title">Body content'),
        "body must not have been hoisted into the title slot");
    } finally { await cleanup(v); }
  });

  it("non-role callouts (note, info, warning) are never redacted", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "NPC.md": [
        "# NPC",
        "",
        "> [!note] A regular note",
        "> Plain content.",
        "",
        "> [!warning] Heads up",
        "> Another non-role callout.",
      ].join("\n"),
    });
    try {
      await build(v);
      for (const role of ["public", "patron", "dm"]) {
        const html = await readFile(join(v.out, VARIANT(role, "NPC.body.html")), "utf8");
        assert.ok(html.includes("A regular note"), `[!note] should survive in ${role}`);
        assert.ok(html.includes("Heads up"), `[!warning] should survive in ${role}`);
      }
    } finally { await cleanup(v); }
  });

  it("nested DM callouts inside a patron-tier page are stripped from patron, kept in dm", async () => {
    // Patron page with a DM callout inside it. The page is visible at patron
    // and dm tiers; the callout should only render at dm.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Cult.md": [
        "---",
        "role: patron",
        "---",
        "# The Cult",
        "",
        "What patrons see.",
        "",
        "> [!dm] DM only",
        "> The cult worships a buried entity.",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "Cult.html"))), false);

      const pat = await readFile(join(v.out, VARIANT("patron", "Cult.body.html")), "utf8");
      const dm = await readFile(join(v.out, VARIANT("dm", "Cult.body.html")), "utf8");

      assert.ok(pat.includes("What patrons see"));
      assert.ok(!pat.includes("worships a buried entity"));
      assert.ok(!pat.includes("callout-dm"));

      assert.ok(dm.includes("worships a buried entity"));
    } finally { await cleanup(v); }
  });
});

// ── Manifest contract ─────────────────────────────────────────────────────

describe("role gating: manifest contract", () => {
  it("multi-role build sets auth.required = true and lists roles in order", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "A.md": "# A",
    });
    try {
      await build(v);
      const m = await readJson(join(v.out, VARIANT("public", "_manifest.json"))) as Manifest;
      assert.equal(m.auth.required, true);
      assert.deepEqual(m.auth.roles, ["public", "patron", "dm"]);
    } finally { await cleanup(v); }
  });

  it("single-role build sets auth.required = false (no functions deployed)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "A.md": "# A",
    });
    try {
      await build(v);
      // Single-role builds collapse to the deploy root — no _variants prefix.
      const m = await readJson(join(v.out, "_manifest.json")) as Manifest;
      assert.equal(m.auth.required, false);
      assert.deepEqual(m.auth.roles, ["public"]);
    } finally { await cleanup(v); }
  });

  it("each .body.html entry carries meta.role for the page's tier", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open",
      "Half.md": "---\nrole: patron\n---\n# Half",
      "Secret.md": "---\nrole: dm\n---\n# Secret",
    });
    try {
      await build(v);
      const m = await readJson(join(v.out, VARIANT("dm", "_manifest.json"))) as Manifest;
      const byPath = new Map(m.files.filter((f) => f.path.endsWith(".body.html")).map((f) => [f.path, f.meta?.role]));
      assert.equal(byPath.get("Open.body.html"), "public");
      assert.equal(byPath.get("Half.body.html"), "patron");
      assert.equal(byPath.get("Secret.body.html"), "dm");
    } finally { await cleanup(v); }
  });

  it("higher-tier pages don't appear in lower-tier manifests", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open",
      "Secret.md": "---\nrole: dm\n---\n# Secret",
    });
    try {
      await build(v);
      const pubManifest = await readJson(join(v.out, VARIANT("public", "_manifest.json"))) as Manifest;
      const paths = pubManifest.files.map((f) => f.path);
      assert.ok(paths.includes("Open.body.html"));
      assert.ok(!paths.includes("Secret.body.html"), "public manifest leaked a DM-tier page");
      assert.ok(!paths.includes("Secret.html"));
    } finally { await cleanup(v); }
  });

  it("manifest hash folds in meta.role so a frontmatter-only role flip triggers re-sync", async () => {
    // The Foundry side relies on the manifest hash changing when meta does;
    // otherwise a page's role flipping (patron → public, say) wouldn't trip
    // the diff and the importer wouldn't re-evaluate ownership.
    const v1 = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "P.md": "---\nrole: patron\n---\n# Same body",
    });
    const v2 = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "P.md": "---\nrole: dm\n---\n# Same body",
    });
    try {
      await build(v1);
      await build(v2);
      const m1 = await readJson(join(v1.out, VARIANT("dm", "_manifest.json"))) as Manifest;
      const m2 = await readJson(join(v2.out, VARIANT("dm", "_manifest.json"))) as Manifest;
      const h1 = m1.files.find((f) => f.path === "P.body.html")?.hash;
      const h2 = m2.files.find((f) => f.path === "P.body.html")?.hash;
      assert.ok(h1 && h2, "both manifests should have a hash for P.body.html");
      assert.notEqual(h1, h2, "role flip without body change must still bump the manifest hash");
    } finally {
      await cleanup(v1);
      await cleanup(v2);
    }
  });
});

// ── Passthrough files (audio/video/pdf/epub) ─────────────────────────────

describe("role gating: passthrough files", () => {
  it("audio referenced only by a dm-tier page does not ship to public/patron", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open\n\nNothing audio here.",
      "Secret.md": "---\nrole: dm\n---\n# Secret\n\nListen: ![[clue.ogg]]",
      "Audio/clue.ogg": "FAKE OGG BYTES",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "Audio/clue.ogg"))), false,
        "public must not receive a DM-only audio cue");
      assert.equal(await exists(join(v.out, VARIANT("patron", "Audio/clue.ogg"))), false,
        "patron must not receive a DM-only audio cue");
      assert.equal(await exists(join(v.out, VARIANT("dm", "Audio/clue.ogg"))), true,
        "dm should receive the audio cue it references");
    } finally { await cleanup(v); }
  });

  it("audio referenced by a public-tier page ships everywhere", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open\n\nListen: ![[jingle.ogg]]",
      "Audio/jingle.ogg": "FAKE OGG BYTES",
    });
    try {
      await build(v);
      for (const role of ["public", "patron", "dm"]) {
        assert.equal(await exists(join(v.out, VARIANT(role, "Audio/jingle.ogg"))), true,
          `public-referenced audio should ship to ${role}`);
      }
    } finally { await cleanup(v); }
  });

  it("standard markdown links also count as references", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Hub.md": "# Hub\n\n[Download the playbook](handouts/playbook.pdf)",
      "handouts/playbook.pdf": "FAKE PDF BYTES",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "handouts/playbook.pdf"))), true,
        "markdown-link reference should pull the file in");
    } finally { await cleanup(v); }
  });

  it("a passthrough file referenced by no page does not ship at all", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open",
      "Audio/orphan.ogg": "UNREFERENCED",
    });
    try {
      await build(v);
      for (const role of ["public", "patron", "dm"]) {
        assert.equal(await exists(join(v.out, VARIANT(role, "Audio/orphan.ogg"))), false,
          `unreferenced audio must not ship to ${role}`);
      }
    } finally { await cleanup(v); }
  });

  it("unknown-extension files are skipped by default", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Open.md": "# Open\n\n[playbook](handouts/playbook.xyz)",
      "handouts/playbook.xyz": "MYSTERIOUS",
    });
    try {
      await build(v);
      // Default: unknown extensions don't ship anywhere even if referenced.
      // Forces the user to opt in (or rename to a supported extension), so a
      // stray binary blob can't quietly leak DM content.
      for (const role of ["public", "patron", "dm"]) {
        assert.equal(await exists(join(v.out, VARIANT(role, "handouts/playbook.xyz"))), false);
      }
    } finally { await cleanup(v); }
  });

  it("include_unknown_files: true folds unknowns into the passthrough pool", async () => {
    // Only ships when referenced — same gating contract as recognised media.
    const settings = `---\ninclude_unknown_files: true\n---\n`;
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "settings.md": settings,
      "Open.md": "# Open\n\n[bundle](data/bundle.xyz)",
      "data/bundle.xyz": "FAKE XYZ",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "data/bundle.xyz"))), true);
    } finally { await cleanup(v); }
  });

  it("include_unknown_files still respects role gating (referenced from dm only)", async () => {
    const settings = `---\ninclude_unknown_files: true\n---\n`;
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "settings.md": settings,
      "Open.md": "# Open",
      "Secret.md": "---\nrole: dm\n---\n# Secret\n\n[bundle](data/bundle.xyz)",
      "data/bundle.xyz": "DM-ONLY XYZ",
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "data/bundle.xyz"))), false,
        "even with include_unknown_files=true, dm-referenced files must not leak to public");
      assert.equal(await exists(join(v.out, VARIANT("dm", "data/bundle.xyz"))), true);
    } finally { await cleanup(v); }
  });

  // Locks the leak the user spotted in the role-gated-callout discussion:
  // before the fix, `copyReferencedPassthroughs` / `copyReferencedImages`
  // walked the source markdown verbatim, picking up references inside
  // [!dm] callouts even on `role: public` pages. The renderer hid the
  // callout from the rendered HTML, but the asset still shipped to the
  // public deploy and was reachable by direct URL.
  it("asset embedded inside a role-gated callout on a public page does not ship to lower-tier deploys", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "secret.pdf": "DM HANDOUT",
      "Open.md": [
        "# Open",
        "",
        "Body content visible to everyone.",
        "",
        "> [!dm] DM only",
        "> Take a look at this handout: [secret.pdf](secret.pdf)",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "secret.pdf"))), false,
        "public deploy must not ship a passthrough referenced only inside a [!dm] callout");
      assert.equal(await exists(join(v.out, VARIANT("patron", "secret.pdf"))), false,
        "patron deploy must not ship it either (callout type is dm)");
      assert.equal(await exists(join(v.out, VARIANT("dm", "secret.pdf"))), true,
        "dm deploy ships it (the callout is visible there)");
    } finally { await cleanup(v); }
  });

  // Same leak shape as above but for image embeds via the wikilink form.
  it("image embedded inside a role-gated callout does not ship to lower-tier deploys", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "attachments/secret-map.webp": Buffer.from("placeholder"),
      "Open.md": [
        "# Open",
        "",
        "Public content.",
        "",
        "> [!dm] DM only",
        "> ![[secret-map.webp]]",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "attachments/secret-map.webp"))), false);
      assert.equal(await exists(join(v.out, VARIANT("dm", "attachments/secret-map.webp"))), true);
    } finally { await cleanup(v); }
  });

  // `@vault/PATH` references in frontmatter (e.g., a Scene's
  // foundry.data.background.src) gate the asset into the variant. Ships per
  // page-role: a dm-tier page's @vault ref reaches only the dm deploy.
  it("@vault/PATH in a public page's frontmatter ships the asset to all variants the page is visible in", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "attachments/scene-bg.webp": Buffer.from("placeholder"),
      "Scene.md": [
        "---",
        "title: Test Scene",
        "foundry:",
        "  base: Scene",
        "  data:",
        "    background:",
        "      src: \"@vault/attachments/scene-bg.webp\"",
        "---",
        "# Test",
      ].join("\n"),
    });
    try {
      await build(v);
      // Page is `role: public` (default), so all three variants get the asset.
      assert.equal(await exists(join(v.out, VARIANT("public", "attachments/scene-bg.webp"))), true);
      assert.equal(await exists(join(v.out, VARIANT("patron", "attachments/scene-bg.webp"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "attachments/scene-bg.webp"))), true);
    } finally { await cleanup(v); }
  });

  it("@vault/PATH in a dm-tier page's frontmatter ships only to the dm variant", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Audio/secret-cue.ogg": Buffer.from("placeholder"),
      "Secret.md": [
        "---",
        "title: Secret Playlist",
        "role: dm",
        "foundry:",
        "  base: Playlist",
        "  data:",
        "    sounds:",
        "      - { name: cue, path: \"@vault/Audio/secret-cue.ogg\" }",
        "---",
        "# Secret",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "Audio/secret-cue.ogg"))), false);
      assert.equal(await exists(join(v.out, VARIANT("patron", "Audio/secret-cue.ogg"))), false);
      assert.equal(await exists(join(v.out, VARIANT("dm", "Audio/secret-cue.ogg"))), true);
    } finally { await cleanup(v); }
  });

  // [!patron] is a different role tier than [!dm] — make sure the
  // strip is keyed off the actual role set in settings, not a hardcoded
  // "dm" check.
  it("asset inside [!patron] callout on a public page ships to patron+ but not public", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "patron-bonus.pdf": "PATRON HANDOUT",
      "Open.md": [
        "# Open",
        "",
        "> [!patron] For supporters",
        "> [patron-bonus.pdf](patron-bonus.pdf)",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "patron-bonus.pdf"))), false);
      assert.equal(await exists(join(v.out, VARIANT("patron", "patron-bonus.pdf"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "patron-bonus.pdf"))), true);
    } finally { await cleanup(v); }
  });

  // Over-strip guard: callouts whose type isn't a role name (info, note,
  // warning, custom) are not redacted. Their inline assets must still
  // ship to every variant the page is visible in.
  it("asset inside a non-role callout ([!info]) is not stripped — ships everywhere", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "diagram.pdf": "PUBLIC DIAGRAM",
      "Open.md": [
        "# Open",
        "",
        "> [!info] FYI",
        "> See [diagram.pdf](diagram.pdf) for the layout.",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "diagram.pdf"))), true);
      assert.equal(await exists(join(v.out, VARIANT("patron", "diagram.pdf"))), true);
      assert.equal(await exists(join(v.out, VARIANT("dm", "diagram.pdf"))), true);
    } finally { await cleanup(v); }
  });

  // Cover-image auto-discovery happens upstream of variants and used to
  // walk the unstripped source — picking up an image embedded inside a
  // [!dm] callout as the page's cover would leak it to the public deploy
  // (since coverImage is the same URL across variants). The fix strips
  // ALL role-typed callouts before discovery; verifies that here.
  it("cover-image auto-discovery skips images embedded inside role-gated callouts", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "attachments/secret-only.webp": Buffer.from("placeholder"),
      "attachments/public-shot.webp": Buffer.from("placeholder"),
      "Open.md": [
        "# Open",
        "",
        "Body prose.",
        "",
        "> [!dm] DM only",
        "> ![[secret-only.webp]]",
        "",
        "![[public-shot.webp]]",
      ].join("\n"),
    });
    try {
      await build(v);
      // The cover should resolve to public-shot.webp (the first image
      // outside any role-gated callout). secret-only.webp must not ship
      // to lower tiers either as a body ref or as a cover.
      assert.equal(await exists(join(v.out, VARIANT("public", "attachments/secret-only.webp"))), false,
        "an image only ever embedded inside [!dm] must not become the public cover");
      assert.equal(await exists(join(v.out, VARIANT("public", "attachments/public-shot.webp"))), true,
        "the body image outside the callout still ships");
    } finally { await cleanup(v); }
  });

  // Demos commonly nest @vault/ refs deep in foundry.data (e.g., a
  // Scene's tiles[0].texture.src or sounds[0].path). The frontmatter
  // walker has to recurse through arrays + nested objects, not just
  // top-level keys.
  it("@vault/PATH nested deep in frontmatter arrays is still picked up", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "attachments/tile.webp": Buffer.from("placeholder"),
      "Audio/sound.ogg": Buffer.from("placeholder"),
      "Scene.md": [
        "---",
        "title: Nested",
        "foundry:",
        "  base: Scene",
        "  data:",
        "    tiles:",
        "      - { texture: { src: \"@vault/attachments/tile.webp\" } }",
        "    sounds:",
        "      - { path: \"@vault/Audio/sound.ogg\" }",
        "---",
        "# Nested",
      ].join("\n"),
    });
    try {
      await build(v);
      assert.equal(await exists(join(v.out, VARIANT("public", "attachments/tile.webp"))), true,
        "image referenced via foundry.data.tiles[0].texture.src must ship");
      assert.equal(await exists(join(v.out, VARIANT("public", "Audio/sound.ogg"))), true,
        "audio referenced via foundry.data.sounds[0].path must ship");
    } finally { await cleanup(v); }
  });
});

// ── Wikilink behaviour across tiers ───────────────────────────────────────

describe("role gating: wikilinks across tiers", () => {
  it("wikilinks to higher-tier pages are unresolved at lower tiers", async () => {
    // A public page links to a DM page. The DM target is invisible at the
    // public tier, so the link must NOT silently render as a working link
    // (which would reveal the existence of DM content via the URL).
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_3,
      "Hub.md": "# Hub\n\nSee [[Secret]].",
      "Secret.md": "---\nrole: dm\n---\n# Secret",
    });
    try {
      await build(v);
      const pub = await readFile(join(v.out, VARIANT("public", "Hub.body.html")), "utf8");
      const dm = await readFile(join(v.out, VARIANT("dm", "Hub.body.html")), "utf8");

      // At dm tier, the wikilink resolves to a normal anchor.
      assert.match(dm, /<a[^>]*href="\/Secret"/);
      // At public tier, it falls through to an unresolved-link span.
      assert.ok(!/<a[^>]*href="\/Secret"/.test(pub),
        "public render must not link to a DM-tier page");
      assert.match(pub, /is-unresolved/);
    } finally { await cleanup(v); }
  });
});
