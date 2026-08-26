// Assertions over the GENERATED middleware + login page for the OIDC
// overlay, following the regex-on-generated-source convention from
// handlers.test.ts (the middleware is a template string; there is no way to
// execute it in tests, so we pin the load-bearing strings).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const dir = await mkdtemp(join(tmpdir(), "vault-oidc-"));
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

const OIDC_BLOCK = {
  issuer: "https://issuer.example",
  displayName: "Issuer & Co",
  clientId: "client-123",
  authorizationEndpoint: "https://issuer.example/oauth/authorize",
  tokenEndpoint: "https://issuer.example/oauth/token",
  userinfoEndpoint: "https://issuer.example/oauth/userinfo",
};

const SECRET = "super-secret-value-1234567890";

describe("OIDC middleware + login page generation", () => {
  it("mounts the routes, bakes the endpoints, and never embeds the client secret", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
        oauth: { oidc: { ...OIDC_BLOCK, roleRules: { dm: { emails: ["gm@example.com"] } } } },
      }),
      ".env": `OAUTH_CLIENT_SECRET=${SECRET}\n`,
      "Page.md": "hello\n",
    });
    try {
      await build(v);
      const mw = await readFile(join(v.out, "functions/_middleware.js"), "utf8");
      assert.match(mw, /pathname === "\/auth\/oidc\/start"/);
      assert.match(mw, /pathname === "\/auth\/oidc\/callback"/);
      assert.match(mw, /https:\/\/issuer\.example\/oauth\/authorize/);
      assert.match(mw, /code_challenge_method/);
      assert.ok(!mw.includes(SECRET), "client secret must never reach the middleware bundle");

      const login = await readFile(join(v.out, "login.html"), "utf8");
      // Attribute-escaped display name (free text, unlike role names).
      assert.match(login, /data-oidc="Issuer &amp; Co"/);
      assert.doesNotMatch(login, /__OIDC_ATTR__/);
    } finally { await cleanup(v); }
  });

  it("omits the routes and button when oidc has no role rules", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
        oauth: { oidc: { ...OIDC_BLOCK, roleRules: {} } },
      }),
      "Page.md": "hello\n",
    });
    try {
      await build(v);
      const mw = await readFile(join(v.out, "functions/_middleware.js"), "utf8");
      assert.match(mw, /const OIDC = null;/);
      const login = await readFile(join(v.out, "login.html"), "utf8");
      assert.doesNotMatch(login, /data-oidc=/);
    } finally { await cleanup(v); }
  });

  it("omits the oidc block entirely for a vault without oauth config", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
      }),
      "Page.md": "hello\n",
    });
    try {
      await build(v);
      const mw = await readFile(join(v.out, "functions/_middleware.js"), "utf8");
      assert.match(mw, /const OIDC = null;/);
      const login = await readFile(join(v.out, "login.html"), "utf8");
      assert.doesNotMatch(login, /data-oidc=/);
    } finally { await cleanup(v); }
  });
});
