import React from "react";

import { cn } from "@/lib/utils";

export type SummaryItem = { name: string; label: string; message: string };

/**
 * What a person needs after a failed save (WCAG 3.3.1 and 3.3.3): one place that says what is wrong,
 * with a link to each problem. The form moves focus here, so a screen reader reads it at once; a link
 * calls `onSelect`, which opens whatever holds the field and focuses it. `role="alert"` announces it if
 * focus is lost. Fields keep plain error text (not FieldError, whose role="alert" would announce every
 * field at once).
 */
export function ErrorSummary({
  items,
  general,
  onSelect,
  ref,
  idOf,
  failureTitle,
  className = "mb-6",
}: {
  items: SummaryItem[];
  /** A problem that is not about one field, such as "You need to be signed in". */
  general: string | null;
  onSelect: (name: string) => void;
  ref?: React.Ref<HTMLDivElement>;
  /** The DOM id of a field, for the links. */
  idOf: (name: string) => string;
  /** Heading when nothing is wrong with a single field, such as "The pet could not be saved". */
  failureTitle: string;
  className?: string;
}) {
  const count = items.length;
  const title =
    count > 0
      ? `There ${count === 1 ? "is 1 problem" : `are ${count} problems`} with this form`
      : failureTitle;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/50 bg-destructive/5 p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring",
        className,
      )}
    >
      <h2 className="text-base font-semibold text-destructive">{title}</h2>
      {general ? <p className="mt-1 text-sm">{general}</p> : null}
      {count > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => (
            <li key={item.name}>
              <a
                href={`#${idOf(item.name)}`}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(item.name);
                }}
                className="underline underline-offset-2"
              >
                {item.label}: {item.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
