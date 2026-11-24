"use client";

import React from "react";
import { Controller } from "react-hook-form";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { FiBold, FiItalic, FiLink, FiList, FiUnderline } from "react-icons/fi";
import type { IconType } from "react-icons";

import { Button } from "@pet-adopt/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pet-adopt/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import {
  HEALTH_NOTES_MAX_CHARS,
  HREF_HELP,
  isAllowedHref,
  isRichTextEmpty,
  richTextLength,
  type RichTextDoc,
} from "@/lib/rich-text";
import { cn } from "@/lib/utils";

import { fieldId, type FormControl } from "./fields";
import { richTextExtensions } from "./rich-text-extensions";

// A rich-text field for the health notes: bold, italic, underline, bulleted and numbered lists, and
// links to a page on this site or another website. Nothing else (see src/lib/rich-text.ts).
//
// Accessibility (WCAG 2.2 AA):
//  - the editing area is a labelled, multi-line textbox, described by its hint, character count and
//    error, and marked invalid when it has an error (1.3.1, 3.3.1, 3.3.2, 4.1.2);
//  - the toolbar follows the ARIA toolbar pattern: one tab stop, arrow keys, Home and End move
//    between buttons; toggles use aria-pressed, so the state is not only a colour (1.4.1, 2.1.1);
//  - the shortcuts (Ctrl or Cmd + B, I, U, Z) work, and the toolbar is not the only way in (2.1.1);
//  - the character count is text, and a document that is too long says so in words (1.4.1, 3.3.1);
//  - the link dialog traps focus, closes with Escape, and returns focus to the editor (2.4.3).

type Marks = { bold: boolean; italic: boolean; underline: boolean; bulletList: boolean; orderedList: boolean; link: boolean };

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

/** What the form keeps: the document, or null when there is nothing visible. */
function valueOf(editor: Editor): RichTextDoc | null {
  const doc = editor.getJSON() as RichTextDoc;
  return isRichTextEmpty(doc) ? null : doc;
}

export function RichTextField({
  control,
  name,
  label,
  description,
  maxChars = HEALTH_NOTES_MAX_CHARS,
}: {
  control: FormControl;
  name: "healthNotes" | "description";
  label: string;
  description?: string;
  maxChars?: number;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <RichTextEditorField
          name={name}
          label={label}
          description={description}
          maxChars={maxChars}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

function RichTextEditorField({
  name,
  label,
  description,
  maxChars,
  value,
  onChange,
  onBlur,
  error,
}: {
  name: string;
  label: string;
  description?: string;
  maxChars: number;
  value: RichTextDoc | null;
  onChange: (value: RichTextDoc | null) => void;
  onBlur: () => void;
  error?: string;
}) {
  const id = fieldId(name);
  const labelId = `${id}-label`;
  const describedBy = [
    description ? `${id}-description` : null,
    `${id}-count`,
    "pet-richtext-help",
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const attributes = {
    id,
    role: "textbox",
    "aria-multiline": "true",
    "aria-labelledby": labelId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? "true" : "false",
    class: "min-h-32 px-3 py-2 text-sm outline-none",
  };

  const editor = useEditor({
    extensions: richTextExtensions,
    content: value ?? undefined,
    // The editor draws in the browser only, so the first server render has no editor to mismatch.
    immediatelyRender: false,
    editorProps: { attributes },
    onUpdate: ({ editor: current }) => onChange(valueOf(current)),
    onBlur: () => onBlur(),
  });

  // The error and description can change after the editor exists: keep its attributes in step.
  React.useEffect(() => {
    editor?.setOptions({ editorProps: { attributes } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, describedBy, error]);

  // The form can replace the value from outside (after a save, or a reset): follow it.
  React.useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(value) !== JSON.stringify(valueOf(editor))) {
      editor.commands.setContent(value ?? "", { emitUpdate: false });
    }
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }): Marks & { length: number } => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      link: current?.isActive("link") ?? false,
      length: current ? richTextLength(current.getJSON() as RichTextDoc) : 0,
    }),
  });

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [focusIndex, setFocusIndex] = React.useState(0);
  const buttons = React.useRef<Array<HTMLButtonElement | null>>([]);

  const tooLong = (state?.length ?? 0) > maxChars;

  type Item = {
    key: string;
    label: string;
    shortcut?: string;
    icon: IconType | (() => React.ReactElement);
    pressed?: boolean;
    popup?: boolean;
    run: () => void;
  };
  const items: Item[] = editor
    ? [
        { key: "bold", label: "Bold", shortcut: "Ctrl+B", icon: FiBold, pressed: state?.bold, run: () => editor.chain().focus().toggleBold().run() },
        { key: "italic", label: "Italic", shortcut: "Ctrl+I", icon: FiItalic, pressed: state?.italic, run: () => editor.chain().focus().toggleItalic().run() },
        { key: "underline", label: "Underline", shortcut: "Ctrl+U", icon: FiUnderline, pressed: state?.underline, run: () => editor.chain().focus().toggleUnderline().run() },
        { key: "bullets", label: "Bulleted list", icon: FiList, pressed: state?.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
        { key: "numbers", label: "Numbered list", icon: OrderedListIcon, pressed: state?.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
        { key: "link", label: state?.link ? "Edit link" : "Add link", icon: FiLink, popup: true, run: () => setLinkOpen(true) },
      ]
    : [];

  function onToolbarKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = items.length - 1;
    let next = -1;
    if (event.key === "ArrowRight") next = focusIndex === last ? 0 : focusIndex + 1;
    else if (event.key === "ArrowLeft") next = focusIndex === 0 ? last : focusIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    setFocusIndex(next);
    buttons.current[next]?.focus();
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel
        id={labelId}
        // A label is not tied to a contenteditable by `for`, so a click on it focuses the editor.
        onClick={() => editor?.commands.focus()}
      >
        {label}
      </FieldLabel>
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      <p id="pet-richtext-help" className="sr-only">
        Formatting: bold, italic, underline, bulleted and numbered lists, and links. Use the toolbar above
        the text, or Control or Command with B, I or U.
      </p>

      <div
        className={cn(
          "rounded-lg border border-input bg-transparent transition-colors dark:bg-input/30",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring",
          error && "border-destructive ring-3 ring-destructive/20",
        )}
      >
        {editor ? (
          <div
            role="toolbar"
            aria-label={`${label} formatting`}
            aria-controls={id}
            onKeyDown={onToolbarKeyDown}
            className="flex flex-wrap gap-1 border-b p-1"
          >
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.key}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  ref={(element) => {
                    buttons.current[index] = element;
                  }}
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-label={item.label}
                  title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                  aria-pressed={item.pressed === undefined ? undefined : item.pressed}
                  aria-haspopup={item.popup ? "dialog" : undefined}
                  onFocus={() => setFocusIndex(index)}
                  onClick={item.run}
                  className={cn(item.pressed && "bg-accent text-accent-foreground ring-1 ring-foreground/30")}
                >
                  <Icon aria-hidden="true" />
                </Button>
              );
            })}
          </div>
        ) : (
          <div aria-hidden="true" className="h-10 border-b" />
        )}

        {editor ? (
          <EditorContent
            editor={editor}
            className={cn(
              "[&_.ProseMirror_p]:my-1 [&_.ProseMirror_ul]:my-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
              "[&_.ProseMirror_ol]:my-1 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
              "[&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2",
            )}
          />
        ) : (
          <div aria-hidden="true" className="min-h-32" />
        )}
      </div>

      <p
        id={`${id}-count`}
        className={cn("text-xs", tooLong ? "font-medium text-destructive" : "text-muted-foreground")}
      >
        {state?.length ?? 0} of {maxChars} characters{tooLong ? ". That is too many." : ""}
      </p>
      <FieldError id={`${id}-error`} errors={[error ? { message: error } : undefined]} />

      {editor ? <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} /> : null}
    </Field>
  );
}

// Add or edit a link. A link goes to a page on this site (/pets/mochi) or another website
// (https://...). With no text selected, the person also types the text the link shows.
function LinkDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Back to the text, not to the toolbar button that opened the dialog.
        finalFocus={() => editor.view.dom as HTMLElement}
      >
        <DialogHeader>
          <DialogTitle>Link</DialogTitle>
          <DialogDescription>{HREF_HELP}.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so it starts from what is selected each time. */}
        <LinkForm editor={editor} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  // With nothing selected and the cursor not in a link, there is no text to turn into a link yet.
  const needsText = editor.state.selection.empty && existing === "";

  const [href, setHref] = React.useState(existing);
  const [text, setText] = React.useState("");
  const [hrefError, setHrefError] = React.useState<string | null>(null);
  const [textError, setTextError] = React.useState<string | null>(null);

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    // This dialog is in a portal, but React events still bubble to the pet form around it:
    // without this, applying a link would also submit the pet.
    event.preventDefault();
    event.stopPropagation();

    const address = href.trim();
    const label = text.trim();
    const hrefProblem = isAllowedHref(address) ? null : `${HREF_HELP}.`;
    const textProblem = needsText && label === "" ? "Enter the text the link should show." : null;
    setHrefError(hrefProblem);
    setTextError(textProblem);
    if (hrefProblem || textProblem) return;

    if (needsText) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href: address } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: address }).run();
    }
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {needsText ? (
        <Field data-invalid={textError ? true : undefined}>
          <FieldLabel htmlFor="pet-link-text">
            Link text<span className="font-normal text-muted-foreground"> (required)</span>
          </FieldLabel>
          <Input
            id="pet-link-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoComplete="off"
            aria-required="true"
            aria-invalid={Boolean(textError)}
            aria-describedby={textError ? "pet-link-text-error" : undefined}
          />
          <FieldError id="pet-link-text-error" errors={[textError ? { message: textError } : undefined]} />
        </Field>
      ) : null}

      <Field data-invalid={hrefError ? true : undefined}>
        <FieldLabel htmlFor="pet-link-href">
          Link address<span className="font-normal text-muted-foreground"> (required)</span>
        </FieldLabel>
        <FieldDescription id="pet-link-href-description">
          For example /pets/mochi or https://example.com/vet
        </FieldDescription>
        <Input
          id="pet-link-href"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          autoComplete="off"
          inputMode="url"
          aria-required="true"
          aria-invalid={Boolean(hrefError)}
          aria-describedby={`pet-link-href-description${hrefError ? " pet-link-href-error" : ""}`}
        />
        <FieldError id="pet-link-href-error" errors={[hrefError ? { message: hrefError } : undefined]} />
      </Field>

      <DialogFooter>
        {existing ? (
          <Button type="button" variant="outline" onClick={remove}>
            Remove link
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Apply</Button>
      </DialogFooter>
    </form>
  );
}
