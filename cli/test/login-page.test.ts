// Regression tests for the login page's shape.
//
// A role used to imply a password: `role add` always prompted for one, the
// page always rendered a password form, and the role selector always listed
// every non-default role. A vault authenticating purely through Patreon or
// OIDC therefore showed visitors a form they had no credentials for, and a
// selector whose only job was choosing which password to check.
//
// Now the page renders only what the deploy actually has.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderLoginPage } from "../src/render/auth-template.js";

describe("login page", () => {
  it("omits the password form entirely when no role has a password", () => {
    const html = renderLoginPage({
      passwordRoles: [],
      patreonRoles: [],
      oidcDisplayName: "LMU",
    });
    assert.doesNotMatch(html, /id="login-form"/);
    assert.doesNotMatch(html, /type="password"/);
    assert.doesNotMatch(html, /<select/);
    // The provider is still offered; it is the only way in.
    assert.match(html, /data-oidc="LMU"/);
  });

  it("drops the role selector when exactly one role has a password", () => {
    // Nothing to choose, so the role rides as a hidden field.
    const html = renderLoginPage({
      passwordRoles: ["staff"],
      patreonRoles: [],
      oidcDisplayName: null,
    });
    assert.match(html, /id="login-form"/);
    assert.match(html, /type="password"/);
    assert.doesNotMatch(html, /<select/);
    assert.match(html, /name="role" value="staff"/);
  });

  it("renders a selector listing only the roles that have passwords", () => {
    const html = renderLoginPage({
      passwordRoles: ["patron", "dm"],
      patreonRoles: [],
      oidcDisplayName: null,
    });
    assert.match(html, /<select/);
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(options, ["patron", "dm"], "in tier order, lowest first");
  });

  it("does not offer a provider the deploy has not configured", () => {
    const html = renderLoginPage({
      passwordRoles: ["dm"],
      patreonRoles: [],
      oidcDisplayName: null,
    });
    assert.doesNotMatch(html, /data-patreon-roles=/);
    assert.doesNotMatch(html, /data-oidc=/);
  });

  it("advertises both providers alongside a password form", () => {
    const html = renderLoginPage({
      passwordRoles: ["dm"],
      patreonRoles: ["patron"],
      oidcDisplayName: "LMU",
    });
    assert.match(html, /id="login-form"/);
    assert.match(html, /data-patreon-roles="patron"/);
    assert.match(html, /data-oidc="LMU"/);
  });

  it("escapes a provider display name into the attribute", () => {
    // displayName is free text, unlike role names, so it can carry quotes.
    const html = renderLoginPage({
      passwordRoles: [],
      patreonRoles: [],
      oidcDisplayName: 'Acme "Corp" & Co',
    });
    assert.doesNotMatch(html, /data-oidc="Acme "Corp"/);
    assert.match(html, /&quot;Corp&quot;/);
  });
});
