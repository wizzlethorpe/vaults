// Built-in code-block `statblock` handler — D&D 5e creature statblocks.
//
// Schema is compatible with the Fantasy Statblocks Obsidian plugin so the
// same source renders in Obsidian (via the plugin) and on the published
// wiki (via this handler):
//
//   ```statblock
//   name: Goblin
//   size: Small
//   type: humanoid
//   ac: 15
//   hp: 7
//   hit_dice: 2d6
//   speed: 30 ft.
//   stats: [8, 14, 10, 10, 8, 8]
//   saves:
//     - dexterity: 5
//   skillsaves:
//     - stealth: 6
//   senses: darkvision 60 ft., passive Perception 9
//   languages: Common, Goblin
//   cr: "1/4"
//   traits:
//     - name: Nimble Escape
//       desc: The goblin can take the Disengage or Hide action as a bonus action.
//   actions:
//     - name: Scimitar
//       desc: "*Melee Weapon Attack:* +4 to hit. *Hit:* 5 (1d6 + 2) slashing damage."
//   ```
//
// Coverage: name/size/type/subtype/alignment, ac (+ ac_class), hp (+ hit_dice),
// speed, six abilities (stats), saves, skillsaves, damage_*, condition_immunities,
// senses, languages, cr, traits, actions, reactions, legendary_actions
// (+ legendary_description). Inline markdown in `desc` fields supports **bold**,
// *italic*, and `code`. Other Fantasy Statblocks features (spells nested
// formatting, custom layouts, dice-roller integration, JS callbacks, image
// fields) are not supported in v1.

import yaml from "js-yaml";
import type { CodeBlockHandler, HandlerContext } from "../types.js";
import { htmlEscape } from "../types.js";
import { registerBuiltinAssets } from "../assets.js";

interface NamedDesc { name?: string; desc?: string; }

interface Monster {
  name?: string;
  size?: string;
  type?: string;
  subtype?: string;
  alignment?: string;
  ac?: number | string;
  ac_class?: string;
  hp?: number | string;
  hit_dice?: string;
  speed?: string;
  stats?: number[];
  saves?: Array<Record<string, number>>;
  skillsaves?: Array<Record<string, number>>;
  damage_vulnerabilities?: string;
  damage_resistances?: string;
  damage_immunities?: string;
  condition_immunities?: string;
  senses?: string;
  languages?: string;
  cr?: string | number;
  traits?: NamedDesc[];
  actions?: NamedDesc[];
  reactions?: NamedDesc[];
  legendary_actions?: NamedDesc[];
  legendary_description?: string;
}

const ABILITY_NAMES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
const ABILITY_SHORT: Record<string, string> = {
  strength: "Str", dexterity: "Dex", constitution: "Con",
  intelligence: "Int", wisdom: "Wis", charisma: "Cha",
};

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

// Tiny inline-markdown formatter for desc fields. Pre-substituted handler
// HTML (e.g. `dice:` buttons) reaches us as sentinel tokens emitted by
// preprocessHandlers below. We html-escape and apply bold/italic/code
// first, then splice the original handler HTML back over the tokens.
// Wikilinks are still NOT processed (would require coupling to the
// broader render pipeline). Authors who need wikilinks should put them
// in a separate paragraph outside the statblock.
//
// Token format is a distinctive ASCII sentinel: htmlEscape leaves the
// underscores and digits alone, the bold/italic/code regexes can't
// match across it, and the chance a user writes this exact string in a
// desc is effectively zero.
const TOKEN_RE = /__VAULTSTATBLOCK_HANDLER_(\d+)__/g;
function makeToken(i: number): string { return `__VAULTSTATBLOCK_HANDLER_${i}__`; }

function formatInline(s: string, spliceback: string[]): string {
  let out = htmlEscape(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(TOKEN_RE, (_, idx) => spliceback[Number(idx)] ?? "");
  return out;
}

/**
 * Walk every string field in the monster, replace `` `prefix: …` ``
 * inline-handler invocations with sentinel tokens, and remember the
 * resulting HTML in `spliceback`. The synchronous formatInline pass below
 * then weaves the tokens back in after escaping. Two-step so the rest of
 * statblock rendering stays sync.
 *
 * Generic (Object.keys + typeof === "string") so future fields tokenize
 * automatically — a new top-level string field doesn't need plumbing.
 */
async function preprocessHandlers(
  m: Monster,
  ctx: HandlerContext,
): Promise<string[]> {
  const spliceback: string[] = [];
  const tokenize = async (s: string | undefined): Promise<string | undefined> => {
    if (!s || !s.includes("`")) return s;
    // Local regex (not module-level) so /g state doesn't leak across calls.
    const re = /`([a-z][\w-]*):\s*([^`]*)`/g;
    let out = "";
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(s)) !== null) {
      const replaced = await ctx.applyInlineHandlers(match[0]);
      if (replaced === match[0]) continue; // unhandled prefix; leave in place
      out += s.slice(last, match.index);
      out += makeToken(spliceback.length);
      spliceback.push(replaced);
      last = match.index + match[0].length;
    }
    if (last === 0) return s; // nothing matched
    out += s.slice(last);
    return out;
  };
  // Top-level scalar string fields (name, ac, hp, speed, cr, senses, …).
  const mAny = m as Record<string, unknown>;
  for (const k of Object.keys(mAny)) {
    if (typeof mAny[k] === "string") mAny[k] = await tokenize(mAny[k] as string);
  }
  // Per-entry name and desc inside trait/action lists.
  const list = async (xs: NamedDesc[] | undefined): Promise<void> => {
    if (!xs) return;
    for (const x of xs) {
      if (typeof x.name === "string") x.name = await tokenize(x.name);
      if (typeof x.desc === "string") x.desc = await tokenize(x.desc);
    }
  };
  await list(m.traits);
  await list(m.actions);
  await list(m.reactions);
  await list(m.legendary_actions);
  return spliceback;
}

function property(label: string, value: string | undefined, spliceback: string[]): string {
  if (value === undefined || value === "") return "";
  return `<p class="statblock-property"><strong>${label}</strong> ${formatInline(value, spliceback)}</p>`;
}

function header(m: Monster, spliceback: string[]): string {
  const name = m.name ?? "Unnamed";
  const sub = [m.size, m.type, m.subtype && `(${m.subtype})`, m.alignment]
    .filter(Boolean).join(" ");
  // Rendered as a div, not an h2: the page sanitizer restricts <h2> to
  // class="sr-only" only (GFM footnotes use it). The name is also not part
  // of the page's article outline — pages can have multiple statblocks.
  return (
    `<div class="statblock-header">` +
    `<div class="statblock-name">${formatInline(name, spliceback)}</div>` +
    (sub ? `<p class="statblock-subheading">${formatInline(sub, spliceback)}</p>` : "") +
    `</div>`
  );
}

function topProperties(m: Monster, spliceback: string[]): string {
  const parts: string[] = [];
  if (m.ac !== undefined) {
    parts.push(property("Armor Class", m.ac_class ? `${m.ac} (${m.ac_class})` : String(m.ac), spliceback));
  }
  if (m.hp !== undefined) {
    parts.push(property("Hit Points", m.hit_dice ? `${m.hp} (${m.hit_dice})` : String(m.hp), spliceback));
  }
  if (m.speed !== undefined) parts.push(property("Speed", String(m.speed), spliceback));
  return parts.join("");
}

function stats(m: Monster): string {
  if (!m.stats || m.stats.length !== 6) return "";
  const cells = m.stats.map((score, i) =>
    `<div class="statblock-stat">` +
    `<div class="statblock-stat-name">${ABILITY_NAMES[i]}</div>` +
    `<div class="statblock-stat-value">${score} (${modifier(score)})</div>` +
    `</div>`
  ).join("");
  return `<div class="statblock-stats">${cells}</div>`;
}

function bonusList(
  entries: Array<Record<string, number>> | undefined,
  labelFor: (key: string) => string,
): string {
  if (!entries?.length) return "";
  return entries.map(entry => {
    const pair = Object.entries(entry)[0];
    if (!pair) return "";
    const [key, val] = pair;
    if (val === undefined) return "";
    const sign = val >= 0 ? "+" : "";
    return `${labelFor(key)} ${sign}${val}`;
  }).filter(Boolean).join(", ");
}

function midProperties(m: Monster, spliceback: string[]): string {
  const saves = bonusList(m.saves, k => ABILITY_SHORT[k.toLowerCase()] ?? k);
  const skills = bonusList(m.skillsaves, k => k.charAt(0).toUpperCase() + k.slice(1));
  return [
    property("Saving Throws", saves || undefined, spliceback),
    property("Skills", skills || undefined, spliceback),
    property("Damage Vulnerabilities", m.damage_vulnerabilities, spliceback),
    property("Damage Resistances", m.damage_resistances, spliceback),
    property("Damage Immunities", m.damage_immunities, spliceback),
    property("Condition Immunities", m.condition_immunities, spliceback),
    property("Senses", m.senses, spliceback),
    property("Languages", m.languages, spliceback),
    property("Challenge", m.cr !== undefined ? String(m.cr) : undefined, spliceback),
  ].join("");
}

function trait(t: NamedDesc, spliceback: string[]): string {
  return `<p class="statblock-trait">` +
    `<strong><em>${formatInline(t.name ?? "", spliceback)}.</em></strong> ` +
    formatInline(t.desc ?? "", spliceback) +
    `</p>`;
}

function section(
  label: string,
  items: NamedDesc[] | undefined,
  spliceback: string[],
  intro?: string,
): string {
  if (!items?.length) return "";
  // `label` is hard-coded ("Actions"/"Reactions"/…); escape rather than
  // formatInline so a literal "*" in a future label doesn't get italicised.
  return `<div class="statblock-section">` +
    `<h3 class="statblock-section-heading">${htmlEscape(label)}</h3>` +
    (intro ? `<p class="statblock-section-intro">${formatInline(intro, spliceback)}</p>` : "") +
    items.map(t => trait(t, spliceback)).join("") +
    `</div>`;
}

export const statblockHandler: CodeBlockHandler = {
  codeBlock: "statblock",
  async render(content, ctx) {
    let m: Monster;
    try {
      m = (yaml.load(content) as Monster | null) ?? {};
    } catch (err) {
      return {
        html: `<div class="statblock statblock-error">` +
          `<strong>statblock parse error:</strong> ` +
          htmlEscape(err instanceof Error ? err.message : String(err)) +
          `</div>`,
      };
    }
    // Pre-substitute any `prefix: …` inline-handler invocations in desc
    // fields with sentinel tokens; spliceback holds the resulting HTML and
    // formatInline weaves it back in after escaping.
    const spliceback = await preprocessHandlers(m, ctx);
    const traitsHtml = m.traits?.length
      ? `<div class="statblock-section">${m.traits.map(t => trait(t, spliceback)).join("")}</div>`
      : "";
    const body = [
      header(m, spliceback),
      `<div class="statblock-rule"></div>`,
      `<div class="statblock-block">${topProperties(m, spliceback)}</div>`,
      `<div class="statblock-rule"></div>`,
      stats(m),
      `<div class="statblock-rule"></div>`,
      `<div class="statblock-block">${midProperties(m, spliceback)}</div>`,
      `<div class="statblock-rule statblock-rule-tapered"></div>`,
      traitsHtml,
      section("Actions", m.actions, spliceback),
      section("Reactions", m.reactions, spliceback),
      section("Legendary Actions", m.legendary_actions, spliceback, m.legendary_description),
    ].join("");
    return { html: `<div class="statblock">${body}</div>` };
  },
};

// Visual style follows the standard D&D 5e statblock (parchment, scarlet
// rules, small-caps headings) but uses `.statblock-*` class names borrowed
// from the Fantasy Statblocks plugin where they overlap, so a vault user
// could supply their own theme by overriding the same selectors. CSS
// variables match Fantasy Statblocks' palette tokens for portability.
const STATBLOCK_CSS = `
.statblock {
  --statblock-primary-color: #7a200d;
  --statblock-rule-color: #922610;
  --statblock-bg: #fdf1dc;
  --statblock-heading-font: "Libre Baskerville", "Lora", Georgia, serif;
  --statblock-content-font: "Noto Sans", Calibri, Helvetica, Arial, sans-serif;

  background: var(--statblock-bg);
  color: #000;
  border: 1px solid #ddd;
  box-shadow: 0 0 1.5em #ddd;
  padding: 0.6rem 0.75rem;
  margin: 1rem 0;
  font-family: var(--statblock-content-font);
  font-size: 14px;
  line-height: 1.4;
}
.statblock p { margin: 0.15rem 0; }
.statblock-name {
  font-family: var(--statblock-heading-font);
  font-size: 1.6rem;
  font-variant: small-caps;
  font-weight: 700;
  color: var(--statblock-primary-color);
  margin: 0;
  line-height: 1.1;
}
.statblock-subheading {
  font-style: italic;
  font-size: 0.9rem;
  margin: 0.1rem 0 0;
}
.statblock-rule {
  height: 5px;
  background: var(--statblock-rule-color);
  border: none;
  margin: 0.4rem 0;
  clip-path: polygon(0 0, 100% 0, 100% 30%, 0 100%);
}
.statblock-rule-tapered {
  clip-path: polygon(0 0, 100% 0, 95% 100%, 5% 100%);
}
.statblock-block { margin: 0.3rem 0; }
.statblock-property {
  color: var(--statblock-primary-color);
}
.statblock-property strong {
  font-weight: bold;
}
.statblock-stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.25rem;
  text-align: center;
  color: var(--statblock-primary-color);
  margin: 0.3rem 0;
}
.statblock-stat-name {
  font-weight: bold;
  font-variant: small-caps;
}
.statblock-section { margin-top: 0.6rem; }
.statblock-section-heading {
  font-family: var(--statblock-heading-font);
  font-variant: small-caps;
  font-weight: normal;
  font-size: 1.3rem;
  color: var(--statblock-primary-color);
  border-bottom: 1px solid var(--statblock-primary-color);
  margin: 0.5rem 0 0.3rem;
}
.statblock-trait {
  margin: 0.3rem 0;
  text-indent: -1rem;
  padding-left: 1rem;
}
.statblock-trait strong em {
  font-weight: bold;
  font-style: italic;
}
.statblock-section-intro {
  font-style: italic;
  margin: 0.3rem 0;
}
.statblock-error {
  background: #fde7e3;
  color: #7a200d;
  border-color: #7a200d;
}
`;

registerBuiltinAssets(statblockHandler, {
  styles: [{ source: "builtin/statblock.css", content: STATBLOCK_CSS }],
});
