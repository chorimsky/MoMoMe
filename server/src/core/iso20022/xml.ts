/* ============================================================
   A small, strict XML reader and writer — enough for ISO 20022, and no more.

   WHY NOT A LIBRARY: this parses money instructions and bank statements, and an XML parser
   is a classic place to inherit someone else's entity-expansion or prototype-pollution
   bug. ISO 20022 documents are machine-generated, namespaced, well-formed and of a known
   shape, so the useful subset is small. What is here refuses rather than guesses: an
   unbalanced tag throws, a DOCTYPE throws, an entity it does not know throws. A parser that
   recovers from malformed input is the wrong shape for a file a bank sends us.

   Namespace PREFIXES are dropped on read (`<Doc xmlns=…>` and `<ns:Doc>` both read as
   "Doc") because the prefix a bank picks is arbitrary; the element path is the contract.
   ============================================================ */

export interface XNode {
  name: string;
  text: string;
  children: XNode[];
  /** Attributes, by local name. ISO 20022 carries the CURRENCY as an attribute
   *  (`<InstdAmt Ccy="XAF">50000.00</InstdAmt>`), so dropping attributes would mean
   *  inferring an amount's currency from its surroundings — the precise kind of guess that
   *  turns into a money error. */
  attrs: Record<string, string>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) throw new Error(`xml: bad character reference ${whole}`);
      return String.fromCodePoint(n);
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) throw new Error(`xml: bad character reference ${whole}`);
      return String.fromCodePoint(n);
    }
    const v = ENTITIES[body];
    // An unknown entity is refused, never passed through: a bank file is not a place to
    // silently carry something we did not understand into a payment instruction.
    if (v === undefined) throw new Error(`xml: unknown entity ${whole}`);
    return v;
  });
}

/* A bank statement arrives as a FILE, so unlike a request body it is not bounded by the
   32 kb JSON cap — its size and shape are the counterparty's, and a corrupt or hostile one
   must fail as a refusal rather than as a crash.

   A real camt.053 nests about ten deep. A hundred is already absurd, and ten thousand took
   the recursive descendant walk past V8's stack: a RangeError thrown from inside statement
   ingestion, which is a worse failure than a rejected file because of where it surfaces.
   Both limits refuse with a sentence naming the limit. */
const MAX_DEPTH = 100;
const MAX_ELEMENTS = 500_000;

/** Parse a document into a tree. Throws on anything it cannot read exactly. */
export function parseXml(src: string): XNode {
  if (/<!DOCTYPE/i.test(src)) throw new Error("xml: DOCTYPE is not accepted");
  let s = src.replace(/^﻿/, "").replace(/<\?xml[^>]*\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const root: XNode = { name: "#document", text: "", children: [], attrs: {} };
  const stack: XNode[] = [root];
  const tag = /<\s*(\/?)\s*([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)([^>]*?)(\/?)\s*>/g;
  let last = 0, elements = 0, m: RegExpExecArray | null;
  while ((m = tag.exec(s)) !== null) {
    const [whole, closing, qualified, attrSrc, selfClose] = m;
    const text = s.slice(last, m.index);
    last = m.index + whole.length;
    const top = stack[stack.length - 1];
    if (text.trim()) top.text += decode(text).trim();
    const name = qualified.includes(":") ? qualified.slice(qualified.indexOf(":") + 1) : qualified;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`xml: </${name}> does not close <${open?.name ?? "nothing"}>`);
      if (stack.length === 0) throw new Error("xml: unbalanced document");
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (attrSrc ?? "").matchAll(/([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)\s*=\s*"([^"]*)"/g)) {
      const key = a[1].includes(":") ? a[1].slice(a[1].indexOf(":") + 1) : a[1];
      if (key !== "xmlns") attrs[key] = decode(a[2]);
    }
    if (++elements > MAX_ELEMENTS) throw new Error(`xml: more than ${MAX_ELEMENTS} elements — refusing to parse`);
    const node: XNode = { name, text: "", children: [], attrs };
    top.children.push(node);
    if (!selfClose) {
      if (stack.length > MAX_DEPTH) throw new Error(`xml: nested deeper than ${MAX_DEPTH} elements — refusing to parse`);
      stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error(`xml: ${stack.length - 1} unclosed element(s), innermost <${stack[stack.length - 1].name}>`);
  if (!root.children.length) throw new Error("xml: no root element");
  return root.children[0];
}

/** First descendant at a slash-separated path, relative to `node`. */
export function at(node: XNode | undefined, path: string): XNode | undefined {
  let cur: XNode | undefined = node;
  for (const part of path.split("/")) {
    if (!cur) return undefined;
    cur = cur.children.find((c) => c.name === part);
  }
  return cur;
}
/** Text at a path, or "" — never undefined, so callers do not litter with ?? "". */
export const text = (node: XNode | undefined, path: string): string => at(node, path)?.text ?? "";
/** An attribute at a path, or "". */
export const attr = (node: XNode | undefined, path: string, name: string): string => (path ? at(node, path) : node)?.attrs[name] ?? "";

/** Every direct child with this name. */
export const all = (node: XNode | undefined, name: string): XNode[] => node?.children.filter((c) => c.name === name) ?? [];
/** Every descendant with this name, at any depth. Banks nest differently; some fields are
 *  legitimately reachable by more than one path across versions of the same message. */
export function deep(node: XNode | undefined, name: string): XNode[] {
  if (!node) return [];
  const out: XNode[] = [];
  // ITERATIVE. The recursive version blew V8's stack on a document nested ten thousand
  // deep — a RangeError raised from inside statement ingestion rather than a refused file.
  // parseXml now caps depth, so this is belt and braces: a tree built some other way (a
  // test double, a future reader) must not be able to crash a traversal either.
  const stack: XNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = n.children[i];
      if (c.name === name) out.push(c);
      stack.push(c);
    }
  }
  return out.reverse();
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

/** Build an element. `children` may be a string (text) or nested elements. */
export function el(name: string, children: string | Array<string | false | null | undefined>): string {
  if (typeof children === "string") return `<${name}>${esc(children)}</${name}>`;
  const inner = children.filter((c): c is string => typeof c === "string" && c.length > 0).join("");
  return `<${name}>${inner}</${name}>`;
}
