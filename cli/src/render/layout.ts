import type { PageMeta } from "./types.js";

export interface LayoutInput {
  title: string;
  pagePath: string;
  bodyHtml: string;
  pages: PageMeta[];
  vaultName: string;
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
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/user.css">
</head>
<body>
<header class="site-nav">
  <a class="brand" href="/">${esc(input.vaultName)}</a>
</header>
<div class="app-grid">
  <aside class="sidebar">
    <div class="search-box">
      <input id="vault-search" type="search" placeholder="Search…" aria-label="Search vault" autocomplete="off">
      <div class="search-results" role="listbox"></div>
    </div>
    ${sitemap}
  </aside>
  <main>
    <article class="markdown-preview-view markdown-rendered">
      ${breadcrumbs}
      <h1>${esc(input.title)}</h1>
      ${input.bodyHtml}
    </article>
  </main>
  <aside class="rightbar">
    <details class="toc" open>
      <summary class="toc-summary">On this page</summary>
      <ul id="page-toc"></ul>
    </details>
  </aside>
</div>
${HOVER_PREVIEW_SCRIPT}
${TOC_SCRIPT}
${SEARCH_SCRIPT}
</body>
</html>`;
}

function renderBreadcrumbs(pagePath: string, vaultName: string): string {
  const parts = pagePath.replace(/\.md$/i, "").split("/");
  if (parts.length === 1 && parts[0] === "index") return "";
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
  return `<nav class="crumbs">${crumbs.join(" › ")}</nav>`;
}

function renderSitemap(pages: PageMeta[], currentPath: string): string {
  const roots: PageMeta[] = [];
  const folders = new Map<string, PageMeta[]>();
  for (const p of pages) {
    if (p.path === "index.md") continue;
    const parts = p.path.split("/");
    if (parts.length === 1) {
      roots.push(p);
    } else {
      const key = parts[0]!;
      if (!folders.has(key)) folders.set(key, []);
      folders.get(key)!.push(p);
    }
  }

  let html = '<nav><h4>Pages</h4><ul class="sitemap-list">';
  for (const p of roots) html += sitemapItem(p, currentPath);
  for (const [folder, children] of [...folders].sort((a, b) => a[0].localeCompare(b[0]))) {
    const open = children.some((p) => p.path === currentPath) ? " open" : "";
    html += `<li class="sitemap-folder"><details${open}><summary>${esc(folder)}</summary><ul>`;
    for (const p of children) html += sitemapItem(p, currentPath);
    html += "</ul></details></li>";
  }
  html += "</ul></nav>";
  return html;
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
    const section = anchor && data.headings && data.headings[anchor];
    if (section) {
      return '<div class="wiki-preview-title">' + esc(data.title) + '</div>' +
             '<div class="wiki-preview-subheading">› ' + esc(section.title) + '</div>' +
             '<div class="wiki-preview-body">' + esc(section.summary || '') + '</div>';
    }
    return '<div class="wiki-preview-title">' + esc(data.title) + '</div>' +
           '<div class="wiki-preview-body">' + esc(data.summary || '') + '</div>';
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
  function show(matches) {
    if (!matches.length) { results.style.display = 'block'; results.innerHTML = '<div class="search-empty">No matches.</div>'; return; }
    results.style.display = 'block';
    results.innerHTML = matches.slice(0, 25).map(m =>
      '<a class="search-result" href="' + m.href.replace(/"/g,'&quot;') + '">' +
      '<div class="search-result-title">' + escape(m.title) + '</div>' +
      (m.folder ? '<div class="search-result-folder">' + escape(m.folder) + '</div>' : '') +
      '</a>'
    ).join('');
  }
  function escape(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  input.addEventListener('focus', ensureIndex);
  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; return; }
    await ensureIndex();
    if (!index) return;
    const matches = index.filter(p => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    show(matches);
  });
  document.addEventListener('click', (e) => {
    if (e.target !== input && !results.contains(e.target)) results.style.display = 'none';
  });
})();
</script>`;
