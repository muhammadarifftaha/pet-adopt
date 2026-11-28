"use client";

import { useRouter } from "next/navigation";
import React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pet-adopt/ui/components/alert-dialog";
import { Button } from "@pet-adopt/ui/components/button";

/**
 * Warns before leaving a form with unsaved changes.
 *
 *  - Links inside the site (the admin menu, "Back to ...", anything else in the page) open a
 *    "Leave without saving?" dialog. Caught in the capture phase, before Next's <Link> handles it.
 *  - Reloading, closing the tab, typing an address or following a link to another site show the
 *    browser's own "Leave site?" prompt (its text cannot be changed).
 *  - The browser's Back button inside the admin is client-side navigation, which a page cannot
 *    intercept reliably, so it is not covered.
 *
 * Render `dialog` somewhere in the form. Call `allowNavigation()` just before navigating on purpose
 * (after a successful save) so that navigation is not stopped.
 */
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  const bypass = React.useRef(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (bypass.current || event.defaultPrevented || event.button !== 0) return;
      // A modified click opens a new tab or window: this page stays, so nothing is lost.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      // Another site: a full page load, which the browser's own prompt covers.
      if (url.origin !== window.location.origin) return;
      // A link to this same page (e.g. the error summary's #field links) does not leave.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const allowNavigation = React.useCallback(() => {
    bypass.current = true;
  }, []);

  const leave = () => {
    if (!pendingHref) return;
    bypass.current = true;
    const href = pendingHref;
    setPendingHref(null);
    router.push(href);
  };

  const dialog = (
    <AlertDialog open={pendingHref !== null} onOpenChange={(open) => !open && setPendingHref(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            You have changes in this form that are not saved. If you leave now, they are lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay on this page</AlertDialogCancel>
          <Button variant="destructive" onClick={leave}>
            Leave without saving
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { dialog, allowNavigation };
}
