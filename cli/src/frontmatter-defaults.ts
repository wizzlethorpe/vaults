// Apply `default_frontmatter` rules to a page's frontmatter.
//
// The point is that there is exactly one answer to "what does this page's
// frontmatter say", and everything downstream reads it: the wiki renderer, the
// manifest the Foundry sync client consumes, and the module compiler. A
// setting that only one of those understood would be a way for a synced vault
// and an installed module to disagree about the same page, which is the thing
// they must not do.
//
// Defaults, not overrides: a page that states something wins. Rules apply in
// order and deep-merge, so a broad rule sets a baseline and a narrow one
// adjusts part of it.

import picomatch from "picomatch";
import type { FrontmatterRule } from "./settings.js";

/** Deep-merge `source` into `target` without overwriting anything present. */
export function mergeDefaults(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    const existing = target[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (existing === undefined) {
        target[k] = structuredClone(v);
        continue;
      }
      // Recurse only into a plain object. A page that set this key to a scalar
      // or a list has answered the question, and a default must not reach past
      // that answer to patch something underneath it.
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        mergeDefaults(existing as Record<string, unknown>, v as Record<string, unknown>);
      }
      continue;
    }
    if (existing === undefined) target[k] = v;
  }
}

export interface CompiledRule {
  isMatch: (path: string) => boolean;
  data: Record<string, unknown>;
}

/**
 * Compile the rules once. Globs are matched against every page, so building a
 * matcher per page per rule would be the most expensive thing in the build for
 * no reason.
 */
export function compileFrontmatterRules(rules: FrontmatterRule[]): CompiledRule[] {
  return rules
    // A plain object, not merely `typeof "object"`, which also admits null and
    // arrays. An array here would merge its indices in as keys — silently, and
    // as frontmatter. Checked here as well as in the settings validator
    // because this is the one that runs on every build.
    .filter((r) => r && typeof r.match === "string"
      && r.data !== null && typeof r.data === "object" && !Array.isArray(r.data))
    .map((r) => ({
      // dot: true so a rule can reach a page under a dotted directory, matching
      // how `ignore` globs already behave in this build.
      isMatch: picomatch(r.match, { dot: true }),
      data: r.data,
    }));
}

/**
 * Fill in a page's frontmatter from the rules it matches, in place.
 *
 * Returns the same object for convenience. Called where frontmatter is first
 * parsed, so no caller has to remember to do it.
 */
export function applyFrontmatterDefaults(
  path: string,
  frontmatter: Record<string, unknown>,
  rules: CompiledRule[],
): Record<string, unknown> {
  for (const rule of rules) {
    if (rule.isMatch(path)) mergeDefaults(frontmatter, rule.data);
  }
  return frontmatter;
}
