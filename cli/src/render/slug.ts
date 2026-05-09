// Stable slug used for wikilink resolution. Mirrors GitHub-style heading slugs
// so [[Page Title]] always finds the page regardless of how it was capitalised.
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Historical alias retained for the bases plugin. The "sibling-import
// avoidance" comment in bases.ts predates the current shape of slug.ts (which
// has no imports of its own), so a direct re-export is fine — the alias is
// kept so existing call sites don't churn.
export { slugify as slugifySimple };
