import type { PageMeta } from "./types.js";

export interface LayoutInput {
  title: string;
  pagePath: string;
  bodyHtml: string;
  pages: PageMeta[];
  vaultName: string;
  /** Inject an <h1> with the page title above the body. */
  inlineTitle: boolean;
  /** CSS dimension applied to images without an explicit |N size hint. */
  defaultImageWidth: string;
  /** Center images in the article body. */
  centerImages: boolean;
  /** Pages that link to this one. */
  backlinks: PageMeta[];
  /** True if this site has roles beyond the default (i.e. login UI is meaningful). */
  authConfigured: boolean;
  /** Unix-seconds. Optional — synthesized folder indexes may have neither. */
  mtime?: number;
  birthtime?: number;
}

/**
 * Standalone 404 page using the same shell as a regular article (sidebar,
 * search, sitemap), so a missing page still leaves the reader inside the
 * site and able to navigate out. Built once per variant.
 */
export function render404(input: Omit<LayoutInput, "title" | "pagePath" | "bodyHtml" | "backlinks">): string {
  const body = `<p class="lead-404">The page you're looking for doesn't exist, or you don't have access to it.</p>
<p><a class="internal" href="/">Return to ${esc(input.vaultName)} home →</a></p>`;
  return renderLayout({
    ...input,
    title: "Page not found",
    // Neutral sentinel — breadcrumbs check this and render nothing for it.
    pagePath: "__404__.md",
    bodyHtml: body,
    backlinks: [],
  });
}

export function renderLayout(input: LayoutInput): string {
  const breadcrumbs = renderBreadcrumbs(input.pagePath, input.vaultName);
  const sitemap = renderSitemap(input.pages, input.pagePath);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.title)} — ${esc(input.vaultName)}</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/user.css">
</head>
<body${input.centerImages ? ` class="center-images"` : ""}${input.defaultImageWidth ? ` style="--default-img-width: ${attr(input.defaultImageWidth)}"` : ""}>
<div class="app-grid">
  <aside class="sidebar">
    <a class="brand" href="/">${esc(input.vaultName)}</a>
    <div class="search-box">
      <input id="vault-search" type="search" placeholder="Search…" aria-label="Search vault" autocomplete="off">
      <div class="search-results" role="listbox"></div>
    </div>
    ${input.authConfigured ? '<div class="auth-box" id="vault-auth"></div>' : ''}
    ${sitemap}
  </aside>
  <main>
    <article class="markdown-preview-view markdown-rendered">
      ${breadcrumbs}
      ${input.inlineTitle ? `<h1>${esc(input.title)}</h1>` : ""}
      ${renderMeta(input.mtime, input.birthtime)}
      ${input.bodyHtml}
    </article>
  </main>
  <aside class="rightbar">
    <details class="toc" open>
      <summary class="toc-summary">On this page</summary>
      <ul id="page-toc"></ul>
    </details>
    ${renderBacklinks(input.backlinks)}
  </aside>
</div>
${HOVER_PREVIEW_SCRIPT}
${TOC_SCRIPT}
${SEARCH_SCRIPT}
${LIGHTBOX_SCRIPT}
${AUTH_SCRIPT}
</body>
</html>`;
}

function renderBacklinks(backlinks: PageMeta[]): string {
  if (backlinks.length === 0) return "";
  const items = backlinks.map((p) => {
    const href = "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
    return `<li><a href="${attr(href)}" class="internal internal-link">${esc(p.title)}</a></li>`;
  }).join("");
  return `<section class="backlinks"><h4>Backlinks</h4><ul>${items}</ul></section>`;
}

function renderMeta(mtime: number | undefined, birthtime: number | undefined): string {
  if (!mtime && !birthtime) return "";
  const parts: string[] = [];
  if (birthtime && (!mtime || Math.abs(mtime - birthtime) > 60)) {
    // Only show "Created" if it's meaningfully different from the modified time.
    parts.push(`<span>Created <time datetime="${isoDate(birthtime)}">${formatDate(birthtime)}</time></span>`);
  }
  if (mtime) parts.push(`<span>Updated <time datetime="${isoDate(mtime)}">${formatDate(mtime)}</time></span>`);
  return `<div class="page-meta">${parts.join(' <span class="meta-sep">·</span> ')}</div>`;
}

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function renderBreadcrumbs(pagePath: string, vaultName: string): string {
  // Sentinel used by the 404 page — no real path to crumb out of.
  if (pagePath === "__404__.md") return "";
  const parts = pagePath.replace(/\.md$/i, "").split("/");
  if (parts.length === 1 && parts[0] === "index") return "";
  // Folder homepages end in /index — drop that trailing segment so the crumbs
  // read "Vault › DM Notes" instead of "Vault › DM Notes › index".
  if (parts.length > 1 && parts[parts.length - 1] === "index") parts.pop();
  const crumbs = [`<a href="/">${esc(vaultName)}</a>`];
  parts.forEach((part, i) => {
    const isLast = i === parts.length - 1;
    if (isLast) {
      crumbs.push(`<span>${esc(part)}</span>`);
    } else {
      const href = "/" + parts.slice(0, i + 1).map(encodeURIComponent).join("/");
      crumbs.push(`<a href="${attr(href)}">${esc(part)}</a>`);
    }
  });
  return `<nav class="crumbs">${crumbs.join(' <span class="crumb-sep">/</span> ')}</nav>`;
}

interface FolderNode {
  name: string;
  pages: PageMeta[];
  subfolders: Map<string, FolderNode>;
}

function renderSitemap(pages: PageMeta[], currentPath: string): string {
  const root: FolderNode = { name: "", pages: [], subfolders: new Map() };
  for (const p of pages) {
    // index.md at any depth is the folder's homepage, not a sitemap child.
    // The folder is already represented by its <details> wrapper in the parent.
    if (p.path === "index.md" || p.path.endsWith("/index.md")) continue;
    const parts = p.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folder = parts[i]!;
      let child = node.subfolders.get(folder);
      if (!child) {
        child = { name: folder, pages: [], subfolders: new Map() };
        node.subfolders.set(folder, child);
      }
      node = child;
    }
    node.pages.push(p);
  }

  return `<nav><h4>Explorer</h4><ul class="sitemap-list">${renderNode(root, "", currentPath)}</ul></nav>`;
}

function renderNode(node: FolderNode, parentPath: string, currentPath: string): string {
  let html = "";
  // Folders first, then pages — matches Obsidian's file explorer convention.
  // Natural sort so "Page 2" comes before "Page 10" (instead of alphabetical).
  for (const [name, sub] of [...node.subfolders].sort((a, b) => natCompare(a[0], b[0]))) {
    const folderPath = parentPath ? `${parentPath}/${name}` : name;
    const open = nodeContainsPath(sub, currentPath) ? " open" : "";
    const href = "/" + folderPath.split("/").map(encodeURIComponent).join("/") + "/";
    html += `<li class="sitemap-folder"><details${open}><summary><span class="folder-toggle" aria-hidden="true"></span><a href="${attr(href)}" class="folder-link">${esc(name)}</a></summary><ul class="sitemap-list">${renderNode(sub, folderPath, currentPath)}</ul></details></li>`;
  }
  for (const p of [...node.pages].sort((a, b) => natCompare(a.title, b.title))) {
    html += sitemapItem(p, currentPath);
  }
  return html;
}

function natCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function nodeContainsPath(node: FolderNode, currentPath: string): boolean {
  if (node.pages.some((p) => p.path === currentPath)) return true;
  for (const sub of node.subfolders.values()) {
    if (nodeContainsPath(sub, currentPath)) return true;
  }
  return false;
}

function sitemapItem(p: PageMeta, currentPath: string): string {
  const href = "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
  const cur = p.path === currentPath ? ' aria-current="page"' : "";
  return `<li><a href="${attr(href)}"${cur} class="internal internal-link">${esc(p.title)}</a></li>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const HOVER_PREVIEW_SCRIPT = `<script>
(function () {
  const cache = new Map();
  let popover = null, showTimer = null, hideTimer = null, activeLink = null;
  const HOVER_DELAY = 220, HIDE_DELAY = 180;

  function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement('div');
    popover.className = 'wiki-preview';
    popover.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
    popover.addEventListener('mouseleave', schedHide);
    document.body.appendChild(popover);
    return popover;
  }
  function position(pop, link) {
    const rect = link.getBoundingClientRect();
    pop.style.visibility = 'hidden'; pop.style.display = 'block';
    const popRect = pop.getBoundingClientRect();
    const m = 8;
    let top = rect.bottom + window.scrollY + m;
    if (rect.bottom + popRect.height + m > window.innerHeight) top = rect.top + window.scrollY - popRect.height - m;
    let left = rect.left + window.scrollX;
    if (left + popRect.width + m > window.innerWidth + window.scrollX) left = window.innerWidth + window.scrollX - popRect.width - m;
    if (left < m) left = m;
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
    pop.style.visibility = 'visible';
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function render(data, anchor) {
    // .summary is already sanitised HTML at build time — safe to inject.
    const section = anchor && data.headings && data.headings[anchor];
    if (section) {
      return '<div class="wiki-preview-title">' + esc(data.title) + '</div>' +
             '<div class="wiki-preview-subheading">› ' + esc(section.title) + '</div>' +
             '<div class="wiki-preview-body">' + (section.summary || '') + '</div>';
    }
    return '<div class="wiki-preview-title">' + esc(data.title) + '</div>' +
           '<div class="wiki-preview-body">' + (data.summary || '') + '</div>';
  }
  async function fetchPreview(href) {
    if (cache.has(href)) return cache.get(href);
    try {
      const url = href.replace(/#.*$/, '') + '.preview.json';
      const res = await fetch(url);
      if (!res.ok) { cache.set(href, null); return null; }
      const data = await res.json();
      cache.set(href, data);
      return data;
    } catch { cache.set(href, null); return null; }
  }
  function isInternal(el) {
    if (!(el instanceof HTMLAnchorElement)) return false;
    // Only preview links inside the main article body — sitemap / backlinks /
    // breadcrumbs / TOC links shouldn't trigger popovers as the user navigates.
    if (!el.closest('article')) return false;
    const href = el.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return false;
    if (href.endsWith('.json') || href.endsWith('.css')) return false;
    return true;
  }
  function schedHide() { hideTimer = window.setTimeout(() => { if (popover) popover.style.display = 'none'; activeLink = null; }, HIDE_DELAY); }
  document.addEventListener('mouseover', (e) => {
    const link = e.target;
    if (!isInternal(link)) return;
    if (link === activeLink) { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } return; }
    activeLink = link;
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    showTimer = window.setTimeout(async () => {
      const href = link.getAttribute('href');
      const hashIdx = href.indexOf('#');
      const anchor = hashIdx === -1 ? '' : href.slice(hashIdx + 1);
      const data = await fetchPreview(href);
      if (!data || activeLink !== link) return;
      const pop = ensurePopover();
      pop.innerHTML = render(data, anchor);
      position(pop, link);
    }, HOVER_DELAY);
  });
  document.addEventListener('mouseout', (e) => {
    if (!isInternal(e.target)) return;
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
    schedHide();
  });
})();
</script>`;

const TOC_SCRIPT = `<script>
(function () {
  const headings = Array.from(document.querySelectorAll('article h2, article h3, article h4'));
  const list = document.getElementById('page-toc');
  if (!list || headings.length < 2) {
    const toc = document.querySelector('.toc');
    if (toc) toc.style.display = 'none';
    return;
  }
  list.innerHTML = headings.map(h => {
    const id = h.id || (h.querySelector('a') && h.querySelector('a').id) || '';
    const text = h.textContent || '';
    const cls = 'toc-d' + h.tagName[1];
    return '<li class="' + cls + '"><a href="#' + id + '">' + text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</a></li>';
  }).join('');
})();
</script>`;

const AUTH_SCRIPT = `<script>
(function () {
  const box = document.getElementById('vault-auth');
  if (!box) return;
  const role = readCookie('vault_role_display');
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  if (role) {
    box.innerHTML =
      '<div class="auth-status">Signed in as <strong>' + esc(role) + '</strong></div>' +
      '<a class="auth-action" href="/logout?next=' + next + '">Sign out</a>';
  } else {
    box.innerHTML = '<a class="auth-action" href="/login.html?next=' + next + '">Sign in</a>';
  }
  function readCookie(name) {
    for (const part of document.cookie.split(/;\\s*/)) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
    }
    return '';
  }
  function esc(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
})();
</script>`;

const LIGHTBOX_SCRIPT = `<script>
(function () {
  let onKey = null;
  function close(overlay) {
    overlay.remove();
    if (onKey) document.removeEventListener('keydown', onKey);
    onKey = null;
  }
  document.addEventListener('click', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.closest('article')) return;
    if (img.closest('a')) return; // skip linked images
    e.preventDefault();
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    const big = document.createElement('img');
    big.src = img.src;
    big.alt = img.alt;
    overlay.appendChild(big);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => close(overlay));
    onKey = (ev) => { if (ev.key === 'Escape') close(overlay); };
    document.addEventListener('keydown', onKey);
  });
})();
</script>`;

const SEARCH_SCRIPT = `<script>
(function () {
  const input = document.getElementById('vault-search');
  const results = document.querySelector('.search-results');
  if (!input || !results) return;
  let index = null;
  let loading = false;

  async function ensureIndex() {
    if (index || loading) return;
    loading = true;
    try {
      const res = await fetch('/_search-index.json');
      if (res.ok) index = await res.json();
    } finally { loading = false; }
  }

  function escape(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

  function buildSnippet(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return '';
    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + query.length + 80);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < text.length) snippet = snippet + '…';
    // Highlight the match.
    const matchStart = idx - start + (start > 0 ? 1 : 0);
    const before = escape(snippet.slice(0, matchStart));
    const hit = escape(snippet.slice(matchStart, matchStart + query.length));
    const after = escape(snippet.slice(matchStart + query.length));
    return before + '<mark>' + hit + '</mark>' + after;
  }

  function show(matches) {
    if (!matches.length) {
      results.style.display = 'block';
      results.innerHTML = '<div class="search-empty">No matches.</div>';
      return;
    }
    results.style.display = 'block';
    results.innerHTML = matches.slice(0, 25).map(m =>
      '<a class="search-result" href="' + m.href.replace(/"/g, '&quot;') + '">' +
      '<div class="search-result-title">' + escape(m.title) + '</div>' +
      (m.folder ? '<div class="search-result-folder">' + escape(m.folder) + '</div>' : '') +
      (m.snippet ? '<div class="search-result-summary">' + m.snippet + '</div>' : '') +
      '</a>'
    ).join('');
  }

  input.addEventListener('focus', ensureIndex);
  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; return; }
    await ensureIndex();
    if (!index) return;
    const matches = [];
    for (const p of index) {
      const titleLc = p.title.toLowerCase();
      const pathLc = p.path.toLowerCase();
      const textLc = (p.text || '').toLowerCase();
      const inTitle = titleLc.includes(q);
      const inPath = pathLc.includes(q);
      const inText = textLc.includes(q);
      if (!(inTitle || inPath || inText)) continue;
      // Rank: title hits first, then path, then body. Stable order otherwise.
      const rank = inTitle ? 0 : inPath ? 1 : 2;
      matches.push({
        ...p,
        rank,
        snippet: inText && !inTitle ? buildSnippet(p.text, q) : '',
      });
    }
    matches.sort((a, b) => a.rank - b.rank);
    show(matches);
  });
  document.addEventListener('click', (e) => {
    if (e.target !== input && !results.contains(e.target)) results.style.display = 'none';
  });
})();
</script>`;
