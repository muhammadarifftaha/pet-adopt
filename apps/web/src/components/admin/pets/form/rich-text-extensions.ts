import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Underline from "@tiptap/extension-underline";
import { UndoRedo } from "@tiptap/extensions";

import { isAllowedHref } from "@/lib/rich-text";

// The health notes editor's extensions: exactly what src/lib/rich-text.ts accepts, and nothing else.
// The individual extensions are imported on purpose, not the StarterKit, so headings, code, quotes,
// images and the rest cannot be produced at all. scripts/check-backend.ts checks that this list and
// the server's validator agree. No React or browser code in here, so Node can import it too.

const SiteLink = Link.extend({
  // Store only the address. Tiptap's own link also saves target, rel and class, which the document
  // format does not have (the page decides how a link opens).
  addAttributes() {
    return { href: { default: null } };
  },
}).configure({
  // A click in the editor puts the cursor in the link; it does not leave the page.
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  // The same rule as the server: a page on this site, or an http(s) link. Not javascript:, not //host.
  isAllowedUri: (url) => isAllowedHref(url),
});

export const richTextExtensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  SiteLink,
  BulletList,
  OrderedList,
  ListItem,
  UndoRedo,
];
