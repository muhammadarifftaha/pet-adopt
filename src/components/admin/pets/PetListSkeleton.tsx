import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The grid PetList lays its cards out in. Shared so the skeleton and the real list line up. */
export const PET_GRID =
  "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4";

/** The admin list shows 12 pets a page, so the skeleton shows 12 cards. */
const SKELETON_COUNT = 12;

// Text lines get different widths so the placeholders look like real, different names and details
// instead of one repeated card. Each table has its own length (5, 4 and 3), so the combination
// differs for every card in a page of 12 and neighbours never match. It is deterministic on
// purpose (no Math.random): a skeleton that is server-rendered must match on the client.
// Full class names, because Tailwind only generates the classes it can see in the source.
const NAME_WIDTHS = ["w-24", "w-32", "w-20", "w-28", "w-36"] as const;
const DETAIL_WIDTHS = ["w-40", "w-32", "w-44", "w-36"] as const;
const LOCATION_WIDTHS = ["w-28", "w-20", "w-32"] as const;

// Mirrors PetCard: image on top, then title with a status badge, two lines of detail, and two
// buttons. The bar heights plus margins add up to the real text's line heights (28px title, 20px
// details), so the card is the same height and nothing jumps when the real data arrives.
export function PetCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <Card className="relative mx-auto w-full pt-0">
      <Skeleton className="aspect-video w-full rounded-none" />
      <CardHeader className="flex-auto">
        <CardTitle>
          <Skeleton
            className={`my-1 h-5 ${NAME_WIDTHS[index % NAME_WIDTHS.length]}`}
          />
        </CardTitle>
        <CardAction>
          <Skeleton className="h-5 w-16 rounded-full" />
        </CardAction>
        <CardDescription>
          <Skeleton
            className={`my-0.5 h-4 ${DETAIL_WIDTHS[index % DETAIL_WIDTHS.length]}`}
          />
        </CardDescription>
        <CardDescription>
          <Skeleton
            className={`my-0.5 h-4 ${LOCATION_WIDTHS[index % LOCATION_WIDTHS.length]}`}
          />
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex justify-end gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-20" />
      </CardFooter>
    </Card>
  );
}

// The loading state of PetList: a count line and a grid of placeholder cards. Screen readers get
// one "Loading pets…" message instead of a dozen empty boxes.
export function PetListSkeleton({
  count = SKELETON_COUNT,
}: {
  count?: number;
}) {
  return (
    <div role="status">
      <span className="sr-only">Loading pets…</span>
      <div aria-hidden="true">
        <Skeleton className="mb-4 h-5 w-24" />
        <div className={PET_GRID}>
          {Array.from({ length: count }, (_, index) => (
            <PetCardSkeleton key={index} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
