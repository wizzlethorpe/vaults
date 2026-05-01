// Theme + layout styles for the rendered wiki. Self-contained, no build step.
// Light: parchment + scarlet, Dark: charcoal + emerald (auto by prefers-color-scheme).

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

.site-nav {
  border-bottom: 1px solid var(--rule); padding: 0.75rem 1.5rem;
  display: flex; align-items: center; justify-content: space-between; background: var(--bg);
}
.site-nav .brand { font-weight: 700; letter-spacing: 0.04em; color: var(--fg); }
.site-nav .brand:hover { text-decoration: none; color: var(--accent); }

.app-grid {
  display: grid; grid-template-columns: 15rem minmax(0, 56rem) 17rem;
  gap: 2.5rem; max-width: 96rem; margin: 0 auto; padding: 0 1.5rem;
}
main { padding: 2rem 0 4rem; min-width: 0; }
.sidebar { padding: 1.5rem 1.5rem 1.5rem 0; border-right: 1px solid var(--rule); font-size: 0.9rem; display: flex; flex-direction: column; gap: 1.25rem; }
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

.toc { display: block; }
.toc-summary {
  list-style: none; cursor: default; background: transparent; border: none; padding: 0;
  margin-bottom: 0.5rem; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted); font-weight: 600;
}
.toc-summary::-webkit-details-marker { display: none; }
.toc ul { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0.25rem 0; }
.toc a { color: var(--muted); display: block; padding: 0.1rem 0 0.1rem 0.5rem; border-left: 2px solid transparent; transition: color 0.12s, border-color 0.12s; }
.toc a:hover { color: var(--accent); border-left-color: var(--accent); text-decoration: none; }
.toc-d3 a { padding-left: 1.25rem; font-size: 0.85rem; }
.toc-d4 a { padding-left: 2rem; font-size: 0.8rem; }

.crumbs { color: var(--muted); font-size: 0.875rem; margin-bottom: 1rem; }
.crumbs a { color: var(--muted); text-decoration: none; }
.crumbs a:hover { color: var(--accent); text-decoration: underline; }

article h1 { margin-top: 0; font-size: 2.25rem; }
article h2 { margin-top: 2rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.25rem; }
article hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
article img { max-width: 100%; border-radius: 4px; }
article code { background: color-mix(in srgb, var(--muted) 12%, transparent); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
article pre { background: color-mix(in srgb, var(--muted) 12%, transparent); padding: 1rem; border-radius: 6px; overflow-x: auto; }
article pre code { background: none; padding: 0; }
article blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid var(--rule); color: var(--muted); }
article :is(h1,h2,h3,h4,h5,h6) > a { text-decoration: none; color: inherit; }

/* Sitemap nav (in left sidebar). Tree-view layout: every row has the same
   left "gutter" reserved for a chevron, so folder text and page text line up
   even though only folders draw the chevron. */
.sidebar .sitemap-list, .sidebar .sitemap-list ul { list-style: none; padding: 0; margin: 0; }
.sidebar .sitemap-list li { margin: 0; }

.sidebar .sitemap-list a,
.sidebar .sitemap-list a.internal,
.sidebar .sitemap-list a.internal-link,
.sidebar .sitemap-folder > details > summary {
  display: block;
  padding: 0.2rem 0.5rem 0.2rem 1.4rem;  /* 1.4rem reserves the chevron gutter */
  background: transparent;
  color: var(--muted);
  text-decoration: none;
  border-radius: 3px;
  line-height: 1.45;
  position: relative;
}
.sidebar .sitemap-list a:hover,
.sidebar .sitemap-folder > details > summary:hover {
  background: var(--wikilink-bg); color: var(--accent);
}
.sidebar .sitemap-list a[aria-current="page"] {
  color: var(--accent); font-weight: 600; background: var(--wikilink-bg);
}

.sidebar .sitemap-folder > details > summary {
  cursor: pointer; user-select: none; font-weight: 500;
  list-style: none;  /* hide native disclosure marker (Firefox) */
}
.sidebar .sitemap-folder > details > summary > .folder-link {
  color: inherit; text-decoration: none; display: block;
}
.sidebar .sitemap-folder > details > summary > .folder-link:hover {
  text-decoration: none;
}
.sidebar .sitemap-folder > details > summary::-webkit-details-marker { display: none; }
.sidebar .sitemap-folder > details > summary::before {
  content: '\\25B8';                  /* ▸ */
  position: absolute;
  left: 0.5rem;
  top: 50%;
  font-size: 0.7em;
  color: var(--muted);
  transform: translateY(-50%);
  transition: transform 0.15s ease;
}
.sidebar .sitemap-folder > details[open] > summary::before {
  transform: translateY(-50%) rotate(90deg);
}

/* Children of a folder indent uniformly — chevron position is preserved
   relative to the nested ul so descendants form a clean tree. */
.sidebar .sitemap-folder > details > .sitemap-list {
  padding-left: 0.75rem;
}

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
