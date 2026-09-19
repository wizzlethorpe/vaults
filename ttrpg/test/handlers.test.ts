// The add-on's handlers, rendered through a real build: dice, statblock and fvtt-link, and the assets they ship.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VAULTRC_1, build, cleanup, setupVault } from "../../cli/test/vault-helpers.js";

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
      // Sentinel tokens must not leak into the output.
      assert.doesNotMatch(html, /VAULTSTATBLOCK_HANDLER/);
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

describe("fvtt-link handler", () => {
  it("renders a page link on the web, marked for the Foundry rewrite", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Macros/Toggle Feast.md": "---\ntitle: Toggle Feast\n---\nBody.\n",
      "Page.md": "Run `fvtt-link: Toggle Feast` now.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /class="internal internal-link fvtt-doc-link" href="\/Macros\/Toggle%20Feast"/);
      assert.match(html, />Toggle Feast<\/a>/);
    } finally { await cleanup(v); }
  });

  it("takes a |label and marks an unresolved target broken", async () => {
    const v = await setupVault({
      ".vaultrc.json": VAULTRC_1,
      "Page.md": "See `fvtt-link: Nowhere|the void` maybe.",
    });
    try {
      await build(v);
      const html = await readFile(join(v.out, "Page.html"), "utf8");
      assert.match(html, /is-unresolved[^>]*>the void<\/a>/);
    } finally { await cleanup(v); }
  });
});

describe("the add-on's handler assets", () => {
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
      assert.match(html, /<script src="\/_handlers\.js\?v=[a-f0-9]+" defer><\/script>/);
      // The CSS tag follows its own bundle: statblock CSS ships by default,
      // so both tags appear, each keyed to its own flag.
      assert.match(html, /<link[^>]*_handlers\.css/);
    } finally { await cleanup(v); }
  });
});
