// What each role's grafts.json shows a player: gated callouts, embeds and bases rows sit behind Foundry secrets.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { VARIANT, VAULTRC_3, build, cleanup, readJson, setupVault } from "../../cli/test/vault-helpers.js";

describe("role gating: Foundry bodies", () => {
  // A player-visible page carries one render. What players may not see sits in
  // Foundry's secret sections, which Foundry strips for anyone below owner.
  const SETTINGS = "---\nimage_quality: 0\nfoundry:\n  player_role: public\n  core_version: '14.359'\n---\n";

  /** A page's journal body, read out of the grafts file it is inlined into. */
  const bodyOf = async (out: string, role: string, name: string): Promise<string> => {
    const file = await readJson(join(out, VARIANT(role, "_foundry/grafts.json"))) as
      { entries: Array<{ patch: { pages?: Array<{ name: string; text: { content: string } }> } }> };
    for (const entry of file.entries) {
      const page = entry.patch.pages?.find((p) => p.name === name);
      if (page) return page.text.content;
    }
    throw new Error(`no journal page named ${name} in the ${role} entry list`);
  };
  const withoutSecrets = (html: string) => html.replace(/<section class="secret"[\s\S]*?<\/section>/g, "");

  it("puts a DM callout behind a secret, once, and leaves a DM-only page alone", async () => {
    const v = await setupVault({
      "settings.md": SETTINGS,
      ".vaultrc.json": VAULTRC_3,
      "Town.md": "---\nrole: public\n---\nThe town.\n\n> [!dm]\n> The mayor is a mimic.\n",
      "Secrets.md": "---\nrole: dm\n---\nAll of it.\n\n> [!dm]\n> Deeper still.\n",
    });
    try {
      await build(v);
      const dm = await bodyOf(v.out, "dm", "Town");
      assert.match(dm, /mimic/, "the GM keeps the callout");
      assert.doesNotMatch(withoutSecrets(dm), /mimic/, "outside a secret, players would read it");
      assert.equal(dm.match(/The town\./g)?.length, 1, "one render, not a GM copy beside a player copy");

      const secrets = await bodyOf(v.out, "dm", "Secrets");
      assert.doesNotMatch(secrets, /class="secret"/, "a page players never open needs no secrets");

      const pub = await bodyOf(v.out, "public", "Town");
      assert.doesNotMatch(pub, /mimic|class="secret"/);
    } finally { await cleanup(v); }
  });

  it("puts an embedded DM page behind a secret", async () => {
    // The embed carries the embedded page's role; without it the DM page's
    // text would sit in the open on a page players read.
    const v = await setupVault({
      "settings.md": SETTINGS,
      ".vaultrc.json": VAULTRC_3,
      "Town.md": "---\nrole: public\n---\nThe town.\n\n![[Cult]]\n",
      "Cult.md": "---\nrole: dm\n---\nThe cult meets at midnight.\n",
    });
    try {
      await build(v);
      const town = await bodyOf(v.out, "dm", "Town");
      assert.match(town, /meets at midnight/, "the GM sees the embed");
      assert.doesNotMatch(withoutSecrets(town), /meets at midnight/);
    } finally { await cleanup(v); }
  });

  it("keeps a DM page's row, card and list item out of the open bases views", async () => {
    // Each view carries the item's role through the sanitiser as a marker; a
    // view whose marker was stripped would put the DM page in the open.
    const base = "```base\nviews:\n  - type: table\n    name: Table\n  - type: cards\n    name: Cards\n  - type: list\n    name: List\n```\n";
    const v = await setupVault({
      "settings.md": SETTINGS,
      ".vaultrc.json": VAULTRC_3,
      "Roster.md": `---\nrole: public\n---\n${base}`,
      "Bandit.md": "---\nrole: public\n---\nA bandit.\n",
      "Joywraith.md": "---\nrole: dm\n---\nA wraith.\n",
    });
    try {
      await build(v);
      const roster = await bodyOf(v.out, "dm", "Roster");
      assert.equal(roster.match(/<section class="secret"/g)?.length, 3, "one GM copy per view");
      const open = withoutSecrets(roster);
      assert.match(open, /Bandit/);
      assert.doesNotMatch(open, /Joywraith/);
      assert.doesNotMatch(roster, /data-vaults-role|bases-toolbar/, "no marker, and no filter box counting DM rows");
    } finally { await cleanup(v); }
  });
});
