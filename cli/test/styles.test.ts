// Tests for theme CSS generation (DEFAULT_CSS + renderThemeOverride):
//   - User accent/bg overrides must actually win over the built-in defaults
//     in dark mode, not just light mode.
//
// Regression: the default dark/auto blocks used to also set the theme vars on
// a `:root[data-theme="dark"] body` compound selector. That selector out-
// specifies the override's `:root[data-theme="dark"]`, so a user's
// `accent_color_dark` was shadowed by the default red and never showed — even
// though light mode (which has no `body` variant) worked fine.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CSS, renderThemeOverride } from "../src/render/styles.js";

describe("theme CSS overrides", () => {
  it("default dark/auto blocks don't set vars on a higher-specificity body selector", () => {
    // A `[data-theme=...] body` selector (specificity 0,2,1) would beat the
    // override's `[data-theme=...]` (0,2,0) regardless of source order.
    assert.doesNotMatch(DEFAULT_CSS, /\[data-theme="dark"\]\s+body/);
    assert.doesNotMatch(DEFAULT_CSS, /\[data-theme="auto"\]\s+body/);
  });

  it("a dark accent override targets the same selectors as the defaults so it wins by source order", () => {
    const override = renderThemeOverride({ darkAccent: "#a87bbf" });
    // Toggled dark and OS-preference (auto) dark both get the override.
    assert.match(override, /:root\[data-theme="dark"\]\s*\{[^}]*--accent:\s*#a87bbf/);
    assert.match(
      override,
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme="auto"\][^}]*--accent:\s*#a87bbf/,
    );

    // The override selectors must match the default ones verbatim; the override
    // is appended after DEFAULT_CSS, so identical selectors mean it wins.
    assert.ok(DEFAULT_CSS.includes(`:root[data-theme="dark"] {`));
    assert.ok(override.includes(`:root[data-theme="dark"] {`));
  });

  it("an empty override produces no CSS", () => {
    assert.equal(renderThemeOverride({}), "");
  });
});
