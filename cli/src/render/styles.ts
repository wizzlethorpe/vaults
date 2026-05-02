// Theme + layout styles for the rendered wiki. Self-contained, no build step.
// Light: parchment + scarlet, Dark: charcoal + emerald (auto by prefers-color-scheme).

/**
 * Per-vault accent overrides. When `accent_color` (light) or `accent_color_dark`
 * is set in settings.md, append this block after DEFAULT_CSS so it wins. The
 * derived shades (--accent-soft, --wikilink-bg) are recomputed via color-mix
 * so they stay coherent with whatever color the user picked.
 */
export function renderThemeOverride(opts: { lightAccent: string; darkAccent: string }): string {
  const blocks: string[] = [];
  if (opts.lightAccent) blocks.push(accentBlock(":root", opts.lightAccent));
  if (opts.darkAccent) {
    blocks.push(`@media (prefers-color-scheme: dark) {\n${accentBlock(":root", opts.darkAccent)}\n}`);
  }
  return blocks.length === 0 ? "" : "\n\n/* User accent overrides (settings.md) */\n" + blocks.join("\n");
}

function accentBlock(selector: string, color: string): string {
  return `${selector} {
  --accent: ${color};
  --accent-soft: color-mix(in srgb, ${color} 70%, white);
  --wikilink-bg: color-mix(in srgb, ${color} 10%, transparent);
  --wikilink-bg-hover: color-mix(in srgb, ${color} 20%, transparent);
}`;
}

export const DEFAULT_CSS = `:root {
  --bg: #f4ecd8; --fg: #1d1a17; --muted: #6b665e;
  --accent: #a8201a; --accent-soft: #c8423d; --accent-fg: #fbf6e8;
  --rule: #d8cfb8;
  --wikilink-bg: rgba(168,32,26,0.10); --wikilink-bg-hover: rgba(168,32,26,0.20);
  --max-width: 56rem;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #181a1a; --fg: #e6e3dc; --muted: #8a908c;
    --accent: #2ecc71; --accent-soft: #58e08c; --accent-fg: #0d1411;
    --rule: #2a2e2c;
    --wikilink-bg: rgba(46,204,113,0.12); --wikilink-bg-hover: rgba(46,204,113,0.22);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.6; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Pill styling only for wikilinks inside article body. */
article a.internal {
  background: var(--wikilink-bg); padding: 0.05em 0.35em; border-radius: 3px;
  text-decoration: none; transition: background 0.12s ease; color: var(--accent);
}
article a.internal:hover { background: var(--wikilink-bg-hover); text-decoration: none; }
article a.internal.new, article a.internal.is-unresolved { opacity: 0.7; font-style: italic; }

/* Brand sits at the top of the left sidebar in place of the old top nav.
   The sidebar's flex gap handles spacing — no extra margin or rule needed. */
.sidebar > .brand {
  display: block; padding: 0 0.5rem;
  font-weight: 700; font-size: 1.05rem; letter-spacing: 0.04em;
  color: var(--fg); text-decoration: none;
}
.sidebar > .brand:hover { color: var(--accent); text-decoration: none; }

.app-grid {
  display: grid; grid-template-columns: 15rem minmax(0, 56rem) 17rem;
  gap: 2.5rem; max-width: 96rem; margin: 0 auto; padding: 1.5rem;
}
main { padding: 2rem 0 4rem; min-width: 0; }
.sidebar { padding: 1.5rem 1.5rem 1.5rem 0; border-right: 1px solid var(--rule); font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem; }
/* Visual break between the header group (brand/search/auth) and the sitemap. */
.sidebar > nav:last-child { margin-top: 0.9rem; padding-top: 0.9rem; border-top: 1px solid var(--rule); }
.rightbar { padding: 1.5rem 0 1.5rem 1.5rem; border-left: 1px solid var(--rule); font-size: 0.9rem; }
.sidebar h4, .rightbar h4 {
  margin: 0 0 0.5rem; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); font-weight: 600;
}

@media (max-width: 1100px) {
  .app-grid { grid-template-columns: 1fr; gap: 0; }
  .sidebar { border: none; padding: 0.75rem 0 0; }
  .rightbar { border: none; padding: 1rem 0; border-top: 1px solid var(--rule); margin-top: 2rem; }
  main { padding: 0.75rem 0 3rem; }
}

.search-box { position: relative; }
#vault-search {
  width: 100%; padding: 0.5rem 0.75rem; font: inherit; font-size: 0.9rem;
  background: var(--bg); color: var(--fg); border: 1px solid var(--rule); border-radius: 4px; outline: none;
}
#vault-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--wikilink-bg); }
.search-results {
  display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--bg); border: 1px solid var(--rule); border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.18); max-height: 22rem; overflow-y: auto; z-index: 100;
}
.search-result { display: block; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--rule); color: var(--fg); }
.search-result:last-child { border-bottom: none; }
.search-result:hover { background: var(--wikilink-bg); text-decoration: none; }
.search-result-title { font-weight: 600; color: var(--accent); }
.search-result-folder { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.15rem; }
.search-empty { padding: 0.75rem; color: var(--muted); font-style: italic; font-size: 0.85rem; }

/* Auth box — sits under the search box; populated by JS from a non-HttpOnly
   display cookie set by the Function on login. */
.auth-box {
  font-size: 0.78rem; color: var(--muted);
  padding: 0.5rem 0.65rem; border: 1px solid var(--rule); border-radius: 4px;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  flex-wrap: wrap;
}
.auth-box:empty { display: none; }
.auth-box .auth-status strong { color: var(--accent); font-weight: 600; }
.auth-box .auth-action { color: var(--accent); text-decoration: none; font-weight: 500; }
.auth-box .auth-action:hover { text-decoration: underline; }
.search-result-summary {
  font-size: 0.78rem; color: var(--muted); margin-top: 0.25rem; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.search-result-summary mark {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
  color: inherit; padding: 0 0.1em; border-radius: 2px;
}

.toc { display: block; }
.toc-summary {
  list-style: none; cursor: pointer; background: transparent; border: none; padding: 0;
  margin-bottom: 0.5rem; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.4rem;
  transition: color 0.12s ease;
}
.toc-summary:hover { color: var(--accent); }
.toc-summary::-webkit-details-marker { display: none; }
/* CSS-drawn chevron — same shape as the sitemap-folder toggles. Rotates
   when [open] so the affordance reads as "click to collapse / expand". */
.toc-summary::before {
  content: ''; display: inline-block;
  width: 5px; height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 0.15s ease;
  opacity: 0.7;
}
.toc[open] > .toc-summary::before { transform: rotate(45deg); }
.toc ul { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0.25rem 0; }
.toc a { color: var(--muted); display: block; padding: 0.1rem 0 0.1rem 0.5rem; border-left: 2px solid transparent; transition: color 0.12s, border-color 0.12s; }
.toc a:hover { color: var(--accent); border-left-color: var(--accent); text-decoration: none; }
.toc-d3 a { padding-left: 1.25rem; font-size: 0.85rem; }
.toc-d4 a { padding-left: 2rem; font-size: 0.8rem; }

/* Backlinks panel — same visual rhythm as the TOC. */
.rightbar .backlinks { margin-top: 1.75rem; }
.rightbar .backlinks h4 {
  margin: 0 0 0.5rem; font-size: 0.75rem;
  text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); font-weight: 600;
}
.rightbar .backlinks ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.rightbar .backlinks a {
  display: block; padding: 0.15rem 0 0.15rem 0.5rem;
  color: var(--muted); text-decoration: none;
  border-left: 2px solid transparent;
  background: transparent;
  transition: color 0.12s, border-color 0.12s;
}
.rightbar .backlinks a:hover { color: var(--accent); border-left-color: var(--accent); }

.page-meta {
  color: var(--muted); font-size: 0.78rem;
  margin: -0.75rem 0 1.75rem;
  display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;
}
.page-meta time { font-variant-numeric: tabular-nums; }
.page-meta .meta-sep { opacity: 0.5; }

.crumbs { color: var(--muted); font-size: 0.875rem; margin-bottom: 1rem; }
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--accent); text-decoration: underline; }
.crumb-sep { color: var(--muted); font-weight: 600; opacity: 0.7; padding: 0 0.05rem; }

article h1 { margin-top: 0; font-size: 2.75rem; line-height: 1.15; }
article h2 { margin-top: 2rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.25rem; }
article hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
article img { max-width: 100%; border-radius: 4px; }

/* Tables — readable defaults so cell content doesn't run together. */
article table {
  border-collapse: collapse;
  margin: 1.25rem 0;
  width: 100%;
}
article th, article td {
  padding: 0.6rem 0.85rem;
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
  text-align: left;
}
article thead th {
  border-bottom: 2px solid var(--rule);
  font-weight: 600;
}
article tbody tr:last-child > td { border-bottom: none; }
article td > img:first-child:last-child {
  /* Solo image in a cell (e.g. portrait + bio layouts) — keep it from sprawling. */
  max-width: 12rem;
}
/* Default size for ![[image]] embeds without an explicit |N hint. The
   width itself is set by --default-img-width on <body>, configurable via
   the default_image_width setting. */
article img.default-width { width: var(--default-img-width, 50vw); max-width: 100%; }

/* Centre images when settings.center_images is on. Scoped to standalone
   <p><img></p> wrappers (Markdown emits these for image-only paragraphs)
   so inline images mid-sentence aren't displaced. */
body.center-images article p > img:only-child { display: block; margin-left: auto; margin-right: auto; }
body.center-images article p:has(> img:only-child) { text-align: center; }

/* Lightbox — click an image in the article body to view it full-size. */
article img { cursor: zoom-in; }
.lightbox-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  cursor: zoom-out;
  animation: lightbox-fade 0.12s ease-out;
}
.lightbox-overlay img {
  max-width: 95vw; max-height: 95vh;
  object-fit: contain; border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
@keyframes lightbox-fade { from { opacity: 0; } to { opacity: 1; } }
article code { background: color-mix(in srgb, var(--muted) 12%, transparent); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
article pre { background: color-mix(in srgb, var(--muted) 12%, transparent); padding: 1rem; border-radius: 6px; overflow-x: auto; }
article pre code { background: none; padding: 0; }
article blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--rule); color: var(--muted); }
article :is(h1,h2,h3,h4,h5,h6) > a { text-decoration: none; color: inherit; }

/* Sitemap nav (in left sidebar). Tree-view layout: folder rows split into a
   chevron toggle column and a folder-link column with a divider between;
   page rows align with the folder-link column so all names start at the same x. */
.sidebar .sitemap-list, .sidebar .sitemap-list ul { list-style: none; padding: 0; margin: 0; }
.sidebar .sitemap-list li { margin: 0; }

.sidebar .sitemap-list a,
.sidebar .sitemap-list a.internal,
.sidebar .sitemap-list a.internal-link {
  display: block;
  padding: 0.2rem 0.4rem 0.2rem 1.5rem;  /* aligns with folder-link text */
  background: transparent;
  color: var(--muted);
  text-decoration: none;
  border-radius: 3px;
  line-height: 1.45;
}
.sidebar .sitemap-list a:hover {
  background: var(--wikilink-bg); color: var(--accent);
}
.sidebar .sitemap-list a[aria-current="page"] {
  color: var(--accent); font-weight: 600; background: var(--wikilink-bg);
}

.sidebar .sitemap-folder > details > summary {
  display: flex;
  align-items: stretch;
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  color: var(--muted);
  border-radius: 3px;
  line-height: 1.45;
  list-style: none;  /* hide native disclosure marker (Firefox) */
}
.sidebar .sitemap-folder > details > summary::-webkit-details-marker { display: none; }

.sidebar .sitemap-folder > details > summary > .folder-toggle {
  position: relative;
  flex: 0 0 1.25rem;
  border-right: 1px solid var(--rule);
  border-radius: 3px 0 0 3px;
}
.sidebar .sitemap-folder > details > summary:hover > .folder-toggle {
  background: var(--wikilink-bg);
}
/* CSS-drawn chevron — crisper and more compact than any Unicode glyph. */
.sidebar .sitemap-folder > details > summary > .folder-toggle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translate(-65%, -65%) rotate(-45deg);
  transform-origin: center;
  opacity: 0.65;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.sidebar .sitemap-folder > details[open] > summary > .folder-toggle::before {
  transform: translate(-50%, -50%) rotate(45deg);
}
.sidebar .sitemap-folder > details > summary:hover > .folder-toggle::before {
  opacity: 1;
}

.sidebar .sitemap-folder > details > summary > .folder-link {
  flex: 1;
  display: block;
  padding: 0.2rem 0.4rem 0.2rem 0.25rem;
  color: inherit;
  text-decoration: none;
  border-radius: 0 3px 3px 0;
}
.sidebar .sitemap-folder > details > summary > .folder-link:hover {
  background: var(--wikilink-bg);
  color: var(--accent);
  text-decoration: none;
}

/* Children of a folder indent uniformly — chevron position is preserved
   relative to the nested ul so descendants form a clean tree. */
.sidebar .sitemap-folder > details > .sitemap-list {
  padding-left: 0.75rem;
}

/* 404 page — leans on the standard article layout but bumps the lead text. */
.lead-404 { font-size: 1.05rem; color: var(--muted); margin-top: 0.5rem; }

/* Auto-generated folder index pages */
.folder-count { color: var(--muted); margin-bottom: 1.5rem; font-size: 0.9rem; }
.folder-listing { list-style: none; padding: 0; margin: 0; }
.folder-listing > li { padding: 0.6rem 0; border-bottom: 1px solid var(--rule); }
.folder-listing > li:last-child { border-bottom: none; }

/* Callouts */
.callout {
  margin: 1rem 0; padding: 0.75rem 1rem; border-left: 4px solid var(--muted);
  border-radius: 0 4px 4px 0; background: color-mix(in srgb, var(--muted) 8%, transparent);
}
.callout > .callout-title { font-weight: 700; margin-bottom: 0.35rem; color: var(--muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
.callout > *:last-child { margin-bottom: 0; }
.callout-note, .callout-info { border-left-color: #3b7bbf; background: color-mix(in srgb, #3b7bbf 10%, transparent); }
.callout-note > .callout-title, .callout-info > .callout-title { color: #3b7bbf; }
.callout-tip, .callout-hint { border-left-color: #2a8b58; background: color-mix(in srgb, #2a8b58 10%, transparent); }
.callout-tip > .callout-title, .callout-hint > .callout-title { color: #2a8b58; }
.callout-warning, .callout-caution { border-left-color: #c89a4d; background: color-mix(in srgb, #c89a4d 12%, transparent); }
.callout-warning > .callout-title, .callout-caution > .callout-title { color: #a87a2d; }
.callout-danger, .callout-error { border-left-color: #b94a3a; background: color-mix(in srgb, #b94a3a 10%, transparent); }
.callout-danger > .callout-title, .callout-error > .callout-title { color: #b94a3a; }
.callout-dm { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.callout-dm > .callout-title { color: var(--accent); }

/* Embed (transcluded ![[Page]]) */
.embed {
  position: relative; border-left: 3px solid var(--accent-soft);
  padding: 0.75rem 1rem 1.1rem; margin: 1rem 0; background: var(--wikilink-bg); border-radius: 0 4px 4px 0;
}
.embed > *:first-child { margin-top: 0; }
.embed > .embed-source { margin-bottom: 0 !important; }
.embed-source {
  position: absolute; bottom: 0.3rem; right: 0.75rem; margin: 0 !important;
  font-size: 0.72rem; line-height: 1;
}
.embed-source a.internal { background: transparent; padding: 0; color: var(--muted); border-radius: 0; }
.embed-source a.internal:hover { background: transparent; color: var(--accent); }
.embed-broken { border-left-color: #b94a3a; color: var(--muted); font-style: italic; }
.embed-cycle, .embed-truncated { border-left-color: var(--muted); color: var(--muted); font-style: italic; }

/* Hover preview popover */
.wiki-preview {
  position: absolute; display: none; max-width: 22rem;
  padding: 0.75rem 1rem; background: var(--bg); color: var(--fg);
  border: 1px solid var(--rule); border-left: 3px solid var(--accent);
  border-radius: 4px; box-shadow: 0 6px 20px rgba(0,0,0,0.18);
  font-size: 0.9rem; line-height: 1.45; z-index: 1000;
}
.wiki-preview-title { font-weight: 700; margin-bottom: 0.2rem; }
.wiki-preview-subheading { color: var(--accent); font-size: 0.8rem; margin-bottom: 0.4rem; font-style: italic; }
.wiki-preview-body { color: var(--muted); }
`;
