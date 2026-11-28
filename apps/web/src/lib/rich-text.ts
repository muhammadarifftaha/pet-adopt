// Rich text for pet fields (description, health and personality notes) and timeline entries,
// stored as a JSON document (the shape Tiptap/ProseMirror produce) and rendered as React
// elements, never as HTML. Only a small, fixed set is allowed:
//   paragraphs, bulleted and numbered lists, and the marks bold, italic, underline and link.
// This file is pure (no React, no editor library), so the server, the form's zod schema, and the
// tests all use the same rules. `validateRichText` does not just check: it BUILDS a new document
// from the allowed parts, so nothing else (unknown nodes, marks or attributes) can get through.
// The editor (components/admin/pets/form/RichTextField.tsx) offers exactly this set; a test keeps
// the two in step (scripts/check-backend.ts).

/** Visible characters allowed in the health notes (line breaks do not count). */
export const HEALTH_NOTES_MAX_CHARS = 2000;
/** Visible characters allowed in the pet's description. */
export const DESCRIPTION_MAX_CHARS = 5000;

export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } };

export type RichTextText = { type: "text"; text: string; marks?: RichTextMark[] };
export type RichTextParagraph = { type: "paragraph"; content?: RichTextText[] };
export type RichTextListItem = {
  type: "listItem";
  /** A paragraph first, then more paragraphs or a nested list. */
  content: Array<RichTextParagraph | RichTextList>;
};
export type RichTextList = { type: "bulletList" | "orderedList"; content: RichTextListItem[] };
export type RichTextBlock = RichTextParagraph | RichTextList;
export type RichTextDoc = { type: "doc"; content: RichTextBlock[] };

export type RichTextResult =
  | { ok: true; doc: RichTextDoc; text: string }
  | { ok: false; error: string };

// ---- Links -------------------------------------------------------------------------------------

export const HREF_HELP =
  "Use a page on this site such as /pets/mochi, or a full link starting with https://";

const MAX_HREF_LENGTH = 2000;

/**
 * A link may point to a page on this site (`/pets/mochi`, `/about#faq`) or to another website
 * (`https://...` or `http://...`). Nothing else: no `javascript:`, `data:`, `mailto:`, `tel:`,
 * protocol-relative `//host` (that is another site written like a path), no spaces or control
 * characters, no backslashes (browsers read `/\host` as `//host`), and no `user:password@` in a link.
 */
export function isAllowedHref(href: string): boolean {
  if (href.length === 0 || href.length > MAX_HREF_LENGTH) return false;
  if (/[\s\u0000-\u001F\u007F\\]/.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const url = new URL(href);
    return url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** A link to another website, as opposed to a page on this site. Shown and rendered differently. */
export const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

// ---- Validation --------------------------------------------------------------------------------

const MAX_DEPTH = 6; // lists inside lists
const MAX_NODES = 500;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

class RichTextError extends Error {}

const fail = (message: string): never => {
  throw new RichTextError(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Counter = { nodes: number };

function count(counter: Counter) {
  if (++counter.nodes > MAX_NODES) fail(`The notes are too complex (more than ${MAX_NODES} parts).`);
}

function readMark(mark: unknown): RichTextMark {
  if (!isRecord(mark)) return fail("The notes contain something that is not a formatting mark.");
  switch (mark.type) {
    case "bold":
    case "italic":
    case "underline":
      return { type: mark.type };
    case "link": {
      const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
      if (typeof href !== "string" || !isAllowedHref(href)) return fail(`A link is not allowed. ${HREF_HELP}.`);
      return { type: "link", attrs: { href } };
    }
    default:
      return fail(`The formatting "${String(mark.type).slice(0, 30)}" is not allowed in the notes.`);
  }
}

function readText(node: unknown, counter: Counter): RichTextText | null {
  count(counter);
  if (!isRecord(node) || node.type !== "text" || typeof node.text !== "string") {
    return fail("Only text is allowed inside a paragraph.");
  }
  const text = node.text.replace(CONTROL_CHARS, "");
  if (text === "") return null;

  if (node.marks === undefined || node.marks === null) return { type: "text", text };
  if (!Array.isArray(node.marks)) return fail("The notes contain formatting that is not a list.");
  const marks: RichTextMark[] = [];
  for (const raw of node.marks) {
    const mark = readMark(raw);
    if (!marks.some((existing) => existing.type === mark.type)) marks.push(mark);
  }
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function readParagraph(node: Record<string, unknown>, counter: Counter): RichTextParagraph {
  const raw = node.content ?? [];
  if (!Array.isArray(raw)) return fail("A paragraph's content must be a list.");
  const content = raw.map((child) => readText(child, counter)).filter((t): t is RichTextText => t !== null);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function readBlock(node: unknown, depth: number, counter: Counter): RichTextParagraph | RichTextList {
  count(counter);
  if (depth > MAX_DEPTH) return fail("The lists are nested too deeply.");
  if (!isRecord(node)) return fail("The notes contain something that is not a paragraph or a list.");

  if (node.type === "paragraph") return readParagraph(node, counter);

  if (node.type === "bulletList" || node.type === "orderedList") {
    if (!Array.isArray(node.content) || node.content.length === 0) return fail("A list needs at least one item.");
    const content = node.content.map((item): RichTextListItem => {
      count(counter);
      if (!isRecord(item) || item.type !== "listItem" || !Array.isArray(item.content) || item.content.length === 0) {
        return fail("A list can only contain items.");
      }
      const [first, ...rest] = item.content;
      if (!isRecord(first) || first.type !== "paragraph") return fail("A list item must start with text.");
      count(counter);
      return {
        type: "listItem",
        content: [readParagraph(first, counter), ...rest.map((block) => readBlock(block, depth + 1, counter))],
      };
    });
    return { type: node.type, content };
  }

  return fail(`"${String(node.type).slice(0, 30)}" is not allowed in the notes.`);
}

function blockLines(block: RichTextBlock): string[] {
  if (block.type === "paragraph") return [(block.content ?? []).map((t) => t.text).join("")];
  return block.content.flatMap((item) => item.content.flatMap(blockLines));
}

/** The notes as plain text, one line per paragraph or list item. */
export function richTextToPlain(doc: RichTextDoc): string {
  return doc.content.flatMap(blockLines).join("\n");
}

/** How many visible characters there are (line breaks are not counted). */
export const richTextLength = (doc: RichTextDoc) => richTextToPlain(doc).replace(/\n/g, "").length;

/** True when there is nothing visible to show. */
export const isRichTextEmpty = (doc: RichTextDoc | null | undefined) =>
  !doc || richTextToPlain(doc).trim() === "";

/**
 * Checks `value` and returns a clean copy of it. Anything outside the allowed paragraphs, lists,
 * marks and links is an error; control characters are removed from text; the length (visible
 * characters) is capped. The returned `doc` is a new object containing only allowed parts.
 */
export function validateRichText(
  value: unknown,
  opts: { maxChars?: number } = {},
): RichTextResult {
  const maxChars = opts.maxChars ?? HEALTH_NOTES_MAX_CHARS;
  try {
    if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content)) {
      return { ok: false, error: "The notes are not a valid document." };
    }
    const counter: Counter = { nodes: 0 };
    const doc: RichTextDoc = {
      type: "doc",
      content: value.content.map((block) => readBlock(block, 1, counter)),
    };
    const length = richTextLength(doc);
    if (length > maxChars) {
      return { ok: false, error: `The notes must be at most ${maxChars} characters (they are ${length}).` };
    }
    return { ok: true, doc, text: richTextToPlain(doc) };
  } catch (error) {
    if (error instanceof RichTextError) return { ok: false, error: error.message };
    throw error;
  }
}

// ---- Plain text <-> document -------------------------------------------------------------------

/** Old notes were plain text. One paragraph per non-empty line. Null when there is nothing. */
export function plainTextToDoc(text: string): RichTextDoc | null {
  const content: RichTextParagraph[] = text
    .replace(CONTROL_CHARS, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
  return content.length > 0 ? { type: "doc", content } : null;
}
