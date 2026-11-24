"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import {
  FiArchive,
  FiArrowDown,
  FiArrowUp,
  FiChevronRight,
  FiEdit2,
  FiLayout,
  FiExternalLink,
  FiRotateCcw,
  FiTrash2,
} from "react-icons/fi";
import {
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  archivePageAction,
  deletePageAction,
  restorePageAction,
} from "@/server/actions/pages";
import type { PageListItem } from "@/server/pages";

import { PageDetails } from "./PageDetails";

// The admin list of builder pages (TanStack Table v9). A row opens to show a preview and the
// page's saved versions. Lifecycle: a page is archived first (off the site, read-only), then it
// can be restored or deleted for good; the server enforces the same rule.

export const pagePath = (slug: string) => (slug === "home" ? "/" : `/${slug}`);

// Module scope: Table v9 needs stable features and columns.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
});

const helper = createColumnHelper<typeof features, PageListItem>();

/** Status order for sorting: live first, archived last. */
const STATE_ORDER = { published: 0, draft: 1, archived: 2 } as const;
const STATE_LABEL = { published: "Published", draft: "Draft", archived: "Archived" } as const;

type Announce = (message: string, isError?: boolean) => void;
const AnnounceContext = React.createContext<Announce>(() => {});
/** Moves focus to the action message, for when the focused row disappears (a delete). */
const FocusMessageContext = React.createContext<() => void>(() => {});

/** DOM ids of row buttons, so focus can move to the right one after the row changes. */
const actionId = (pageId: number, action: "edit" | "archive" | "restore") => `page-${pageId}-${action}`;

const columns = helper.columns([
  helper.display({
    id: "expand",
    header: () => <span className="sr-only">Preview</span>,
    cell: ({ row }) => {
      const open = row.getIsExpanded();
      return (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={open}
          aria-controls={`page-details-${row.original.id}`}
          onClick={() => row.toggleExpanded()}
        >
          <FiChevronRight
            aria-hidden
            className={cn("transition-transform", open && "rotate-90")}
          />
          <span className="sr-only">
            {open ? "Hide" : "Show"} preview and versions of {row.original.title}
          </span>
        </Button>
      );
    },
  }),
  helper.accessor("id", {
    header: "ID",
    sortFn: "basic",
    cell: (info) => <span className="tabular-nums">{info.getValue()}</span>,
  }),
  helper.accessor("title", {
    header: "Page title",
    sortFn: "alphanumeric",
    cell: ({ row }) =>
      row.original.state === "archived" ? (
        <span className="font-medium">{row.original.title}</span>
      ) : (
        <Link href={`/admin/pages/${row.original.id}`} className="font-medium hover:underline">
          {row.original.title}
        </Link>
      ),
  }),
  helper.accessor("slug", {
    header: "Path",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <code className="text-sm">{pagePath(row.original.slug)}</code>
        {row.original.slug === "home" ? (
          <span className="text-xs text-muted-foreground">Homepage</span>
        ) : null}
      </span>
    ),
  }),
  helper.display({
    id: "live",
    header: "Live page",
    cell: ({ row }) =>
      row.original.state === "published" ? (
        <a
          href={pagePath(row.original.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          View
          <FiExternalLink aria-hidden />
          <span className="sr-only">{row.original.title} (opens in a new tab)</span>
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">Not live</span>
      ),
  }),
  helper.accessor("state", {
    header: "Status",
    sortFn: (a, b) => STATE_ORDER[a.original.state] - STATE_ORDER[b.original.state],
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge status={row.original.state} label={STATE_LABEL[row.original.state]} />
        {row.original.hasUnpublishedChanges && row.original.state !== "archived" ? (
          <span className="text-xs text-muted-foreground">Unpublished changes</span>
        ) : null}
      </span>
    ),
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowActions page={row.original} />,
  }),
]);

const SORTABLE = new Set(["id", "title", "slug", "state"]);

export function PagesTable({ pages, darkMode = false }: { pages: PageListItem[]; darkMode?: boolean }) {
  // `id` changes with every message, so the same text twice is announced twice.
  const [message, setMessage] = React.useState<{ text: string; isError: boolean; id: number } | null>(null);
  const announce = React.useCallback<Announce>(
    (text, isError = false) => setMessage((previous) => ({ text, isError, id: (previous?.id ?? 0) + 1 })),
    [],
  );
  const messageRef = React.useRef<HTMLDivElement>(null);
  const focusMessage = React.useCallback(() => {
    requestAnimationFrame(() => messageRef.current?.focus());
  }, []);

  const table = useTable({
    features,
    columns,
    data: pages,
    getRowId: (page) => String(page.id),
    getRowCanExpand: () => true,
    initialState: { sorting: [{ id: "id", desc: false }] },
  });

  const columnCount = table.getAllLeafColumns().length;

  return (
    <AnnounceContext.Provider value={announce}>
    <FocusMessageContext.Provider value={focusMessage}>
      {/* Results of row actions. Polite for success, assertive (alert) for failures. Focusable
          (tabIndex -1) so focus has somewhere to go when the focused row is deleted. */}
      <div ref={messageRef} tabIndex={-1} aria-live="polite" className="min-h-6 text-sm outline-none">
        {message && !message.isError ? <p key={message.id}>{message.text}</p> : null}
      </div>
      {message?.isError ? (
        <p key={message.id} role="alert" className="mb-2 text-sm text-destructive">
          {message.text}
        </p>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <caption className="sr-only">
            Pages. Sort by ID, title, path or status with the column buttons; open a row to see its preview and versions.
          </caption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sortable = SORTABLE.has(header.column.id);
                  const sorted = sortable ? header.column.getIsSorted() : false;
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                      }
                      className={cn(header.column.id === "expand" && "w-10", header.column.id === "id" && "w-16")}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1 font-medium"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <FiArrowUp aria-hidden />
                          ) : sorted === "desc" ? (
                            <FiArrowDown aria-hidden />
                          ) : null}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <React.Fragment key={row.id}>
                <TableRow>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() ? (
                  <TableRow id={`page-details-${row.original.id}`} className="hover:bg-transparent">
                    {/* No tinted background: muted text on the tint fell below 4.5:1 contrast. */}
                    <TableCell colSpan={columnCount} className="border-l-4 border-l-primary p-4 whitespace-normal">
                      <PageDetails page={row.original} onMessage={announce} darkMode={darkMode} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </FocusMessageContext.Provider>
    </AnnounceContext.Provider>
  );
}

/** Edit and Archive for a page in use; Restore and Delete once it is archived. */
function RowActions({ page }: { page: PageListItem }) {
  const router = useRouter();
  const announce = React.useContext(AnnounceContext);
  const focusMessage = React.useContext(FocusMessageContext);
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // The button that should take focus once the row shows its new state: archiving swaps Archive
  // for Restore (and back), so the focused button disappears (WCAG 2.4.3).
  const focusNext = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.getElementById(id)?.focus();
  }, [page.state]);

  const act = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        announce(done);
        after?.();
        router.refresh();
      } else {
        announce(result.error, true);
      }
    });

  if (page.state === "archived") {
    return (
      <span className="flex items-center justify-end gap-2">
        {/* Shown but off while archived, so every row has the same buttons. aria-disabled (not
            disabled) keeps them reachable, so keyboard and screen reader users hear why. */}
        <Button variant="outline" size="sm" aria-disabled className="cursor-not-allowed opacity-50">
          <FiEdit2 aria-hidden />
          Edit
          <span className="sr-only">
            the settings of {page.title}: unavailable while archived, restore the page first
          </span>
        </Button>
        <Button variant="outline" size="sm" aria-disabled className="cursor-not-allowed opacity-50">
          <FiLayout aria-hidden />
          Page builder
          <span className="sr-only">
            for {page.title}: unavailable while archived, restore the page first
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          id={actionId(page.id, "restore")}
          aria-disabled={pending}
          onClick={() =>
            !pending &&
            act(() => restorePageAction(page.id), `“${page.title}” restored.`, () => {
              focusNext.current = actionId(page.id, page.slug === "home" ? "edit" : "archive");
            })
          }
        >
          <FiRotateCcw aria-hidden />
          Restore
          <span className="sr-only">{page.title}</span>
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          {/* The dialog's own trigger, so closing it ("Keep it", Escape) returns focus here. */}
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" aria-disabled={pending} />}>
            <FiTrash2 aria-hidden />
            Delete
            <span className="sr-only">{page.title}</span>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{page.title}” for good?</AlertDialogTitle>
              <AlertDialogDescription>
                The page and all {page.latestVersion > 0 ? "of its saved versions" : "its content"} are removed. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <Button
                variant="destructive"
                aria-disabled={pending}
                onClick={() =>
                  !pending &&
                  act(() => deletePageAction(page.id), `“${page.title}” deleted.`, () => {
                    setConfirmOpen(false);
                    // The row is gone: focus the message that says so.
                    focusMessage();
                  })
                }
              >
                {pending ? "Deleting…" : "Delete page"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-2">
      {/* Links that look like buttons stay real links (see AuthNav). Edit opens the page's settings;
          Page builder goes straight to the layout. */}
      <Link
        id={actionId(page.id, "edit")}
        href={`/admin/pages/${page.id}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <FiEdit2 aria-hidden />
        Edit
        <span className="sr-only">the settings of {page.title}</span>
      </Link>
      <Link href={`/edit/${page.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <FiLayout aria-hidden />
        Page builder
        <span className="sr-only">for {page.title}</span>
      </Link>
      {/* The homepage is never archived: the site always needs one (unpublish it instead). */}
      {page.slug === "home" ? null : (
      <Button
        id={actionId(page.id, "archive")}
        variant="outline"
        size="sm"
        aria-disabled={pending}
        onClick={() =>
          !pending &&
          act(
            () => archivePageAction(page.id),
            `“${page.title}” archived. It is off the site; restore or delete it from this list.`,
            () => {
              focusNext.current = actionId(page.id, "restore");
            },
          )
        }
      >
        <FiArchive aria-hidden />
        {pending ? "Archiving…" : "Archive"}
        <span className="sr-only">{page.title}</span>
      </Button>
      )}
    </span>
  );
}
