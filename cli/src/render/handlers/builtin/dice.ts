// Built-in inline `dice:` handler.
//
// Mirrors the syntax popularized by Obsidian's Dice Roller plugin:
//
//   The goblin attacks: `dice: 1d20+5` to hit, `dice: 1d6+3` damage.
//
// At build time, the handler renders each formula as a clickable <button>
// with the formula stored in data-formula. The browser-side runtime
// (DICE_RUNTIME_SCRIPT below) ships as a built-in asset, gets concatenated
// into _handlers.js, and parses + rolls on click.
//
// Subset of Dice Roller's syntax: basic XdY +/- Z arithmetic, optional X.
// More complex modifiers (kh, kl, explode, etc.) are not supported.

import type { InlineHandler } from "../types.js";
import { htmlEscape } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

// Formula validation: optional X, then 'd', then Y, then optional ± integer.
// Only used at build time to decide whether render() emits a clickable
// button or a strikethrough <code> fallback. The browser-side parser is
// the source of truth at runtime — see DICE_RUNTIME_SCRIPT.
const FORMULA_RE = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i;

export const diceHandler: InlineHandler = {
  inline: "dice",
  render(content: string): { html: string } {
    const formula = content.trim();
    const escaped = htmlEscape(formula);
    if (!FORMULA_RE.test(formula)) {
      // Not a formula we recognize: fall back to monospace text so the
      // user sees what they wrote and can fix the syntax.
      return {
        html: `<code class="dice-roll dice-roll-invalid" title="unrecognized dice formula">${escaped}</code>`,
      };
    }
    return {
      html: `<button type="button" class="dice-roll" data-formula="${escaped}" title="Click to roll">${escaped}</button>`,
    };
  },
};

// ── Browser runtime ───────────────────────────────────────────────────────
// Click-to-reroll for buttons emitted by render(). Event-delegated so a
// single listener handles every dice button on the page; pages without
// any dice pay only the cost of the listener attachment.

const DICE_RUNTIME_SCRIPT = `
(function () {
  var FORMULA_RE = /^(\\d*)d(\\d+)\\s*([+-]\\s*\\d+)?$/i;
  function roll(formula) {
    var m = FORMULA_RE.exec(formula.trim());
    if (!m) return null;
    var count = m[1] ? parseInt(m[1], 10) : 1;
    var faces = parseInt(m[2], 10);
    var mod = m[3] ? parseInt(m[3].replace(/\\s+/g, ''), 10) : 0;
    if (count < 1 || faces < 1) return null;
    var total = 0;
    var rolls = [];
    for (var i = 0; i < count; i++) {
      var r = 1 + Math.floor(Math.random() * faces);
      rolls.push(r);
      total += r;
    }
    return { total: total + mod, rolls: rolls, mod: mod };
  }
  document.addEventListener('click', function (e) {
    var btn = e.target;
    if (!(btn instanceof HTMLButtonElement)) return;
    if (!btn.classList.contains('dice-roll')) return;
    var formula = btn.dataset.formula;
    if (!formula) return;
    var r = roll(formula);
    if (!r) return;
    var sign = r.mod === 0 ? '' : (r.mod > 0 ? ' + ' + r.mod : ' - ' + Math.abs(r.mod));
    btn.textContent = r.total + ' (' + formula + ')';
    btn.title = '[' + r.rolls.join(', ') + ']' + sign + ' = ' + r.total + ' — click to re-roll';
  });
})();
`;

registerBuiltinAssets(diceHandler, {
  scripts: [{ source: "builtin/dice.runtime.js", content: DICE_RUNTIME_SCRIPT }],
});
