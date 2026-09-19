// Stylesheet rules written onto the elements they match, for HTML shown where
// no stylesheet can follow it. Foundry strips <style> and <link> from a
// journal page but keeps a style attribute.

import type { Element, Root } from "hast";
import { selectAll } from "hast-util-select";

interface Rule { declarations: string; specificity: number; order: number }

/** The top-level rules of `css`, in order. At-rules are dropped: a media query cannot be decided ahead of time. */
export function parseRules(css: string): Array<{ selector: string; declarations: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<{ selector: string; declarations: string }> = [];
  let depth = 0;
  let start = 0;
  let head = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) { head = text.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        if (!head.startsWith("@")) rules.push({ selector: head, declarations: text.slice(start, i).trim() });
        start = i + 1;
      }
    }
  }
  return rules;
}

/** `text` split at each `separator` outside quotes, parentheses and brackets. */
function splitOutside(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === "\"" || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === separator && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

/**
 * A style attribute in the form Foundry's server sanitiser stores it:
 * `prop:value` pairs joined by `;`, duplicates and values kept as written.
 */
export function storedStyle(style: string): string {
  return splitOutside(style, ";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return "";
      const prop = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim().replace(/\s*!important$/i, " !important");
      return prop && value ? `${prop}:${value}` : "";
    })
    .filter(Boolean)
    .join(";");
}

/** CSS specificity as one sortable number: ids, then classes, attributes and pseudo-classes, then types. */
export function specificity(selector: string): number {
  const s = selector.replace(/"[^"]*"|'[^']*'/g, "");
  const ids = s.match(/#[\w-]+/g)?.length ?? 0;
  const classes = s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const types = s.match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g)?.length ?? 0;
  return ids * 10000 + classes * 100 + types;
}

/**
 * Write every rule of `css` that holds without a script onto the elements it
 * matches, in cascade order, ahead of any style the element already carries.
 */
export function inlineCss(tree: Root, css: string): void {
  const matched = new Map<Element, Rule[]>();
  let order = 0;
  for (const { selector, declarations } of parseRules(css)) {
    const block = declarations.replace(/\s+/g, " ").replace(/;\s*$/, "");
    if (!block) continue;
    for (const sel of splitOutside(selector, ",").map((part) => part.trim()).filter(Boolean)) {
      // State a script toggles. Written in, a hidden tab panel would stay
      // hidden in a journal, where no script will ever show it.
      if (/\[(?:hidden|aria-[\w-]+)/.test(sel)) continue;
      let elements: Element[];
      // :hover, ::after and the like throw; none of them can be decided here.
      try { elements = selectAll(sel, tree); } catch { continue; }
      const rule = { declarations: block, specificity: specificity(sel), order: order++ };
      for (const el of elements) {
        const rules = matched.get(el);
        if (rules) rules.push(rule); else matched.set(el, [rule]);
      }
    }
  }
  for (const [el, rules] of matched) {
    rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
    const own = typeof el.properties["style"] === "string" ? el.properties["style"].replace(/;\s*$/, "") : "";
    el.properties["style"] = [...rules.map((r) => r.declarations), own].filter(Boolean).join("; ");
  }
}
