import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { battlemapHandler } from "../src/render/handlers/builtin/battlemap.js";

function render(content: string): string {
  return (battlemapHandler.render(content, {} as never) as { html: string }).html;
}

const SAMPLE = `
grid: 140
default_level: 1
name: Wizard Prison
levels:
  - name: Dungeon
    layers:
      - "attachments/foundry/wizard-prison/Rock.webp"
      - "attachments/foundry/wizard-prison/Dungeon.webp"
  - name: Rock
    layers:
      - "attachments/foundry/wizard-prison/Rock.webp"
`;

describe("battlemap handler", () => {
  it("renders a level button per level and a pane per level", () => {
    const html = render(SAMPLE);
    assert.equal((html.match(/class="vaults-bm-level"/g) ?? []).length, 2);
    assert.equal((html.match(/class="vaults-bm-pane/g) ?? []).length, 2);
    assert.ok(html.includes(">Dungeon</button>"));
    assert.ok(html.includes(">Rock</button>"));
  });

  it("emits grid + download controls when a grid is set", () => {
    const html = render(SAMPLE);
    assert.ok(html.includes("vaults-bm-grid"), "grid toggle present");
    assert.ok(html.includes("vaults-bm-download"), "download button present");
    assert.ok(html.includes('data-grid="140"'));
  });

  it("omits the grid toggle when no grid is given", () => {
    const html = render(`levels:\n  - name: A\n    layers:\n      - "a.webp"`);
    assert.ok(!html.includes('class="vaults-bm-grid"'), "no grid toggle without grid");
    assert.ok(html.includes("vaults-bm-download"), "download still present");
  });

  it("marks default_level (0-based) as the active pane", () => {
    const html = render(SAMPLE);
    // default_level: 1 -> the second level (Rock) is active
    assert.match(html, /class="vaults-bm-pane is-active" data-level="1"/);
    assert.match(html, /data-level="1" aria-selected="true"/);
  });

  it("resolves layer paths to absolute, percent-encoded served URLs", () => {
    const html = render(`levels:\n  - name: A\n    layers:\n      - "attachments/foundry/x/Map Name.webp"`);
    assert.ok(html.includes('src="/attachments/foundry/x/Map%20Name.webp"'));
  });

  it("degrades to an error box on bad input", () => {
    assert.ok(render("levels: []").includes("vaults-bm-error"));
    assert.ok(render(": : not yaml : :").includes("vaults-bm-error"));
  });
});
