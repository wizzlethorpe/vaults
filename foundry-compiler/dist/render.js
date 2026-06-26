// Render a vault page's markdown body into Foundry-flavored description HTML.
//
// The vault body is Obsidian/vaults markdown; Foundry wants HTML with native
// inline rolls and Compendium @UUID cross-links. Transforms, in order:
//   1. Drop fenced handler blocks (```spell-card / ```statblock-fm / …) — those
//      are wiki chrome; the Foundry sheet renders mechanics natively.
//   2. `dice: 2d6+1`  →  [[/r 2d6+1]]   (dnd5e native inline roll)
//   3. [[Target|Label]] / [[Target]]  →  @UUID[Compendium.<…>]{Label}, or the
//      bare label when the target isn't a compiled entry.
//   4. Markdown → HTML via marked.
import { marked } from "marked";
const HANDLER_FENCES = new Set([
    "spell-card", "item-card", "statblock", "statblock-fm", "gallery", "battlemap", "rolltable",
]);
/** Strip fenced code blocks whose language tag is a known handler. */
function dropHandlerFences(md) {
    return md.replace(/^```([\w-]+)[^\n]*\n[\s\S]*?^```[ \t]*$/gm, (block, lang) => HANDLER_FENCES.has(lang) ? "" : block);
}
/** `` `dice: 2d6+1` `` → `[[/r 2d6+1]]`. */
function diceToRolls(md) {
    return md.replace(/`dice:\s*([^`]+?)`/gi, (_m, f) => `[[/r ${f.trim()}]]`);
}
/**
 * Rewrite `[[Target|Label]]` and `[[Target]]` to a Compendium @UUID using the
 * provided name→entry index, or to the plain label when unresolved.
 */
function rewriteWikilinks(md, index) {
    return md.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target, label) => {
        const key = target.trim().toLowerCase();
        const text = (label ?? target).trim();
        const entry = index.get(key);
        return entry ? `@UUID[${entry.uuid}]{${text}}` : text;
    });
}
/** Render a vault markdown body to Foundry description HTML.
 *  Wikilinks run before dice: `dice:` is still backticked at that point, so
 *  the wikilink pass can't mistake the generated `[[/r …]]` for a `[[link]]`. */
export function renderBody(md, index) {
    let out = dropHandlerFences(md);
    out = rewriteWikilinks(out, index);
    out = diceToRolls(out);
    return marked.parse(out, { async: false }).trim();
}
//# sourceMappingURL=render.js.map