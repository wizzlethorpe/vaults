// Built-in `battlemap` code-block handler.
//
// Renders a layered, multi-level battle map with controls to switch level,
// toggle a grid overlay, and download the current level as a PNG. Syntax:
//
//   ```battlemap
//   grid: 140                 # px per grid cell at the image's native size (optional)
//   default_level: 1          # 0-based index of the level shown first (optional)
//   name: Wizard Prison       # download-filename prefix (optional)
//   levels:
//     - name: Rock
//       layers:               # composited bottom-to-top
//         - "attachments/foundry/wizard-prison/...-Rock-...webp"
//     - name: First Floor
//       layers:
//         - "attachments/foundry/wizard-prison/...-Rock-...webp"
//         - "attachments/foundry/wizard-prison/...-First Floor-...webp"
//   ```
//
// The browser runtime (BATTLEMAP_RUNTIME below) ships as a built-in asset
// concatenated into _handlers.js; styles go into _handlers.css.
//
// Layer paths are vault-relative and resolve to the absolute served URL. They
// must also be staged into the deploy — true when the page already references
// them (e.g. a Scene's foundry.data_json), which is the common case.

import yaml from "js-yaml";
import type { CodeBlockHandler } from "../types.js";
import { htmlEscape } from "../../../escape.js";
import { registerBuiltinAssets } from "../assets.js";

interface RawLevel {
  name?: unknown;
  layers?: unknown;
}
interface RawSpec {
  grid?: unknown;
  default_level?: unknown;
  name?: unknown;
  levels?: unknown;
}
interface Level {
  name: string;
  layers: string[];
}

/** Vault-relative path -> absolute, percent-encoded served URL. */
function servedSrc(path: string): string {
  return "/" + path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

function errorBox(message: string): { html: string } {
  return { html: `<div class="vaults-bm-error">${htmlEscape(message)}</div>` };
}

export const battlemapHandler: CodeBlockHandler = {
  codeBlock: "battlemap",
  render(content: string): { html: string } {
    let spec: RawSpec;
    try {
      spec = (yaml.load(content) ?? {}) as RawSpec;
    } catch {
      return errorBox("battlemap: could not parse YAML");
    }

    const levels: Level[] = (Array.isArray(spec.levels) ? (spec.levels as RawLevel[]) : [])
      .map((lv) => ({
        name: typeof lv?.name === "string" ? lv.name : "",
        layers: Array.isArray(lv?.layers)
          ? (lv.layers as unknown[]).filter((s): s is string => typeof s === "string" && s.length > 0)
          : [],
      }))
      .filter((lv) => lv.layers.length > 0);

    if (levels.length === 0) return errorBox("battlemap: no levels with layers");

    const grid = Number(spec.grid) > 0 ? Number(spec.grid) : 0;
    let active = Number.isInteger(Number(spec.default_level)) ? Number(spec.default_level) : 0;
    if (active < 0 || active >= levels.length) active = 0;
    const mapName = typeof spec.name === "string" ? spec.name.trim() : "";

    const levelBtns = levels
      .map((lv, i) =>
        `<button type="button" class="vaults-bm-level" role="tab" data-level="${i}"`
        + ` aria-selected="${i === active ? "true" : "false"}">${htmlEscape(lv.name || `Level ${i + 1}`)}</button>`,
      )
      .join("");

    const tools =
      (grid ? `<button type="button" class="vaults-bm-grid" aria-pressed="false" title="Toggle grid">Grid</button>` : "")
      + `<button type="button" class="vaults-bm-download" title="Download this level as an image">Download</button>`;

    const panes = levels
      .map((lv, i) => {
        const imgs = lv.layers
          .map((p, j) =>
            `<img src="${servedSrc(p)}" alt="${htmlEscape(lv.name)} layer ${j + 1}" loading="lazy">`,
          )
          .join("");
        return `<div class="vaults-bm-pane${i === active ? " is-active" : ""}" data-level="${i}"`
          + ` data-name="${htmlEscape(lv.name)}">${imgs}</div>`;
      })
      .join("");

    const overlay = grid ? `<div class="vaults-bm-grid-overlay" aria-hidden="true"></div>` : "";

    const html =
      `<div class="vaults-battlemap"${grid ? ` data-grid="${grid}"` : ""}`
      + `${mapName ? ` data-name="${htmlEscape(mapName)}"` : ""}>`
      + `<div class="vaults-bm-bar">`
      + `<div class="vaults-bm-levels" role="tablist">${levelBtns}</div>`
      + `<div class="vaults-bm-tools">${tools}</div>`
      + `</div>`
      + `<div class="vaults-bm-stage">${panes}${overlay}</div>`
      + `</div>`;
    return { html };
  },
};

// ── Browser runtime ───────────────────────────────────────────────────────

const BATTLEMAP_RUNTIME = `
(function () {
  function initMap(root) {
    var grid = parseFloat(root.getAttribute('data-grid')) || 0;
    var overlay = root.querySelector('.vaults-bm-grid-overlay');
    var panes = root.querySelectorAll('.vaults-bm-pane');
    var btns = root.querySelectorAll('.vaults-bm-level');

    function active() { return root.querySelector('.vaults-bm-pane.is-active'); }

    function sizeGrid() {
      if (!grid || !overlay) return;
      var pane = active();
      var img = pane && pane.querySelector('img');
      if (!img || !img.naturalWidth) return;
      overlay.style.backgroundSize =
        (grid / img.naturalWidth * 100) + '% ' + (grid / img.naturalHeight * 100) + '%';
    }

    function setLevel(i) {
      panes.forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-level') === i); });
      btns.forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-level') === i ? 'true' : 'false'); });
      sizeGrid();
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () { setLevel(b.getAttribute('data-level')); });
    });

    var gridBtn = root.querySelector('.vaults-bm-grid');
    if (gridBtn) gridBtn.addEventListener('click', function () {
      var on = root.classList.toggle('show-grid');
      gridBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) sizeGrid();
    });

    var dlBtn = root.querySelector('.vaults-bm-download');
    if (dlBtn) dlBtn.addEventListener('click', function () { download(root); });

    root.querySelectorAll('img').forEach(function (img) {
      if (img.complete) sizeGrid(); else img.addEventListener('load', sizeGrid);
    });
    window.addEventListener('resize', sizeGrid);
  }

  function download(root) {
    var pane = root.querySelector('.vaults-bm-pane.is-active');
    var imgs = pane ? pane.querySelectorAll('img') : [];
    if (!imgs.length || !imgs[0].naturalWidth) return;
    var canvas = document.createElement('canvas');
    canvas.width = imgs[0].naturalWidth;
    canvas.height = imgs[0].naturalHeight;
    var ctx = canvas.getContext('2d');
    imgs.forEach(function (img) { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); });

    // Bake in the grid only when it's currently shown, matching the overlay.
    var grid = parseFloat(root.getAttribute('data-grid')) || 0;
    if (grid > 0 && root.classList.contains('show-grid')) {
      // Scale the line to the on-screen 1px so the baked grid looks the same.
      var scale = imgs[0].width ? imgs[0].naturalWidth / imgs[0].width : 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      for (var gx = 0; gx <= canvas.width; gx += grid) { ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); }
      for (var gy = 0; gy <= canvas.height; gy += grid) { ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); }
      ctx.stroke();
    }

    var prefix = root.getAttribute('data-name');
    var name = (prefix ? prefix + ' - ' : '') + (pane.getAttribute('data-name') || 'map');
    try {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }, 'image/png');
    } catch (e) {
      // Tainted canvas (cross-origin image): fall back to opening the base layer.
      window.open(imgs[0].src, '_blank');
    }
  }

  function initAll() { document.querySelectorAll('.vaults-battlemap').forEach(initMap); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
`;

const BATTLEMAP_STYLES = `
.vaults-battlemap { margin: 1rem 0; }
.vaults-bm-bar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; justify-content: space-between; margin-bottom: .5rem; }
.vaults-bm-levels, .vaults-bm-tools { display: flex; flex-wrap: wrap; gap: .25rem; }
.vaults-battlemap button { font: inherit; font-size: .85rem; line-height: 1.2; padding: .3rem .7rem; border: 1px solid var(--rule, #ccc); border-radius: 4px; background: var(--bg, #fff); color: var(--fg, #222); cursor: pointer; }
.vaults-battlemap button:hover { border-color: var(--accent, #888); }
.vaults-bm-level[aria-selected="true"], .vaults-bm-grid[aria-pressed="true"] { background: var(--accent, #333); color: var(--accent-fg, #fff); border-color: var(--accent, #333); }
.vaults-bm-stage { position: relative; line-height: 0; border: 1px solid var(--rule, #ccc); border-radius: 4px; overflow: hidden; background: #15151a; }
.vaults-bm-pane { display: none; position: relative; }
.vaults-bm-pane.is-active { display: block; }
.vaults-bm-pane img { display: block; width: 100%; height: auto; -webkit-user-drag: none; user-select: none; }
.vaults-bm-pane img:not(:first-child) { position: absolute; inset: 0; }
.vaults-bm-grid-overlay { position: absolute; inset: 0; display: none; pointer-events: none; background-image: linear-gradient(to right, rgba(0,0,0,.5) 0 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.5) 0 1px, transparent 1px); }
.vaults-battlemap.show-grid .vaults-bm-grid-overlay { display: block; }
.vaults-bm-error { padding: .5rem .75rem; border: 1px solid #b94a3a; border-radius: 4px; color: #b94a3a; font-size: .85rem; }
`;

registerBuiltinAssets(battlemapHandler, {
  scripts: [{ source: "builtin/battlemap.runtime.js", content: BATTLEMAP_RUNTIME }],
  styles: [{ source: "builtin/battlemap.css", content: BATTLEMAP_STYLES }],
});
