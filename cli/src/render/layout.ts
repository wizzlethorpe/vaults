import type { PageMeta } from "./types.js";

export interface LayoutInput {
  title: string;
  pagePath: string;
  bodyHtml: string;
  /** All pages, used to render the sitemap sidebar. */
  pages: PageMeta[];
  /** Optional vault display name for the header. */
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
</head>
<body>
<header class="site-header">
  <a class="site-name" href="/">${esc(input.vaultName)}</a>
</header>
<div class="layout">
  <aside class="sidebar-left">${sitemap}</aside>
  <article class="content">
    ${breadcrumbs}
    <h1 class="page-title">${esc(input.title)}</h1>
    ${input.bodyHtml}
  </article>
</div>
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
  return `<nav class="breadcrumbs">${crumbs.join('<span class="bc-sep">›</span>')}</nav>`;
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

  let html = '<ul class="sitemap">';
  for (const p of roots) html += sitemapItem(p, currentPath);
  for (const [folder, children] of [...folders].sort((a, b) => a[0].localeCompare(b[0]))) {
    const open = children.some((p) => p.path === currentPath) ? " open" : "";
    html += `<li class="sitemap-folder"><details${open}><summary>${esc(folder)}</summary><ul class="sitemap">`;
    for (const p of children) html += sitemapItem(p, currentPath);
    html += "</ul></details></li>";
  }
  html += "</ul>";
  return html;
}

function sitemapItem(p: PageMeta, currentPath: string): string {
  const href = "/" + p.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
  const cur = p.path === currentPath ? ' aria-current="page"' : "";
  return `<li><a href="${attr(href)}"${cur}>${esc(p.title)}</a></li>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
