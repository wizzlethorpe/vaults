// Obsidian Bases support.
//
// Two entry points:
//   1. The remark plugin parses ```base / ```bases code fences inline.
//   2. renderBase() is exported so embed.ts can render ![[Foo]] when
//      Foo.base exists in the vault.
//
// Both paths share the same parser + evaluator + view renderers.
//
// Supported (v3):
//   - filters:   string expression OR { and|or|not: [expr|tree] } tree
//   - views:     table | cards | list. table is sortable; cards is a
//                grid of clickable cards with cover images; list is a
//                compact bulleted list.
//   - sort:      [{ column, direction }] honored on every view type;
//                multi-key (later entries break ties from earlier ones).
//   - formulas:  top-level `formulas: { name: expr }` block. Reference
//                as `formula.name` from order, filters, and other
//                formulas. Memoized per row; cycles raise an error.
//   - properties: { <id>: { displayName? } }; works for note.X,
//                 file.X, and formula.X column ids.
//   - identifiers: file.{name,basename,path,folder,ext,mtime,ctime,tags}
//                  note.X / bare X (frontmatter), formula.X
//   - operators:  == != < <= > >= && || !  + (string concat / numeric add)
//   - methods:    file.hasTag("..."), file.inFolder("..."),
//                 stringValue.contains("..."), .startsWith, .endsWith,
//                 .lower, .upper
//   - literals:   strings (double or single quoted), numbers, true/false, null
//   - cards-only: image: <prop>, imageFit: cover|contain, imageAspectRatio
//
// Deferred:
//   - summaries, groupBy
//   - map view type
//   - duration arithmetic (now() - "1 week" etc.)
//
// Unknown view types and unknown YAML keys are warned-on, not fatal —
// real .base files in the wild include undocumented fields.

import type { Plugin } from "unified";
import type { Root, Code, Html } from "mdast";
import { visit } from "unist-util-visit";
import yaml from "js-yaml";
import type { PageMeta, RenderContext, RenderWarning } from "./types.js";

const BASE_LANG_RE = /^bases?$/i;

// ── Public plugin entry ────────────────────────────────────────────────────

export function basesPlugin(opts: {
  context: RenderContext;
  warnings?: RenderWarning[];
}): Plugin<[], Root> {
  return () => (tree) => {
    visit(tree, "code", (node, index, parent) => {
      if (!node.lang || !BASE_LANG_RE.test(node.lang)) return;
      if (!parent || index == null) return;
      const html = renderBase(node.value || "", opts.context, opts.warnings);
      const replacement: Html = { type: "html", value: html };
      parent.children.splice(index, 1, replacement);
    });
  };
}

// ── Parse + render a single base ───────────────────────────────────────────

interface BaseDoc {
  filters?: FilterTree;
  views?: ViewSpec[];
  properties?: Record<string, { displayName?: string }>;
  formulas?: Record<string, string>;
  // summaries: parsed, not evaluated yet.
  summaries?: Record<string, string>;
}
type FilterTree =
  | string
  | { and: FilterTree[] }
  | { or: FilterTree[] }
  | { not: FilterTree[] };

interface ViewSpec {
  type: string;
  name?: string;
  limit?: number;
  order?: string[];
  filters?: FilterTree;
  sort?: { column: string; direction?: "ASC" | "DESC" }[];
  // Cards-only options.
  image?: string;            // frontmatter property to use for the cover (e.g. "cover")
  imageFit?: "cover" | "contain";
  imageAspectRatio?: string; // CSS aspect-ratio value (e.g. "1/1", "3/4")
}

/**
 * Public entry point. Renders a base's YAML source as HTML. If `viewName`
 * is given, only the matching view is rendered (used for the
 * `![[MyBase#ViewName]]` embed form).
 */
export function renderBase(
  source: string,
  context: RenderContext,
  warnings?: RenderWarning[],
  viewName?: string,
): string {
  let doc: BaseDoc;
  try {
    doc = (yaml.load(source) as BaseDoc) ?? {};
  } catch (err) {
    return errorBlock(`Failed to parse base YAML: ${(err as Error).message}`);
  }

  const allRows = collectRows(context);
  try {
    setupFormulas(allRows, doc);
  } catch (err) {
    return errorBlock(`Formula error: ${(err as Error).message}`);
  }
  let baseRows: Row[];
  try {
    baseRows = doc.filters ? allRows.filter((row) => evalFilter(doc.filters!, row)) : allRows;
  } catch (err) {
    return errorBlock(`Filter error: ${(err as Error).message}`);
  }

  let views = doc.views && doc.views.length > 0 ? doc.views : [{ type: "table" }];
  if (viewName) {
    const matched = views.filter((v) => v.name === viewName);
    if (matched.length === 0) {
      return errorBlock(`Bases: no view named '${esc(viewName)}'.`);
    }
    views = matched;
  }

  const blocks: string[] = [];
  for (const view of views) {
    try {
      if (view.type === "table") {
        blocks.push(renderTableView(view, baseRows, doc, context));
      } else if (view.type === "cards") {
        blocks.push(renderCardsView(view, baseRows, doc, context));
      } else if (view.type === "list") {
        blocks.push(renderListView(view, baseRows, doc));
      } else {
        if (warnings) warnings.push({ kind: "broken-link", target: `bases view type '${view.type}'` });
        blocks.push(errorBlock(`Bases: view type '${esc(view.type)}' is not supported.`));
      }
    } catch (err) {
      // Errors here come from formula evaluation, expression parsing, or
      // bad sort keys; surface them inline so the rest of the page still
      // renders rather than aborting the build.
      blocks.push(errorBlock(`Bases: ${(err as Error).message}`));
    }
  }
  return blocks.join("\n");
}

// ── Row model ──────────────────────────────────────────────────────────────

interface Row {
  page: PageMeta;
  fm: Record<string, unknown>;
  /** Parsed formula expressions, shared across rows in the same base. */
  formulaExprs?: Record<string, Expr>;
  /** Per-row memoized formula results; values may be FORMULA_VISITING during eval. */
  formulaCache?: Map<string, unknown>;
}

const FORMULA_VISITING = Symbol("formula-visiting");

/**
 * Parse the doc's formulas once and attach them to each row alongside an
 * empty memo cache. Lazily evaluated by `resolveFormula` on first access.
 */
function setupFormulas(rows: Row[], doc: BaseDoc): void {
  if (!doc.formulas) return;
  const exprs: Record<string, Expr> = {};
  for (const [k, v] of Object.entries(doc.formulas)) {
    if (typeof v !== "string") continue;
    try {
      exprs[k] = parseExpr(v);
    } catch (err) {
      throw new Error(`'${k}': ${(err as Error).message}`);
    }
  }
  for (const row of rows) {
    row.formulaExprs = exprs;
    row.formulaCache = new Map();
  }
}

function resolveFormula(key: string, row: Row): unknown {
  if (!row.formulaExprs || !row.formulaCache) return undefined;
  const expr = row.formulaExprs[key];
  if (!expr) return undefined;
  if (row.formulaCache.has(key)) {
    const v = row.formulaCache.get(key);
    if (v === FORMULA_VISITING) throw new Error(`Formula cycle: ${key}`);
    return v;
  }
  row.formulaCache.set(key, FORMULA_VISITING);
  const value = evalExpr(expr, row);
  row.formulaCache.set(key, value);
  return value;
}

function collectRows(context: RenderContext): Row[] {
  // pages map has multiple keys (basename slug, path slug, aliases) per page.
  // Dedupe by `path` so each page appears once.
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const page of context.pages.values()) {
    if (seen.has(page.path)) continue;
    seen.add(page.path);
    rows.push({ page, fm: page.frontmatter ?? {} });
  }
  // Sort by path so output is stable across runs.
  rows.sort((a, b) => a.page.path.localeCompare(b.page.path));
  return rows;
}

// ── Filter tree evaluator ──────────────────────────────────────────────────

function evalFilter(tree: FilterTree, row: Row): boolean {
  if (typeof tree === "string") return toBool(evalExpr(parseExpr(tree), row));
  if ("and" in tree) return tree.and.every((t) => evalFilter(t, row));
  if ("or" in tree) return tree.or.some((t) => evalFilter(t, row));
  if ("not" in tree) return !tree.not.every((t) => evalFilter(t, row));
  throw new Error("Unknown filter shape: " + JSON.stringify(tree));
}

function toBool(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// ── Expression Pratt parser ────────────────────────────────────────────────

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" } | { t: "rp" } | { t: "comma" } | { t: "dot" } | { t: "end" };

const OP_TWO = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const OP_ONE = new Set(["<", ">", "!", "+", "-", "*", "/", "%"]);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) { v += src[j + 1]; j += 2; }
        else { v += src[j]; j++; }
      }
      if (j >= src.length) throw new Error("Unterminated string literal");
      toks.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + (c === "-" ? 1 : 0);
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    if (c === ".") { toks.push({ t: "dot" }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (OP_TWO.has(two)) { toks.push({ t: "op", v: two }); i += 2; continue; }
    if (OP_ONE.has(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected character '${c}' at position ${i}`);
  }
  toks.push({ t: "end" });
  return toks;
}

type Expr =
  | { type: "lit"; v: unknown }
  | { type: "id"; name: string }
  | { type: "member"; obj: Expr; name: string }
  | { type: "call"; callee: Expr; args: Expr[] }
  | { type: "unary"; op: string; arg: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr };

const BINARY_PREC: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
};

function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos]!;
  const eat = (kind: Tok["t"]) => {
    const t = toks[pos]!;
    if (t.t !== kind) throw new Error(`Expected ${kind}, got ${t.t} at token ${pos}`);
    pos++;
    return t;
  };

  const parsePrimary = (): Expr => {
    const t = peek();
    if (t.t === "num") { pos++; return { type: "lit", v: t.v }; }
    if (t.t === "str") { pos++; return { type: "lit", v: t.v }; }
    if (t.t === "id") {
      pos++;
      if (t.v === "true") return { type: "lit", v: true };
      if (t.v === "false") return { type: "lit", v: false };
      if (t.v === "null") return { type: "lit", v: null };
      return { type: "id", name: t.v };
    }
    if (t.t === "lp") { pos++; const e = parseBinary(0); eat("rp"); return e; }
    if (t.t === "op" && (t.v === "!" || t.v === "-" || t.v === "+")) {
      pos++; return { type: "unary", op: t.v, arg: parsePrimary() };
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  };

  const parseSuffix = (e: Expr): Expr => {
    while (true) {
      const t = peek();
      if (t.t === "dot") {
        pos++;
        const id = eat("id") as { t: "id"; v: string };
        e = { type: "member", obj: e, name: id.v };
        continue;
      }
      if (t.t === "lp") {
        pos++;
        const args: Expr[] = [];
        if (peek().t !== "rp") {
          args.push(parseBinary(0));
          while (peek().t === "comma") { pos++; args.push(parseBinary(0)); }
        }
        eat("rp");
        e = { type: "call", callee: e, args };
        continue;
      }
      return e;
    }
  };

  const parseBinary = (minPrec: number): Expr => {
    let left = parseSuffix(parsePrimary());
    while (true) {
      const t = peek();
      if (t.t !== "op" || !(t.v in BINARY_PREC)) break;
      const prec = BINARY_PREC[t.v]!;
      if (prec < minPrec) break;
      pos++;
      const right = parseBinary(prec + 1);
      left = { type: "binary", op: t.v, left, right };
    }
    return left;
  };

  const expr = parseBinary(0);
  if (peek().t !== "end") throw new Error("Unexpected trailing tokens");
  return expr;
}

// ── Expression evaluator ───────────────────────────────────────────────────

function evalExpr(e: Expr, row: Row): unknown {
  switch (e.type) {
    case "lit": return e.v;
    case "id": return resolveIdentifier(e.name, row);
    case "member": {
      const obj = evalExpr(e.obj, row);
      // For `file.X` and `note.X` chains, treat the parent as a namespace
      // identifier (the parser produces id("file") then member chain).
      if (e.obj.type === "id" && (e.obj.name === "file" || e.obj.name === "note" || e.obj.name === "formula")) {
        return resolveIdentifier(`${e.obj.name}.${e.name}`, row);
      }
      // Otherwise generic property access. Methods like .lower / .contains
      // are handled in `call` below; here we just unwrap the value.
      if (obj == null) return undefined;
      if (typeof obj === "string" || Array.isArray(obj)) {
        // Expose .length on strings and arrays so `name.length` works as
        // a sort key without needing the explicit method-call form.
        if (e.name === "length") return obj.length;
        return undefined;
      }
      if (typeof obj === "object") {
        return (obj as Record<string, unknown>)[e.name];
      }
      return undefined;
    }
    case "call": {
      // Method calls have a `member` callee: `<obj>.<method>(args)`.
      if (e.callee.type === "member") {
        const args = e.args.map((a) => evalExpr(a, row));
        // file.hasTag / file.inFolder / file.hasLink are special-cased.
        if (e.callee.obj.type === "id" && e.callee.obj.name === "file") {
          return callFileMethod(e.callee.name, args, row);
        }
        const target = evalExpr(e.callee.obj, row);
        return callValueMethod(target, e.callee.name, args);
      }
      // Bare function calls (e.g. `link(...)` if/when we add them).
      if (e.callee.type === "id") {
        const args = e.args.map((a) => evalExpr(a, row));
        return callGlobalFunction(e.callee.name, args);
      }
      throw new Error("Unsupported call shape");
    }
    case "unary": {
      const v = evalExpr(e.arg, row);
      if (e.op === "!") return !toBool(v);
      if (e.op === "-") return -(Number(v) || 0);
      if (e.op === "+") return Number(v) || 0;
      throw new Error("Unknown unary operator: " + e.op);
    }
    case "binary": {
      const l = evalExpr(e.left, row);
      const r = evalExpr(e.right, row);
      switch (e.op) {
        case "&&": return toBool(l) ? r : l;
        case "||": return toBool(l) ? l : r;
        case "==": return looseEq(l, r);
        case "!=": return !looseEq(l, r);
        case "<": return compare(l, r) < 0;
        case "<=": return compare(l, r) <= 0;
        case ">": return compare(l, r) > 0;
        case ">=": return compare(l, r) >= 0;
        case "+": return typeof l === "string" || typeof r === "string"
          ? `${l ?? ""}${r ?? ""}`
          : (Number(l) || 0) + (Number(r) || 0);
        case "-": return (Number(l) || 0) - (Number(r) || 0);
        case "*": return (Number(l) || 0) * (Number(r) || 0);
        case "/": return (Number(l) || 0) / (Number(r) || 1);
        case "%": return (Number(l) || 0) % (Number(r) || 1);
      }
      throw new Error("Unknown binary operator: " + e.op);
    }
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a === b;
  if (typeof a === typeof b) return a === b;
  // Allow "5" == 5 type comparisons because frontmatter is YAML-loose.
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

// ── Identifier resolution ──────────────────────────────────────────────────

function resolveIdentifier(name: string, row: Row): unknown {
  if (name.startsWith("file.")) return fileProperty(name.slice(5), row);
  if (name.startsWith("note.")) return row.fm[name.slice(5)];
  if (name.startsWith("formula.")) return resolveFormula(name.slice(8), row);
  // Bare identifier: resolve against frontmatter (Obsidian shorthand).
  return row.fm[name];
}

function fileProperty(prop: string, row: Row): unknown {
  const path = row.page.path;
  const segments = path.split("/");
  const filename = segments[segments.length - 1]!;
  const basename = filename.replace(/\.[^.]+$/, "");
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
  const folder = segments.length > 1 ? segments.slice(0, -1).join("/") : "";

  switch (prop) {
    case "name": return basename;
    case "basename": return basename;
    case "path": return path;
    case "folder": return folder;
    case "ext": return ext;
    case "mtime": return row.page.mtime ? new Date(row.page.mtime * 1000) : null;
    case "ctime": return row.page.birthtime ? new Date(row.page.birthtime * 1000) : null;
    case "tags": {
      const t = row.fm.tags;
      if (Array.isArray(t)) return t.map(String);
      if (typeof t === "string") return [t];
      return [];
    }
    default: return undefined;
  }
}

function callFileMethod(name: string, args: unknown[], row: Row): unknown {
  switch (name) {
    case "hasTag": {
      const tags = (fileProperty("tags", row) as string[]) || [];
      const want = String(args[0] ?? "").replace(/^#/, "");
      return tags.some((tag) => tag.replace(/^#/, "") === want);
    }
    case "inFolder": {
      const folder = String(fileProperty("folder", row) || "");
      const want = String(args[0] ?? "");
      return folder === want || folder.startsWith(want + "/");
    }
    case "hasLink": {
      // Not modelled in our index; deferred. Evaluate to false so filter
      // semantics stay sane.
      return false;
    }
  }
  throw new Error(`Unknown file method: file.${name}`);
}

function callValueMethod(target: unknown, name: string, args: unknown[]): unknown {
  if (target == null) return null;
  if (typeof target === "string") {
    switch (name) {
      case "contains": return target.toLowerCase().includes(String(args[0] ?? "").toLowerCase());
      case "startsWith": return target.startsWith(String(args[0] ?? ""));
      case "endsWith": return target.endsWith(String(args[0] ?? ""));
      case "lower": return target.toLowerCase();
      case "upper": return target.toUpperCase();
      case "length": return target.length;
      case "trim": return target.trim();
    }
  }
  if (Array.isArray(target)) {
    switch (name) {
      case "contains": return target.some((v) => looseEq(v, args[0]));
      case "length": return target.length;
      case "join": return target.map(String).join(String(args[0] ?? ", "));
    }
  }
  if (typeof target === "number") {
    switch (name) {
      case "abs": return Math.abs(target);
      case "round": return Math.round(target);
      case "floor": return Math.floor(target);
      case "ceil": return Math.ceil(target);
      case "toFixed": return target.toFixed(Number(args[0] ?? 0));
    }
  }
  throw new Error(`Method '${name}' not supported on ${typeof target}`);
}

function callGlobalFunction(name: string, args: unknown[]): unknown {
  switch (name) {
    case "if": return toBool(args[0]) ? args[1] : args[2];
    case "min": return Math.min(...args.map(Number));
    case "max": return Math.max(...args.map(Number));
    case "now":
    case "today": return new Date();
    case "number": return Number(args[0]);
  }
  throw new Error(`Unknown function: ${name}`);
}

// ── Render a table view ────────────────────────────────────────────────────

function renderTableView(view: ViewSpec, allRows: Row[], doc: BaseDoc, context: RenderContext): string {
  let rows = allRows;
  if (view.filters) {
    rows = rows.filter((row) => evalFilter(view.filters!, row));
  }

  const columns = view.order && view.order.length > 0 ? view.order : ["file.name"];
  const labels = columns.map((id) => columnLabel(id, doc));

  // Apply view-level sort (or default to alphabetical by title) before
  // materializing cells; sort needs raw values, not rendered HTML.
  rows = applySort(rows, view.sort);

  if (view.limit && view.limit > 0) rows = rows.slice(0, view.limit);

  const tbl = rows.map((row) => columns.map((id) => valueForColumn(id, row, context)));

  const header = labels.map((l, i) =>
    `<th data-col="${i}" tabindex="0">${esc(l)}</th>`
  ).join("");
  const body = tbl.map((cells, ri) => {
    const tds = cells.map((c) => `<td data-raw="${escAttr(toSortKey(c.raw))}">${c.html}</td>`).join("");
    return `<tr data-row="${ri}">${tds}</tr>`;
  }).join("");

  const caption = view.name ? `<div class="bases-caption">${esc(view.name)}</div>` : "";
  return `<div class="bases-block">
  ${caption}
  <div class="bases-toolbar">
    <input type="search" class="bases-filter" placeholder="Filter…" aria-label="Filter table">
    <span class="bases-count" data-total="${tbl.length}">${tbl.length} ${tbl.length === 1 ? "row" : "rows"}</span>
  </div>
  <div class="bases-scroll">
    <table class="bases-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</div>`;
}

// ── Cards view ─────────────────────────────────────────────────────────────

const COVER_IMG_RE = /!\[\[([^\[\]\n|#]+\.(?:png|jpe?g|webp|gif|svg|avif|tiff?))(?:\|[^\]]*)?\]\]/i;

function renderCardsView(view: ViewSpec, allRows: Row[], doc: BaseDoc, context: RenderContext): string {
  let rows = allRows;
  if (view.filters) rows = rows.filter((row) => evalFilter(view.filters!, row));

  rows = applySort(rows, view.sort);
  if (view.limit && view.limit > 0) rows = rows.slice(0, view.limit);

  // Up to 2 metadata fields shown under the title (skipping file.name).
  const metaCols = (view.order ?? []).filter((c) => c !== "file.name").slice(0, 2);

  const aspectStyle = view.imageAspectRatio ? `aspect-ratio: ${escAttr(view.imageAspectRatio)};` : "";
  const fit = view.imageFit === "contain" ? "contain" : "cover";

  const cards = rows.map((row) => {
    const href = "/" + row.page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
    const cover = findCoverImage(row, view.image, context);
    const coverHtml = cover
      ? `<div class="bases-card-cover" style="${aspectStyle}background-image: url('${escAttr(cover)}'); background-size: ${fit}; background-position: center;"></div>`
      : "";
    const metaHtml = metaCols
      .map((id) => renderValue(resolveIdentifier(id, row)))
      .filter(Boolean)
      .map((v) => `<div class="bases-card-meta">${v}</div>`)
      .join("");
    return `<a class="bases-card" href="${escAttr(href)}">
      ${coverHtml}
      <div class="bases-card-body">
        <div class="bases-card-title">${esc(row.page.title)}</div>
        ${metaHtml}
      </div>
    </a>`;
  }).join("");

  const caption = view.name ? `<div class="bases-caption">${esc(view.name)}</div>` : "";
  return `<div class="bases-block bases-cards-block">
  ${caption}
  <div class="bases-toolbar">
    <input type="search" class="bases-filter" placeholder="Filter…" aria-label="Filter cards">
    <span class="bases-count" data-total="${rows.length}">${rows.length} ${rows.length === 1 ? "card" : "cards"}</span>
  </div>
  <div class="bases-cards">${cards}</div>
</div>`;
}

// ── List view ──────────────────────────────────────────────────────────────

function renderListView(view: ViewSpec, allRows: Row[], doc: BaseDoc): string {
  let rows = allRows;
  if (view.filters) rows = rows.filter((row) => evalFilter(view.filters!, row));
  rows = applySort(rows, view.sort);
  if (view.limit && view.limit > 0) rows = rows.slice(0, view.limit);

  // Optional inline meta after the title (joined with bullets).
  const metaCols = (view.order ?? []).filter((c) => c !== "file.name");

  const items = rows.map((row) => {
    const href = "/" + row.page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
    const meta = metaCols
      .map((id) => renderValue(resolveIdentifier(id, row)))
      .filter(Boolean)
      .join(' <span class="bases-list-sep">·</span> ');
    const metaSpan = meta ? `<span class="bases-list-meta">${meta}</span>` : "";
    return `<li><a class="internal internal-link" href="${escAttr(href)}">${esc(row.page.title)}</a>${metaSpan}</li>`;
  }).join("");

  // Keep `doc` in the signature for symmetry with the other view renderers,
  // even though list rendering doesn't currently consult properties.
  void doc;

  const caption = view.name ? `<div class="bases-caption">${esc(view.name)}</div>` : "";
  return `<div class="bases-block bases-list-block">
  ${caption}
  <ul class="bases-list">${items}</ul>
</div>`;
}

// ── Sorting ────────────────────────────────────────────────────────────────

/**
 * Multi-key stable sort honoring `view.sort`. Each entry contributes one
 * comparison; later entries break ties from earlier ones. Direction
 * defaults to ASC. With no spec, sort alphabetically by page title so
 * output stays deterministic regardless of which view first ran.
 */
function applySort(rows: Row[], spec: ViewSpec["sort"]): Row[] {
  if (!spec || spec.length === 0) {
    return [...rows].sort((a, b) => compare(a.page.title, b.page.title));
  }
  return [...rows].sort((a, b) => {
    for (const s of spec) {
      const av = sortKeyFor(s.column, a);
      const bv = sortKeyFor(s.column, b);
      const c = compare(av, bv);
      if (c !== 0) return s.direction === "DESC" ? -c : c;
    }
    return 0;
  });
}

function sortKeyFor(id: string, row: Row): unknown {
  if (id === "file.name" || id === "file.basename") return row.page.title;
  return resolveIdentifier(id, row);
}

/**
 * Cover-image source for a card. Preference order:
 *   1. The view's `image:` setting names a frontmatter property → use that.
 *   2. Look for the first `![[image.ext]]` embed in the page body.
 * Returns the served (post-compression) URL, or null.
 */
function findCoverImage(row: Row, prop: string | undefined, context: RenderContext): string | null {
  let raw: string | null = null;
  if (prop) {
    const v = row.fm[prop];
    if (typeof v === "string" && v.length > 0) raw = v;
  }
  if (!raw) {
    // Look up the page's markdown source via context.markdownContent (keyed
    // by basename or path slug; we use path slug for uniqueness).
    const slug = slugifySimple(row.page.path.replace(/\.md$/i, ""));
    const source = context.markdownContent.get(slug);
    if (source) {
      const m = COVER_IMG_RE.exec(source);
      if (m && m[1]) raw = m[1];
    }
  }
  if (!raw) return null;

  // Strip a leading `![[` / trailing `]]` if the user set a wikilink-style
  // value (`cover: ![[portrait.webp]]`), then look up in the image index.
  raw = raw.replace(/^!\[\[/, "").replace(/\]\]$/, "").split("|")[0]!.trim();
  const image = context.images.get(slugifySimple(raw.split("/").pop() || raw));
  if (image) return "/" + image.outputPath.split("/").map(encodeURIComponent).join("/");
  // Already a URL or path: use as-is.
  return raw.startsWith("http") ? raw : "/" + raw.split("/").map(encodeURIComponent).join("/");
}

// Mirror the slugify in build.ts without taking a dependency on the renderer's
// slug.ts (which imports from a sibling module). Same algorithm.
function slugifySimple(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Cell { html: string; raw: unknown; }

function valueForColumn(id: string, row: Row, context: RenderContext): Cell {
  // file.name renders as a link to the page.
  if (id === "file.name" || id === "file.basename") {
    const title = row.page.title;
    const href = "/" + row.page.path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/");
    return { html: `<a class="internal internal-link" href="${escAttr(href)}">${esc(title)}</a>`, raw: title };
  }
  const v = resolveIdentifier(id, row);
  return { html: renderValue(v), raw: v };
}

function renderValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => renderValue(x)).filter(Boolean).join(", ");
  if (v instanceof Date) return esc(v.toISOString().slice(0, 10));
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "string") {
    // Render `[[wikilinks]]` in property values as plain styled text — full
    // wikilink resolution happens later in the wikilink plugin, which only
    // sees text nodes; the bases plugin emits HTML.
    return esc(v);
  }
  return esc(String(v));
}

function toSortKey(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return String(v.getTime());
  if (Array.isArray(v)) return v.map(String).join(",");
  return String(v);
}

function columnLabel(id: string, doc: BaseDoc): string {
  const explicit = doc.properties?.[id]?.displayName;
  if (explicit) return explicit;
  if (id.startsWith("note.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  if (id.startsWith("file.")) {
    const tail = id.slice(5);
    return tail.charAt(0).toUpperCase() + tail.slice(1);
  }
  return id;
}

function errorBlock(message: string): string {
  return `<div class="bases-block bases-error">${esc(message)}</div>`;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
function escAttr(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
