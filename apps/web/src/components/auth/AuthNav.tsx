"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonVariants } from "@pet-adopt/ui/components/button";
import { FaRegArrowAltCircleLeft } from "react-icons/fa";
import { cn } from "@/lib/utils";

// Navigation for the signed-out screens, structured to the WCAG / WAI-ARIA recommendations:
//
//  - A <nav> landmark with a short accessible name ("Account"). Do not put the word "navigation" in
//    it: screen readers already announce "navigation landmark". The name matters because a page can
//    have several landmarks and users jump between them by name (WCAG 1.3.1, 2.4.1).
//  - The links sit in a list, so assistive technology announces "list, 2 items" and the user knows
//    how many choices there are (1.3.1).
//  - The current page is marked with aria-current="page" (4.1.2) AND looks different without
//    relying on colour alone (1.4.1): bolder text and an underline.
//  - Plain links stay plain links. They keep their keyboard, focus-ring and target-size behaviour
//    (2.1.1, 2.4.7, 2.5.8); a link cannot be "disabled", and removing or greying out the current
//    page's link would hide it from keyboard and screen-reader users.
//  - The visible text IS the accessible name. Do not add an aria-label that repeats or differs from
//    it (2.5.3 Label in Name), and keep the wording clear out of context (2.4.4 Link Purpose).
//  - Keep the order and wording the same on every page that shows this nav (3.2.3 Consistent
//    Navigation).
//
// Also recommended for the page that renders this (in the layout, not here): a "Skip to main
// content" link as the first focusable element, pointing at <main id="main-content" tabIndex={-1}>
// (2.4.1 Bypass Blocks), and exactly one <h1> per page.

type Item = {
  href: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>> | null;
};

// Add screens here (for example a "Back to site" link). Keep each label meaningful on its own.
const ITEMS: Item[] = [
  { href: "/", label: "Back to Site", Icon: FaRegArrowAltCircleLeft },
  { href: "/admin/login", label: "Sign in" },
  { href: "/admin/reset-password", label: "Password Reset" },
];

export default function AuthNav({ label = "Account" }: { label?: string }) {
  // usePathname() also works during server rendering, so aria-current is in the first HTML.
  const pathname = usePathname();

  return (
    <nav aria-label={label}>
      <ul className="flex flex-row items-center justify-end gap-1">
        {ITEMS.map(({ href, label: text, Icon }) => {
          const current = pathname === href;
          return (
            <li key={href}>
              {/* A plain Link styled with buttonVariants, not <Button render={<Link />}>: Base UI's
                  Button gives non-<button> elements button semantics (role, Space to activate),
                  but navigation links must stay real links (announced as "link", Enter only). */}
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "link", size: "sm" }),
                  // A second cue besides colour for the current page.
                  current && "font-semibold underline underline-offset-4",
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {text}
                {current && <span className="sr-only">(current page)</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
