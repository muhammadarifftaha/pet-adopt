/**
 * What a client component shows when a server action call itself fails: the network dropped, the
 * server restarted, or a new deploy changed the action ids ("Failed to find Server Action").
 */
export const UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection, or reload the page if the site was just updated.'

/** The failed result `callAction` gives for a call that never got an answer. */
export type Unreachable = { ok: false; error: string; fieldErrors?: undefined }

/**
 * Awaits a server action call and turns a rejected promise into a failed result, so the screen
 * shows a message and resets its busy state instead of staying on "Saving…" (or failing silently).
 * Actions report their own errors as `{ ok: false }`; this only covers the call not arriving.
 *
 *   const result = await callAction(savePetAction(id, input))
 */
export function callAction<R>(pending: Promise<R>): Promise<R | Unreachable> {
  return pending.catch((): Unreachable => ({ ok: false, error: UNREACHABLE_MESSAGE }))
}
