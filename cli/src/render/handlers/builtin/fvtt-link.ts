// Built-in inline `fvtt-link:` handler — a link that prefers the page's
// Foundry document over its journal page.
//
//   Run `fvtt-link: Toggle Feast` before the banquet.
//   See `fvtt-link: Bixby Wizzlethorpe|his statblock` for details.
//
// A wikilink always means the page, and in Foundry lands on its journal page
// when it has one. This is the explicit way to say "the document": on the
// wiki it renders as an ordinary page link, and the Foundry rewrite sends it
// to the Actor / Scene / Macro the page instantiates, falling back to the
// journal page for a page that makes no document.

import type { InlineHandler } from "../types.js";
import { htmlEscape } from "../../../escape.js";
import { slugify } from "../../slug.js";

export const fvttLinkHandler: InlineHandler = {
  inline: "fvtt-link",
  render(content, ctx) {
    const [rawName, rawLabel] = content.split("|", 2);
    const name = (rawName ?? "").trim();
    const label = rawLabel?.trim() || name;
    if (!name) return { html: `<span class="vaults-broken">fvtt-link: (empty)</span>` };

    // The same resolution order as a wikilink, so the two agree on what a
    // bare name means.
    const pages = ctx.render.pages;
    const lastSegment = name.includes("/") ? name.split("/").pop()! : "";
    const page = pages.get(slugify(name))
      ?? pages.get(slugify(name.replace(/\.md$/i, "")))
      ?? pages.get(slugify(name + "/index"))
      ?? (lastSegment ? pages.get(slugify(lastSegment)) : undefined);
    if (!page) {
      return { html: `<a class="internal internal-link is-unresolved new" href="#">${htmlEscape(label)}</a>` };
    }

    const href = "/" + page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
    return {
      html: `<a class="internal internal-link fvtt-doc-link" href="${htmlEscape(href)}">${htmlEscape(label)}</a>`,
    };
  },
};
