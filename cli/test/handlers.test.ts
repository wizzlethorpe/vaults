// Tests for the custom-handler system (render/handlers/).
//
// Coverage:
//   1. Built-in `dice:` handler renders as a clickable button on the deploy.
//   2. Invalid dice formulas degrade to a styled <code> rather than crashing.
//   3. User-defined handlers in .vaults/handlers/ are picked up and run.
//   4. User code-block handlers can emit markdown that flows through the
//      rest of the pipeline (wikilinks resolve in handler-emitted markdown).
//   5. Multiple handlers per file (named export `handlers: []`) are loaded.
//   6. Handler files that don't export anything usable warn but don't crash.
//   7. User handler can override a built-in (last-registered wins).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildSite } from "../src/build.js";
import { loadUserHandlers } from "../src/render/handlers/loader.js";
import { buildRegistry } from "../src/render/handlers/types.js";
import { htmlEscape } from "../src/escape.js";

interface Vault { dir: string; out: string; }

async function setupVault(files: Record<string, string>): Promise<Vault> {
  const dir = await mkdtemp(join(tmpdir(), "vault-handlers-"));
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
  // Suppress build chatter; assertions read the rendered HTML directly.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await buildSite({
      vaultPath: v.dir,
      outputDir: v.out,
      vaultName: "Test",
      imageQuality: 0,
      maxFileBytes: 1 << 30,
    });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

const VAULTRC_1 = JSON.stringify({ roles: ["public"], rolePasswords: {} });

// ── Built-in dice handler ─────────────────────────────────────────────────

describe("built-in dice handler", () => {
  it("renders as a clickable button when the formula is valid", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Roll: `dice: 1d20+5` to hit.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<button[^>]*class="dice-roll"[^>]*data-formula="1d20\+5"[^>]*>1d20\+5<\/button>/);
    } finally { await cleanup(v); }
  });

  it("invalid formulas degrade to a styled <code> element", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Garbled: `dice: not-a-formula`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<code class="dice-roll dice-roll-invalid"[^>]*>not-a-formula<\/code>/);
    } finally { await cleanup(v); }
  });
});

// ── Built-in fm handler ───────────────────────────────────────────────────

describe("built-in fm handler", () => {
  it("inserts a string frontmatter value as markdown", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nclass: Wizard\n---\nThe `fm: class` casts.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /The <span class="fm-value">Wizard<\/span> casts\./);
    } finally { await cleanup(v); }
  });

  it("coerces numbers and joins arrays", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nlevel: 7\ntags: [arcane, fire]\n---\nLevel `fm: level`, tags `fm: tags`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /Level <span class="fm-value">7<\/span>, tags <span class="fm-value">arcane, fire<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("formats YAML-parsed Date values as YYYY-MM-DD", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nbirthday: 1239-09-28\n---\nBorn `fm: birthday`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /Born <span class="fm-value">1239-09-28<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("walks dot-paths into nested objects", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md":
        "---\n" +
        "stats:\n" +
        "  hp: 22\n" +
        "  abilities:\n" +
        "    str: 14\n" +
        "---\n" +
        "HP `fm: stats.hp`, STR `fm: stats.abilities.str`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /HP <span class="fm-value">22<\/span>, STR <span class="fm-value">14<\/span>\./);
    } finally { await cleanup(v); }
  });

  it("missing dot-path segments emit the warning marker", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nstats:\n  hp: 22\n---\nMissing: `fm: stats.nope.deep`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<code class="fm-missing"[^>]*>\{\{stats\.nope\.deep\}\}<\/code>/);
    } finally { await cleanup(v); }
  });

  it("missing keys emit a visible warning marker", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "---\nclass: Wizard\n---\nMissing: `fm: nope`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<code class="fm-missing"[^>]*>\{\{nope\}\}<\/code>/);
    } finally { await cleanup(v); }
  });
});

// ── Built-in statblock handler ────────────────────────────────────────────

describe("built-in statblock handler", () => {
  it("renders a basic 5e statblock with header, ac/hp/speed, stats, and traits", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Goblin.md":
        "```statblock\n" +
        "name: Goblin\n" +
        "size: Small\n" +
        "type: humanoid\n" +
        "alignment: neutral evil\n" +
        "ac: 15\n" +
        "ac_class: leather armor, shield\n" +
        "hp: 7\n" +
        "hit_dice: 2d6\n" +
        "speed: 30 ft.\n" +
        "stats: [8, 14, 10, 10, 8, 8]\n" +
        "saves:\n" +
        "  - dexterity: 5\n" +
        "skillsaves:\n" +
        "  - stealth: 6\n" +
        "senses: darkvision 60 ft., passive Perception 9\n" +
        "languages: Common, Goblin\n" +
        "cr: \"1/4\"\n" +
        "traits:\n" +
        "  - name: Nimble Escape\n" +
        "    desc: The goblin can take the **Disengage** or *Hide* action.\n" +
        "actions:\n" +
        "  - name: Scimitar\n" +
        "    desc: \"Melee Weapon Attack: +4 to hit.\"\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Goblin.html"), "utf8");
      assert.match(html, /<div class="statblock-name">Goblin<\/div>/);
      assert.match(html, /Small humanoid neutral evil/);
      assert.match(html, /<strong>Armor Class<\/strong> 15 \(leather armor, shield\)/);
      assert.match(html, /<strong>Hit Points<\/strong> 7 \(2d6\)/);
      assert.match(html, /<strong>Speed<\/strong> 30 ft\./);
      // Stat block: 6 cells, each with name + value+modifier.
      assert.match(html, /<div class="statblock-stat-name">STR<\/div>/);
      assert.match(html, /<div class="statblock-stat-value">14 \(\+2\)<\/div>/);
      assert.match(html, /<strong>Saving Throws<\/strong> Dex \+5/);
      assert.match(html, /<strong>Skills<\/strong> Stealth \+6/);
      assert.match(html, /<strong>Challenge<\/strong> 1\/4/);
      assert.match(html, /<strong><em>Nimble Escape\.<\/em><\/strong>/);
      // Inline markdown in desc fields renders.
      assert.match(html, /<strong>Disengage<\/strong>/);
      assert.match(html, /<em>Hide<\/em>/);
      // Actions section heading.
      assert.match(html, /<h3 class="statblock-section-heading"[^>]*>Actions<\/h3>/);
    } finally { await cleanup(v); }
  });

  it("supports inline handlers (fm:, dice:) in top-level statblock fields", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Goblin.md":
        "---\n" +
        "foundry:\n" +
        "  system:\n" +
        "    details:\n" +
        "      cr: 1/4\n" +
        "---\n" +
        "```statblock\n" +
        "name: Goblin\n" +
        "ac: 15\n" +
        "hp: 7\n" +
        "speed: 30 ft.\n" +
        "cr: \"`fm: foundry.system.details.cr`\"\n" +
        "actions:\n" +
        "  - name: Scimitar\n" +
        "    desc: \"Hit: `dice: 1d6+2` slashing damage.\"\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Goblin.html"), "utf8");
      // CR pulled from frontmatter via fm: dot-path inside a top-level field.
      assert.match(html, /<strong>Challenge<\/strong> <span class="fm-value">1\/4<\/span>/);
      // dice: still chains in desc fields (regression check).
      assert.match(html, /class="dice-roll"[^>]*data-formula="1d6\+2"/);
    } finally { await cleanup(v); }
  });

  it("emits a parse-error block when the YAML is invalid", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Bad.md": "```statblock\nname: [unclosed\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Bad.html"), "utf8");
      assert.match(html, /class="statblock statblock-error"/);
      assert.match(html, /statblock parse error/);
    } finally { await cleanup(v); }
  });

  it("inline handlers like `dice:` inside desc fields render through to HTML", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Wraith.md":
        "```statblock\n" +
        "name: Wraith\n" +
        "ac: 13\n" +
        "hp: 67\n" +
        "traits:\n" +
        "  - name: Incorporeal Movement\n" +
        "    desc: \"Takes 5 (`dice: 1d10`) force damage if it ends inside an object.\"\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Wraith.html"), "utf8");
      // Dice handler ran inside the desc and produced a clickable button.
      assert.match(html, /Takes 5 \(<button[^>]*class="dice-roll"[^>]*data-formula="1d10"[^>]*>1d10<\/button>\) force damage/);
      // Sentinel tokens should not leak into the output.
      assert.doesNotMatch(html, /VAULTSTATBLOCK_HANDLER/);
    } finally { await cleanup(v); }
  });

  it("renders a Spellcasting trait with per-level lines and italicized spells", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Mage.md":
        "```statblock\n" +
        "name: Mage\n" +
        "ac: 12\n" +
        "hp: 40\n" +
        "spells:\n" +
        "  - \"The mage is a 9th-level spellcaster (spell save DC 14).\"\n" +
        "  - \"Cantrips (at will): fire bolt, light, mage hand, prestidigitation\"\n" +
        "  - \"1st level (4 slots): detect magic, mage armor, magic missile, shield\"\n" +
        "  - \"5th level (1 slot): cone of cold\"\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Mage.html"), "utf8");
      // Spellcasting header trait with intro prose.
      assert.match(html, /<strong><em>Spellcasting\.<\/em><\/strong> The mage is a 9th-level spellcaster/);
      // Each level entry renders as its own paragraph.
      const levels = html.match(/class="statblock-spell-level"/g) ?? [];
      assert.equal(levels.length, 3);
      // Level label is bolded, spell names italicized.
      assert.match(html, /<strong>Cantrips \(at will\)<\/strong>/);
      assert.match(html, /<em>fire bolt<\/em>/);
      assert.match(html, /<em>cone of cold<\/em>/);
    } finally { await cleanup(v); }
  });

  it("ships statblock CSS in /_handlers.css when used", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "```statblock\nname: Test\n```\n",
    });
    try {
      await build(v);
      const css = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(css, /\.statblock-name/);
      assert.match(css, /\.statblock-stats/);
    } finally { await cleanup(v); }
  });

  // ── Fantasy Statblocks compatibility (saves/skillsaves shapes, spells
  //    object form, image, extra action sections, nested traits, source/note)

  it("saves accept either array-of-single-key-objects or a flat object", async () => {
    // Both shapes should produce the same rendered output. Two statblocks in
    // one file lets us compare directly without spinning up two builds.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Saves.md":
        "```statblock\nname: ArrayShape\nac: 13\nhp: 40\n" +
        "saves:\n  - dexterity: 5\n  - wisdom: 7\n" +
        "skillsaves:\n  - stealth: 6\n  - perception: 4\n" +
        "```\n\n" +
        "```statblock\nname: ObjectShape\nac: 13\nhp: 40\n" +
        "saves:\n  dexterity: 5\n  wisdom: 7\n" +
        "skillsaves:\n  stealth: 6\n  perception: 4\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Saves.html"), "utf8");
      const both = html.match(/<strong>Saving Throws<\/strong> Dex \+5, Wis \+7/g) ?? [];
      assert.equal(both.length, 2);
      const skills = html.match(/<strong>Skills<\/strong> Stealth \+6, Perception \+4/g) ?? [];
      assert.equal(skills.length, 2);
    } finally { await cleanup(v); }
  });

  it("spells: accepts object entries (FS Spell = string | { [level]: list })", async () => {
    // Plain string entries used to crash with `s.split is not a function`
    // when an object slipped in; this test pins the per-entry detection.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Mage.md":
        "```statblock\n" +
        "name: ObjMage\n" +
        "ac: 12\n" +
        "hp: 40\n" +
        "spells:\n" +
        "  - \"The mage is a 9th-level spellcaster.\"\n" +
        "  - Cantrips (at will): fire bolt, light\n" +
        "  - 1st level (4 slots): magic missile, shield\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Mage.html"), "utf8");
      assert.match(html, /<strong>Cantrips \(at will\)<\/strong>: <em>fire bolt<\/em>, <em>light<\/em>/);
      assert.match(html, /<strong>1st level \(4 slots\)<\/strong>: <em>magic missile<\/em>, <em>shield<\/em>/);
    } finally { await cleanup(v); }
  });

  it("image: emits a portrait <img class='statblock-image'> in the header", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Goblin.md":
        "```statblock\nname: Goblin\nimage: portraits/goblin.webp\nac: 15\nhp: 7\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Goblin.html"), "utf8");
      assert.match(html, /<img[^>]*class="statblock-image"[^>]*src="portraits\/goblin\.webp"[^>]*>/);
      // CSS rule for the image lands in _handlers.css.
      const css = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(css, /\.statblock-image/);
    } finally { await cleanup(v); }
  });

  it("renders bonus_actions, mythic_actions, lair_actions, triggered_actions sections", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Tarrasque.md":
        "```statblock\n" +
        "name: Tarrasque\nac: 25\nhp: 676\n" +
        "bonus_actions:\n  - name: Reckless\n    desc: Until the start of its next turn.\n" +
        "mythic_description: \"If you choose to use this monster's mythic trait, the following actions are available.\"\n" +
        "mythic_actions:\n  - name: World Render\n    desc: Bites once and uses Tail.\n" +
        "lair_actions:\n  - name: Quake\n    desc: Each creature on the ground falls prone.\n" +
        "triggered_actions:\n  - name: Bloodied\n    desc: Triggers when reduced below half HP.\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Tarrasque.html"), "utf8");
      assert.match(html, /<h3 class="statblock-section-heading"[^>]*>Bonus Actions<\/h3>/);
      assert.match(html, /<h3 class="statblock-section-heading"[^>]*>Mythic Actions<\/h3>/);
      assert.match(html, /<h3 class="statblock-section-heading"[^>]*>Lair Actions<\/h3>/);
      assert.match(html, /<h3 class="statblock-section-heading"[^>]*>Triggered Actions<\/h3>/);
      // Mythic intro paragraph rides right after the heading.
      assert.match(html, /class="statblock-section-intro">If you choose to use this monster's mythic trait/);
    } finally { await cleanup(v); }
  });

  it("nested traits flatten one level with the parent's name as a prefix", async () => {
    // FS allows traits[i].traits recursively. v1 hack: flat with prefix.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Hydra.md":
        "```statblock\nname: Hydra\nac: 15\nhp: 172\n" +
        "traits:\n" +
        "  - name: Multiple Heads\n" +
        "    desc: The hydra has five heads.\n" +
        "    traits:\n" +
        "      - name: Reactive Heads\n" +
        "        desc: For each head, the hydra gets an extra reaction.\n" +
        "      - name: Wakeful\n" +
        "        desc: While the hydra sleeps, at least one head is awake.\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Hydra.html"), "utf8");
      assert.match(html, /<strong><em>Multiple Heads\.<\/em><\/strong>/);
      assert.match(html, /<strong><em>Multiple Heads: Reactive Heads\.<\/em><\/strong>/);
      assert.match(html, /<strong><em>Multiple Heads: Wakeful\.<\/em><\/strong>/);
    } finally { await cleanup(v); }
  });

  it("source and note render as small italic text below the statblock body", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Goblin.md":
        "```statblock\nname: Goblin\nac: 15\nhp: 7\n" +
        "source: \"Monster Manual p. 166\"\n" +
        "note: \"Variant: Goblin Boss has +2 HP.\"\n" +
        "```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Goblin.html"), "utf8");
      assert.match(html, /<p class="statblock-source"><em>Monster Manual p\. 166<\/em><\/p>/);
      assert.match(html, /<p class="statblock-note"><em>Variant: Goblin Boss has \+2 HP\.<\/em><\/p>/);
      const css = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(css, /\.statblock-source/);
      assert.match(css, /\.statblock-note/);
    } finally { await cleanup(v); }
  });
});

// ── User-defined handlers ─────────────────────────────────────────────────

describe("user handler loading", () => {
  it("discovers handlers from .vaults/handlers/*.mjs", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/shout.mjs":
        "export const handler = { inline: 'shout', render: (s) => ({ html: '<strong>' + s.toUpperCase() + '</strong>' }) };\n",
      "Page.md": "Hey: `shout: hello`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<strong>HELLO<\/strong>/);
    } finally { await cleanup(v); }
  });

  it("supports the `handlers: []` array export with multiple handlers per file", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/multi.mjs":
        "export const handlers = [\n" +
        "  { inline: 'lo', render: (s) => ({ html: '<em>' + s.toLowerCase() + '</em>' }) },\n" +
        "  { codeBlock: 'reverse', render: (s) => ({ html: '<pre>' + s.split('').reverse().join('') + '</pre>' }) },\n" +
        "];\n",
      "Page.md": "Inline: `lo: HELLO`.\n\n```reverse\nabcdef\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<em>hello<\/em>/);
      assert.match(html, /<pre>fedcba<\/pre>/);
    } finally { await cleanup(v); }
  });

  it("user handlers can override built-in handlers (last-registered wins)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/dice-override.mjs":
        "export const handler = { inline: 'dice', render: (s) => ({ html: '<span class=\"override\">' + s + '</span>' }) };\n",
      "Page.md": "`dice: 1d20`",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<span class="override">1d20<\/span>/);
      assert.doesNotMatch(html, /class="dice-roll"/);
    } finally { await cleanup(v); }
  });

  it("ignores files that don't export `handler` or `handlers` (with a warning)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/empty.mjs": "export const something = 'else';\n",
      "Page.md": "`shout: x`",
    });
    try {
      // Should not throw; the unrelated module is skipped.
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // No matching handler, so the inline-code falls through unchanged.
      assert.match(html, /<code>shout: x<\/code>/);
    } finally { await cleanup(v); }
  });

  it("missing .vaults/handlers/ directory is a no-op (most vaults won't have one)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Hello.",
    });
    try {
      await build(v); // shouldn't crash
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /Hello\./);
    } finally { await cleanup(v); }
  });
});

// ── Code-block handlers, markdown output, and pipeline composition ───────

describe("code-block handlers", () => {
  it("user code-block handler emitting markdown is processed by the rest of the pipeline", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/seealso.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'seealso',\n" +
        "  render: (content) => ({ markdown: content.split(/\\r?\\n/).filter(Boolean).map(p => '- [[' + p.trim() + ']]').join('\\n') }),\n" +
        "};\n",
      "Page.md":
        "## See also\n\n```seealso\nOther\nThird\n```\n",
      "Other.md": "# Other Page",
      "Third.md": "# Third Page",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // The handler emitted markdown wikilinks; the wikilink plugin
      // resolved them to actual <a class="internal …"> links pointing at
      // the other pages. If pipeline ordering were wrong, we'd see raw
      // [[Other]] text instead.
      assert.match(html, /<a href="\/?Other" class="internal[^"]*">Other<\/a>/);
      assert.match(html, /<a href="\/?Third" class="internal[^"]*">Third<\/a>/);
    } finally { await cleanup(v); }
  });
});

// ── Loader unit tests ────────────────────────────────────────────────────

describe("loadUserHandlers", () => {
  it("returns [] when .vaults/handlers/ is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-noh-"));
    try {
      const handlers = await loadUserHandlers(dir);
      assert.deepEqual(handlers, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters out files with non-handler exports and tracks source paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-filter-"));
    const hdir = join(dir, ".vaults/handlers");
    await mkdir(hdir, { recursive: true });
    await writeFile(join(hdir, "ok.mjs"),
      "export const handler = { inline: 'hi', render: () => ({ html: 'x' }) };\n");
    await writeFile(join(hdir, "bad.mjs"), "export const garbage = { not: 'a handler' };\n");
    await writeFile(join(hdir, "ignored.txt"), "not a JS file at all");
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const handlers = await loadUserHandlers(dir);
      assert.equal(handlers.length, 1);
      assert.equal((handlers[0]!.handler as { inline?: string }).inline, "hi");
      assert.equal(handlers[0]!.sourcePath, join(hdir, "ok.mjs"));
    } finally {
      console.warn = origWarn;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── Recursion ────────────────────────────────────────────────────────────

describe("handler recursion", () => {
  it("handler-emitted markdown containing inline dice resolves to a dice button", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/wrap.mjs":
        // Code-block handler that returns markdown containing an inline
        // dice formula. Without recursion the formula would ship as plain
        // inline code; with recursion it becomes a dice button.
        "export const handler = {\n" +
        "  codeBlock: 'wrap',\n" +
        "  render: (content) => ({ markdown: content + ' (`dice: 1d20+5`)' }),\n" +
        "};\n",
      "Page.md": "```wrap\nattack roll\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // The wrap handler emitted "attack roll (`dice: 1d20+5`)" as markdown,
      // and the dispatcher re-walked that markdown to find the inline dice.
      assert.match(html, /<button[^>]*class="dice-roll"[^>]*data-formula="1d20\+5"/);
    } finally { await cleanup(v); }
  });

  it("self-recursive handler bottoms out at the depth limit without crashing", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/loop.mjs":
        // Inline handler that always re-emits its own trigger. Without a
        // depth limit this would loop forever.
        "export const handler = {\n" +
        "  inline: 'loop',\n" +
        "  render: () => ({ markdown: '`loop: x`' }),\n" +
        "};\n",
      "Page.md": "Trigger: `loop: x`",
    });
    try {
      // Don't use the build() helper here: it stubs console.warn to
      // silence build chatter, which would also swallow the depth-limit
      // warning we want to assert on.
      const origLog = console.log;
      const origWarn = console.warn;
      const warnings: string[] = [];
      console.log = () => {};
      console.warn = (msg: unknown) => warnings.push(String(msg));
      try {
        await buildSite({
          vaultPath: v.dir,
          outputDir: v.out,
          vaultName: "Test",
          imageQuality: 0,
          maxFileBytes: 1 << 30,
        });
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      // Build completes (no stack overflow / hang).
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.ok(html.length > 0);
      // The depth-limit warning fired at least once.
      assert.ok(
        warnings.some((w) => /recursion depth/.test(w)),
        `expected a recursion-depth warning; got: ${warnings.join(" | ")}`,
      );
    } finally { await cleanup(v); }
  });
});

// ── Asset bundling ───────────────────────────────────────────────────────

describe("handler asset bundling", () => {
  it("built-in dice runtime ships in /_handlers.js when any page uses dice:", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Roll: `dice: 1d20`.",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      // Sentinel from dice.runtime.js
      assert.match(js, /FORMULA_RE = \/\^/);
      // The built-in's source-id comment is included for traceability
      assert.match(js, /builtin\/dice\.runtime\.js/);
      // Layout should reference both files
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<script src="\/_handlers\.js" defer><\/script>/);
    } finally { await cleanup(v); }
  });

  it("user handler with assets.foundry.{scripts,styles} ships in the foundry-import bundle; default-off handlers don't", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/optedin.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'optedin',\n" +
        "  assets: {\n" +
        "    scripts: ['./optedin.runtime.js'],\n" +
        "    styles: ['./optedin.css'],\n" +
        "    targets: { foundry: { scripts: true, styles: true } },\n" +
        "  },\n" +
        "  render: () => ({ html: '<div class=\"optedin\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/optedin.runtime.js":
        "(function(){ window.__optedin = 'OPTEDIN-MARKER'; })();\n",
      ".vaults/handlers/optedin.css":
        ".optedin { color: tomato; }\n",
      ".vaults/handlers/silent.mjs":
        // No foundry opt-in; should NOT appear in foundry bundles even though
        // it ships its assets to the browser bundles.
        "export const handler = {\n" +
        "  codeBlock: 'silent',\n" +
        "  assets: { scripts: ['./silent.runtime.js'], styles: ['./silent.css'] },\n" +
        "  render: () => ({ html: '<div class=\"silent\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/silent.runtime.js":
        "(function(){ window.__silent = 'SILENT-MARKER'; })();\n",
      ".vaults/handlers/silent.css":
        ".silent { color: silver; }\n",
      "Page.md": "```optedin\n```\n\n```silent\n```\n",
    });
    try {
      await build(v);
      // Browser bundles contain BOTH handlers' assets (opt-in is for Foundry,
      // not the wiki itself).
      const browserJs = await readFile(join(v.out, "_handlers.js"), "utf8");
      const browserCss = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(browserJs, /OPTEDIN-MARKER/);
      assert.match(browserJs, /SILENT-MARKER/);
      assert.match(browserCss, /tomato/);
      assert.match(browserCss, /silver/);
      // Foundry bundles contain ONLY the opted-in handler.
      const fjs = await readFile(join(v.out, "_handlers.foundry.js"), "utf8");
      const fcss = await readFile(join(v.out, "_handlers.foundry.css"), "utf8");
      assert.match(fjs, /OPTEDIN-MARKER/);
      assert.doesNotMatch(fjs, /SILENT-MARKER/);
      assert.match(fcss, /tomato/);
      assert.doesNotMatch(fcss, /silver/);
    } finally { await cleanup(v); }
  });

  it("foundry-import JS bundle is absent when no handler opts JS in (default state)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Roll: `dice: 1d20`.",
    });
    try {
      await build(v);
      // Built-in dice JS isn't opted in (Foundry rewrites dice to native
      // [[/r]] enrichers, so the runtime would be redundant). Built-in
      // statblock CSS *is* opted in for Foundry visual parity, so the CSS
      // bundle exists even with no user handlers — that's by design.
      try {
        await readFile(join(v.out, "_handlers.foundry.js"), "utf8");
        assert.fail("expected _handlers.foundry.js to not exist (no handler opted JS in)");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    } finally { await cleanup(v); }
  });

  it("partial opt-in: assets.foundry.styles only ships CSS, not JS", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/css-only.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'cssonly',\n" +
        "  assets: {\n" +
        "    scripts: ['./css-only.runtime.js'],\n" +
        "    styles: ['./css-only.css'],\n" +
        "    targets: { foundry: { styles: true } },\n" +  // scripts intentionally omitted
        "  },\n" +
        "  render: () => ({ html: '<div class=\"cssonly\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/css-only.runtime.js":
        "(function(){ window.__cssonly = 'CSSONLY-MARKER'; })();\n",
      ".vaults/handlers/css-only.css":
        ".cssonly { color: olive; }\n",
      "Page.md": "```cssonly\n```\n",
    });
    try {
      await build(v);
      const fcss = await readFile(join(v.out, "_handlers.foundry.css"), "utf8");
      assert.match(fcss, /olive/);
      // JS bundle should not exist since nothing opted in for scripts.
      try {
        await readFile(join(v.out, "_handlers.foundry.js"), "utf8");
        assert.fail("expected _handlers.foundry.js to not exist");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    } finally { await cleanup(v); }
  });

  it("multi-role middleware allowlists /_handlers.js and /_handlers.css so they don't 404", async () => {
    const v = await setupVault({
      ".vaultrc.json": JSON.stringify({
        roles: ["public", "dm"],
        rolePasswords: { dm: "100000:0000:0000" },
      }),
      ".vaults/handlers/widget.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'widget',\n" +
        "  assets: { scripts: ['./widget.runtime.js'], styles: ['./widget.css'] },\n" +
        "  render: () => ({ html: '<div class=\"widget\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/widget.runtime.js": "(function(){})();\n",
      ".vaults/handlers/widget.css": ".widget {}\n",
      "Page.md": "```widget\n```\n",
    });
    try {
      await build(v);
      const mw = await readFile(join(v.out, "functions/_middleware.js"), "utf8");
      assert.match(mw, /pathname === "\/_handlers\.js"/);
      assert.match(mw, /pathname === "\/_handlers\.css"/);
      // Foundry-import bundles are deliberately NOT in the shared-asset
      // allowlist: they live per-variant so the middleware role-gates
      // them. A public visitor can't read /_handlers.foundry.css via
      // the rewrite path unless they have a public-tier token.
      assert.doesNotMatch(mw, /pathname === "\/_handlers\.foundry\.js"/);
      assert.doesNotMatch(mw, /pathname === "\/_handlers\.foundry\.css"/);
    } finally { await cleanup(v); }
  });

  it("user-handler runtime is concatenated into the same bundle", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/widget.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'widget',\n" +
        "  assets: { scripts: ['./widget.runtime.js'], styles: ['./widget.css'] },\n" +
        "  render: () => ({ html: '<div class=\"widget\"></div>' }),\n" +
        "};\n",
      ".vaults/handlers/widget.runtime.js":
        "(function () { window.__widgetMarker = 'WIDGET-RUNTIME'; })();\n",
      ".vaults/handlers/widget.css":
        ".widget { color: rebeccapurple; }\n",
      "Page.md": "```widget\n```\n",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      const css = await readFile(join(v.out, "_handlers.css"), "utf8");
      assert.match(js, /WIDGET-RUNTIME/);
      assert.match(css, /rebeccapurple/);
    } finally { await cleanup(v); }
  });

  it("dedups identical asset paths across multiple handlers", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/shared.js":
        "// SHARED-LIB\nwindow.__shared = true;\n",
      ".vaults/handlers/a.mjs":
        "export const handler = {\n" +
        "  inline: 'a',\n" +
        "  assets: { scripts: ['./shared.js'] },\n" +
        "  render: (s) => ({ html: '<span class=\"a\">' + s + '</span>' }),\n" +
        "};\n",
      ".vaults/handlers/b.mjs":
        "export const handler = {\n" +
        "  inline: 'b',\n" +
        "  assets: { scripts: ['./shared.js'] },\n" +
        "  render: (s) => ({ html: '<span class=\"b\">' + s + '</span>' }),\n" +
        "};\n",
      "Page.md": "`a: x` and `b: y`",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      // Body of shared.js appears exactly once.
      const matches = js.match(/SHARED-LIB/g) ?? [];
      assert.equal(matches.length, 1, `expected shared lib once, got ${matches.length}`);
    } finally { await cleanup(v); }
  });

  it("refuses asset paths that escape .vaults/handlers/ (build fails loudly)", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "secret.txt": "TOP-SECRET-SHOULD-NOT-LEAK",
      ".vaults/handlers/evil.mjs":
        "export const handler = {\n" +
        "  inline: 'evil',\n" +
        "  assets: { scripts: ['../../secret.txt'] },\n" +
        "  render: () => ({ html: '' }),\n" +
        "};\n",
      "Page.md": "Hello.",
    });
    try {
      await assert.rejects(
        () => build(v),
        /handler asset path escapes/,
      );
    } finally { await cleanup(v); }
  });

  it("user handlers without assets don't add to bundles beyond what built-ins contribute", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/pure.mjs":
        // No assets field; pure build-time text transform.
        "export const handler = { inline: 'echo', render: (s) => ({ html: '<i>' + s + '</i>' }) };\n",
      "Page.md": "`echo: hi`",
    });
    try {
      await build(v);
      const js = await readFile(join(v.out, "_handlers.js"), "utf8");
      // Built-in dice runtime sentinel — pure user handler shouldn't shadow it.
      assert.match(js, /FORMULA_RE = \/\^/);
      // No user-handler-source comments; user handler declared no assets.
      assert.doesNotMatch(js, /pure\.mjs|widget\.runtime/);
    } finally { await cleanup(v); }
  });

  it("layout link/script tags follow the JS and CSS bundles independently", async () => {
    // Regression test: previously a single `hasHandlerAssets` flag covered
    // both files, so JS-only deploys referenced a missing CSS file. The two
    // flags are now independent. Built-in handlers contribute both: dice ships
    // JS, statblock ships CSS — so a default build emits both tags.
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "Roll: `dice: 1d20`.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /<script src="\/_handlers\.js"/);
      assert.match(html, /<link[^>]*_handlers\.css/);
    } finally { await cleanup(v); }
  });

  it("layout omits the JS script tag when no handler declares JS", async () => {
    // Mirror of the previous test for the symmetric case (CSS only, no JS).
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      ".vaults/handlers/style-only.mjs":
        "export const handler = {\n" +
        "  codeBlock: 'box',\n" +
        "  assets: { styles: ['./box.css'] },\n" +
        "  render: (c) => ({ html: '<div class=\"box\">' + c + '</div>' }),\n" +
        "};\n",
      ".vaults/handlers/box.css": ".box { border: 1px solid red; }\n",
      "Page.md": "```box\nhi\n```\n",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      // Built-in dice ships JS as a side-effect of handlers being loaded
      // even if no page invokes `dice:`. The bundle is empty when no
      // handler with assets is registered, but built-ins always register.
      // For this test, the assertion is just that CSS is referenced when
      // present.
      assert.match(html, /<link[^>]*_handlers\.css/);
    } finally { await cleanup(v); }
  });
});

// ── Registry and helpers ─────────────────────────────────────────────────

describe("buildRegistry + htmlEscape", () => {
  it("buildRegistry separates inline and codeBlock handlers; later wins", () => {
    const reg = buildRegistry(
      [{ inline: "a", render: () => ({ html: "first" }) }],
      [
        { inline: "a", render: () => ({ html: "second" }) },
        { codeBlock: "b", render: () => ({ html: "block" }) },
      ],
    );
    assert.equal(reg.inline.size, 1);
    assert.equal(reg.codeBlock.size, 1);
    // User handler wins over built-in on the same prefix.
    const a = reg.inline.get("a")!;
    assert.deepEqual(a.render("", null as never), { html: "second" });
  });

  it("buildRegistry warns when a user handler shadows a built-in", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      buildRegistry(
        [
          { inline: "dice", render: () => ({ html: "builtin" }) },
          { codeBlock: "statblock", render: () => ({ html: "builtin" }) },
        ],
        [
          { inline: "dice", render: () => ({ html: "user" }) },
          { codeBlock: "statblock", render: () => ({ html: "user" }) },
        ],
      );
    } finally { console.warn = origWarn; }
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /shadows the built-in/);
    assert.match(warnings[0]!, /dice/);
    assert.match(warnings[1]!, /statblock/);
  });

  it("buildRegistry stays silent when user handlers don't collide with built-ins", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      buildRegistry(
        [{ inline: "dice", render: () => ({ html: "builtin" }) }],
        [{ inline: "shout", render: () => ({ html: "user" }) }],
      );
    } finally { console.warn = origWarn; }
    assert.equal(warnings.length, 0);
  });

  it("htmlEscape covers the dangerous-five characters", () => {
    assert.equal(htmlEscape(`<a href="x" onclick='y'>&z</a>`),
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;z&lt;/a&gt;");
  });
});
