import type { ActionResult } from "@/server/result";

/**
 * For client components and SWR fetchers: the data of a successful action, or throw so the error
 * lands in SWR's `error`. Actions return `{ ok: false }` instead of throwing, which SWR cannot see.
 * (`unwrap` in ./unwrap.ts is for server components: it imports server-only code.)
 */
export function unwrapResult<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
