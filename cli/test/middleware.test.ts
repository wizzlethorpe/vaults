// End-to-end tests for the generated Pages Function.
//
// Several test files in this directory state that "the middleware is a
// template string; there is no way to execute it in tests, so we pin the
// load-bearing strings." That is not true: the emitted `_middleware.js` is
// plain ESM exporting `onRequest`, and every global it uses (crypto.subtle,
// Request/Response, TextEncoder, atob/btoa) exists in Node 22. Writing it to
// a temp file and importing it costs a few lines and exercises the real
// thing — the role gate, the variant rewrite, the redirect guards, and the
// PBKDF2 round-trip between cli/src/auth.ts and the middleware's own copy.
//
// That round-trip matters most: hashPassword (cli/src/auth.ts) and
// verifyPassword (render/auth-template.ts) are independent implementations of
// one hash format. If the iteration count, hex casing, or derived-bit length
// drifts on either side, every user of every deployed vault is locked out,
// and nothing else in the suite would notice.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { renderAuthMiddleware, type AuthTemplateConfig } from "../src/render/auth-template.js";
import { hashPassword } from "../src/auth.js";

const SECRET = "0".repeat(64);

/**
 * Mint a token the way the middleware does, so a test can present one it did
 * not receive: `typ` null produces the untyped pre-upgrade form.
 */
async function forgeToken(typ: string | null, role: string, ttl: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = typ === null ? `${role}.${exp}` : `${typ}.${role}.${exp}`;
  const key = await crypto.subtle.importKey(
    "raw", Buffer.from(SECRET, "hex"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${hex}`;
}

interface Middleware {
  onRequest(ctx: { request: Request; env: Record<string, unknown>; next: () => Response | Promise<Response> }): Promise<Response>;
}

/** Render the middleware for `cfg`, write it out, and import it as real ESM. */
async function loadMiddleware(cfg: AuthTemplateConfig): Promise<Middleware> {
  const dir = await mkdtemp(join(tmpdir(), "vault-mw-"));
  const file = join(dir, "middleware.mjs");
  await writeFile(file, renderAuthMiddleware(cfg));
  return (await import(pathToFileURL(file).href)) as Middleware;
}

/**
 * Drive one request. The variant rewrite goes through `env.ASSETS.fetch`, so
 * the stub echoes back the path it was asked for — which is exactly the thing
 * under test: which `_variants/<role>/` prefix a given visitor gets.
 */
async function call(
  mw: Middleware,
  url: string,
  init: RequestInit = {},
  extraEnv: Record<string, unknown> = {},
): Promise<Response> {
  return mw.onRequest({
    request: new Request(url, init),
    env: {
      SESSION_SECRET: SECRET,
      ASSETS: { fetch: (req: Request) => new Response(new URL(req.url).pathname) },
      ...extraEnv,
    },
    next: () => new Response("NEXT"),
  });
}

describe("generated auth middleware", () => {
  let mw: Middleware;
  let dmCookie: string;

  before(async () => {
    mw = await loadMiddleware({
      roles: ["public", "dm"],
      foundry: true,
      rolePasswords: { dm: await hashPassword("hunter2") },
    });
  });

  it("accepts a correct password and issues a session cookie", async () => {
    // The real PBKDF2 round-trip: hashed by cli/src/auth.ts, verified by the
    // middleware's own independent implementation.
    const res = await call(mw, "https://v.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "role=dm&password=hunter2&next=/",
    });
    assert.equal(res.status, 302);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    // Typed: "s" marks it a session cookie, so it cannot be replayed as a
    // 90-day bearer.
    assert.match(setCookie, /vault_role=s\.dm\./);
    dmCookie = setCookie.split(";")[0]!;
  });

  it("rejects a wrong password without saying which part was wrong", async () => {
    const res = await call(mw, "https://v.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "role=dm&password=wrong&next=/",
    });
    assert.equal(res.status, 302);
    // One generic code, so an attacker can't enumerate which roles exist.
    assert.match(res.headers.get("Location") ?? "", /error=auth_failed/);
  });

  it("rewrites a request to the variant for the visitor's role", async () => {
    const res = await call(mw, "https://v.example/secret", { headers: { Cookie: dmCookie } });
    assert.equal(await res.text(), "/_variants/dm/secret");
  });

  it("serves the default variant to an anonymous visitor", async () => {
    const res = await call(mw, "https://v.example/secret");
    assert.equal(await res.text(), "/_variants/public/secret");
  });

  it("404s a direct hit on _variants, whatever the role", async () => {
    // Without this, anyone could fetch any tier's pages by guessing a role.
    const res = await call(mw, "https://v.example/_variants/dm/secret", { headers: { Cookie: dmCookie } });
    assert.equal(res.status, 404);
  });

  it("refuses a session cookie presented as a bearer token", async () => {
    // The two were byte-identical in format before they carried a type, so
    // a 7-day session cookie could be replayed as a 90-day bearer.
    const value = dmCookie.split("=")[1]!;
    const res = await call(mw, "https://v.example/secret", {
      headers: { Authorization: `Bearer ${value}` },
    });
    assert.equal(await res.text(), "/_variants/public/secret", "must fall back to the default role");
  });

  it("sends Referrer-Policy and nosniff on every response", async () => {
    const res = await call(mw, "https://v.example/secret");
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("still accepts an untyped token issued before the upgrade", async () => {
    // Compatibility window: tokens minted by an older deploy have no type
    // segment and must keep working, or every existing bearer and session
    // breaks on push. They age out within 90 days on their own.
    const legacy = await forgeToken(null, "dm", 3600);
    const res = await call(mw, "https://v.example/secret", {
      headers: { Authorization: `Bearer ${legacy}` },
    });
    assert.equal(await res.text(), "/_variants/dm/secret");
  });

  it("refuses an off-site redirect through ?next=", async () => {
    const res = await call(mw, "https://v.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "role=dm&password=hunter2&next=//evil.example/",
    });
    assert.equal(res.headers.get("Location"), "/");
  });

  it("authenticates nothing through a token in the URL, even on a fetch", async () => {
    // A token in a URL lands in history, logs and Referer; graft sends its bearer as a header.
    const bearer = await forgeToken("b", "dm", 3600);
    const res = await call(mw, "https://v.example/secret?_token=" + bearer, {
      headers: { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
    });
    assert.equal(await res.text(), "/_variants/public/secret");
  });

});

describe("the grafts.json a reader downloads", () => {
  let mw: Middleware;
  let dmCookie: string;

  /** Each variant serves its own file, so the role the gate picked is visible. */
  const served = {
    fetch: (req: Request) => new Response(JSON.stringify({
      format: 4,
      entries: [{ id: "0123456789abcdef", type: "Actor", patch: { name: new URL(req.url).pathname } }],
      assets: { http: { auth: { "https://assets.example": "" }, files: [{
        // The zip-and-fallback shape `zip_assets` produces.
        source: ["https://assets.example/_foundry/assets-1.zip#a.webp", "https://assets.example/a.webp?v=1"],
        destination: "vaults/v/a.webp",
        size: 1,
      }] } },
    })),
  };
  const download = (init: RequestInit = {}) =>
    call(mw, "https://v.example/_foundry/grafts.json", init, { ASSETS: served });

  before(async () => {
    mw = await loadMiddleware({
      roles: ["public", "dm"],
      foundry: true,
      rolePasswords: { dm: await hashPassword("hunter2") },
    });
    const res = await call(mw, "https://v.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "role=dm&password=hunter2&next=/",
    });
    dmCookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  });

  it("serves each visitor the file built for their own role", async () => {
    // Fetched by the middleware rather than passed through, so a caller
    // cannot ask for another role's copy by naming its path.
    const dm = await (await download({ headers: { Cookie: dmCookie } })).json() as any;
    assert.equal(dm.entries[0].patch.name, "/_variants/dm/_foundry/grafts.json");
    const anon = await (await download()).json() as any;
    assert.equal(anon.entries[0].patch.name, "/_variants/public/_foundry/grafts.json");
  });

  it("splices in a bearer the asset handler can use", async () => {
    const file = await (await download({ headers: { Cookie: dmCookie } })).json() as any;
    const token = file.assets.http.auth["https://assets.example"];
    assert.match(token, /^b\.dm\./, "must be a typed bearer for the role that asked");
  });

  it("fills in exactly the origins the build named, whatever host the request came in on", async () => {
    // A deploy answers on more than one host; a token filed under the request's
    // host instead would never be sent, and every asset would 401.
    const file = await (await download({ headers: { Cookie: dmCookie } })).json() as any;
    assert.deepEqual(Object.keys(file.assets.http.auth), ["https://assets.example"]);
  });
});

describe("OAuth state cookie", () => {
  it("survives a page path outside Latin-1", async () => {
    // btoa throws above U+00FF, so a page named e.g. Sunawi with a
    // w-circumflex used to make /auth/oidc/start an unhandled 500. Relevant
    // to any vault whose page titles aren't plain ASCII.
    const mw = await loadMiddleware({
      roles: ["public", "staff"],
      foundry: true,
      rolePasswords: {},
      oidc: {
        displayName: "LMU",
        clientId: "cid",
        authorizationEndpoint: "https://idp.example/auth",
        tokenEndpoint: "https://idp.example/token",
        userinfoEndpoint: "https://idp.example/me",
        roleRules: { staff: { domains: ["lmu.edu"] } },
      },
    });
    for (const path of ["/plain", "/Sunaŵi", "/ページ", "/Ördögök"]) {
      const res = await call(
        mw,
        "https://v.example/auth/oidc/start?next=" + encodeURIComponent(path),
        {},
        { OAUTH_CLIENT_SECRET: "shhh" },
      );
      assert.equal(res.status, 302, `expected a redirect for ${path}`);
      assert.match(res.headers.get("Set-Cookie") ?? "", /vault_oauth_state=/, `no state cookie for ${path}`);
    }
  });

  it("refuses to start the flow when the client secret was never uploaded", async () => {
    // A deploy missing the Wrangler secret should say so rather than
    // bouncing the visitor through a flow that cannot complete.
    const mw = await loadMiddleware({
      roles: ["public", "staff"],
      foundry: true,
      rolePasswords: {},
      oidc: {
        displayName: "LMU",
        clientId: "cid",
        authorizationEndpoint: "https://idp.example/auth",
        tokenEndpoint: "https://idp.example/token",
        userinfoEndpoint: "https://idp.example/me",
        roleRules: { staff: { domains: ["lmu.edu"] } },
      },
    });
    const res = await call(mw, "https://v.example/auth/oidc/start?next=%2F");
    assert.equal(res.status, 500);
    assert.match(await res.text(), /OAUTH_CLIENT_SECRET/);
  });
});
