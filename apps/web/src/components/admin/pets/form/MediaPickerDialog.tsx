import React from "react";
import Image from "next/image";
import useSWR, { useSWRConfig } from "swr";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";
import { Checkbox } from "@pet-adopt/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pet-adopt/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@pet-adopt/ui/components/field";
import { Input } from "@pet-adopt/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pet-adopt/ui/components/tabs";
import { unwrapResult } from "@/lib/admin/unwrap-client";
import type { PetFormMedia } from "@/lib/zod-schema/pet";
import { listMediaAction, uploadMediaAction } from "@/server/actions/media";
import type { MediaItem } from "@/server/types";

const PAGE_SIZE = 12;
/** First entry of the SWR keys of the library, so an upload can refresh every cached page. */
const MEDIA_KEY = "media";

const toRef = (media: MediaItem): PetFormMedia => ({
  id: media.id,
  thumbnailUrl: media.thumbnailUrl,
  alt: media.alt,
});

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Pick images from the media library, or upload a new one. A real dialog (focus is trapped, Escape
// closes it, focus returns to the button that opened it), and every image is a checkbox, so it works
// with a keyboard and a screen reader: no drag and drop, no clickable pictures without a name.
export function MediaPickerDialog({
  open,
  onOpenChange,
  title,
  max,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** How many images can be chosen. 1 makes it a single choice. */
  max: number;
  onPick: (items: PetFormMedia[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose from the images you already uploaded, or upload a new one. Every image needs a
            description for people who cannot see it.
          </DialogDescription>
        </DialogHeader>
        {/* The body keeps its own state and is only mounted while the dialog is open, so it starts fresh each time. */}
        <PickerBody
          max={max}
          onCancel={() => onOpenChange(false)}
          onPick={(items) => {
            onPick(items);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  max,
  onPick,
  onCancel,
}: {
  max: number;
  onPick: (items: PetFormMedia[]) => void;
  onCancel: () => void;
}) {
  const { mutate } = useSWRConfig();
  const single = max === 1;

  const [tab, setTab] = React.useState("library");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<PetFormMedia[]>([]);
  const [message, setMessage] = React.useState("");

  const [alt, setAlt] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadErrors, setUploadErrors] = React.useState<{ file?: string; alt?: string; general?: string }>({});
  const fileRef = React.useRef<HTMLInputElement>(null);

  const query = useDebounced(search.trim(), 300);
  const { data, error, isLoading } = useSWR([MEDIA_KEY, query, page] as const, async ([, term, pageNumber]) =>
    unwrapResult(await listMediaAction({ search: term, page: pageNumber, limit: PAGE_SIZE })),
  );

  const isSelected = (id: number) => selected.some((item) => item.id === id);
  const atMax = !single && selected.length >= max;

  /** Adds an image to the choice. A single choice is replaced; a full list refuses another. */
  function choose(item: MediaItem): boolean {
    const ref = toRef(item);
    if (single) {
      setSelected([ref]);
      return true;
    }
    if (isSelected(ref.id) || selected.length >= max) return isSelected(ref.id);
    setSelected((current) => [...current, ref]);
    return true;
  }

  function toggle(item: MediaItem) {
    if (isSelected(item.id)) setSelected((current) => current.filter((chosen) => chosen.id !== item.id));
    else choose(item);
  }

  async function upload(event: React.SyntheticEvent<HTMLFormElement>) {
    // This dialog is in a portal, but React events still bubble to the pet form around it:
    // without this, uploading an image would also submit the pet.
    event.preventDefault();
    event.stopPropagation();

    const body = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) body.set("file", file);
    body.set("alt", alt);

    setUploading(true);
    setUploadErrors({});
    const result = await uploadMediaAction(body);
    setUploading(false);

    if (!result.ok) {
      setUploadErrors({
        file: result.fieldErrors?.file,
        alt: result.fieldErrors?.alt,
        general: result.fieldErrors ? undefined : result.error,
      });
      return;
    }

    await mutate((key) => Array.isArray(key) && key[0] === MEDIA_KEY);
    const chosen = choose(result.data);
    setMessage(
      chosen
        ? `Uploaded “${result.data.alt}” and selected it.`
        : `Uploaded “${result.data.alt}”. You already chose the most you can add, so it is not selected.`,
    );
    setAlt("");
    if (fileRef.current) fileRef.current.value = "";
    setSearch("");
    setPage(1);
    setTab("library");
  }

  const count = selected.length;

  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="library">Choose from library</TabsTrigger>
          <TabsTrigger value="upload">Upload new</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="flex flex-col gap-4 pt-2">
          <Field>
            <FieldLabel htmlFor="media-search">Search images by description</FieldLabel>
            <Input
              id="media-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load the images: {error.message}
            </p>
          ) : null}

          {isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading images…
            </p>
          ) : data && data.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? "No images match that search." : "There are no images yet. Use the Upload new tab to add one."}
            </p>
          ) : data ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {data.docs.map((item) => {
                const id = `media-${item.id}`;
                return (
                  <li key={item.id}>
                    <label
                      htmlFor={id}
                      className="flex h-full cursor-pointer flex-col gap-2 rounded-lg border p-2 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring has-[[aria-checked=true]]:border-primary"
                    >
                      {/* Decorative: the description under it says what the picture shows. */}
                      <Image
                        src={item.thumbnailUrl}
                        alt=""
                        width={240}
                        height={180}
                        className="aspect-4/3 w-full rounded object-cover"
                      />
                      <span className="flex items-start gap-2">
                        <Checkbox
                          id={id}
                          checked={isSelected(item.id)}
                          disabled={!isSelected(item.id) && atMax}
                          onCheckedChange={() => toggle(item)}
                          aria-labelledby={`${id}-text`}
                        />
                        <span id={`${id}-text`} className="line-clamp-2 text-xs">
                          {item.alt}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {data && data.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                <FiChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm" aria-live="polite">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <FiChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="upload" className="pt-2">
          <form onSubmit={upload} noValidate className="flex flex-col gap-4">
            {uploadErrors.general ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadErrors.general}
              </p>
            ) : null}
            <FieldGroup>
              <Field data-invalid={uploadErrors.file ? true : undefined}>
                <FieldLabel htmlFor="media-upload-file">
                  Image file<span className="font-normal text-muted-foreground"> (required)</span>
                </FieldLabel>
                <FieldDescription id="media-upload-file-description">
                  JPEG, PNG, WebP or GIF, up to 10 MB.
                </FieldDescription>
                <Input
                  id="media-upload-file"
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  aria-required="true"
                  aria-invalid={Boolean(uploadErrors.file)}
                  aria-describedby={`media-upload-file-description${uploadErrors.file ? " media-upload-file-error" : ""}`}
                />
                <FieldError id="media-upload-file-error" errors={[{ message: uploadErrors.file }]} />
              </Field>
              <Field data-invalid={uploadErrors.alt ? true : undefined}>
                <FieldLabel htmlFor="media-upload-alt">
                  Description of the image<span className="font-normal text-muted-foreground"> (required)</span>
                </FieldLabel>
                <FieldDescription id="media-upload-alt-description">
                  Read aloud to people who cannot see the picture, for example “Orange kitten asleep on a blue blanket”.
                </FieldDescription>
                <Input
                  id="media-upload-alt"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={Boolean(uploadErrors.alt)}
                  aria-describedby={`media-upload-alt-description${uploadErrors.alt ? " media-upload-alt-error" : ""}`}
                />
                <FieldError id="media-upload-alt-error" errors={[{ message: uploadErrors.alt }]} />
              </Field>
            </FieldGroup>
            <div>
              <Button type="submit" disabled={uploading}>
                {uploading ? "Uploading…" : "Upload image"}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      <p role="status" className="sr-only">
        {message}
      </p>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {count} selected{single ? "" : `, ${max - count} more can be added`}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={count === 0} onClick={() => onPick(selected)}>
          {single ? "Use this image" : `Add ${count} photo${count === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </>
  );
}
