import React from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { pageItems } from "@/lib/pagination";

// shadcn's pagination for the pet list. Every item is a real link (`hrefFor`), so it can be opened
// in a new tab or copied; a plain click is intercepted and changes the page in place instead.
// Renders nothing when there is only one page. No "use client": it has no hooks of its own and is
// only rendered by FilterBar (a client component), so its function props never cross from a server.
export default function PetPagination({
  page,
  totalPages,
  hrefFor,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const go = (target: number) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Leave Ctrl/Cmd/Shift/Alt and middle clicks to the browser (new tab, new window, download).
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onPageChange(target);
  };

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  // A page number past the end (an old link) steps back onto the last real page.
  const previous = Math.min(page - 1, totalPages);
  const next = page + 1;
  // No href, so a disabled end is not a link, is not focusable, and is announced as disabled.
  const disabled = {
    "aria-disabled": true,
    tabIndex: -1,
    className: "pointer-events-none opacity-50",
  } as const;

  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          {hasPrevious ? (
            <PaginationPrevious href={hrefFor(previous)} onClick={go(previous)} />
          ) : (
            <PaginationPrevious {...disabled} />
          )}
        </PaginationItem>

        {pageItems(page, totalPages).map((item, index) =>
          item === null ? (
            <PaginationItem key={`gap-${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={item}>
              <PaginationLink
                href={hrefFor(item)}
                isActive={item === page}
                onClick={go(item)}
              >
                {item}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          {hasNext ? (
            <PaginationNext href={hrefFor(next)} onClick={go(next)} />
          ) : (
            <PaginationNext {...disabled} />
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
