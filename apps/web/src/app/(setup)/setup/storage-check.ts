import { randomBytes } from 'node:crypto'

import { describeError, logError } from '@/server/result'
import { getStorage } from '@/server/storage'

/** What setup's last step says about image storage. `problem` is null when it works. */
export type StorageCheck = { description: string | null; problem: string | null }

const TIMEOUT_MS = 10_000

/**
 * Writes a small test file to the uploads bucket and deletes it again, like `pnpm storage:check`,
 * so wrong keys, a missing bucket or an unreachable endpoint show here rather than on the first
 * upload. The problem text comes from the settings check or the storage service (no stored data).
 */
export async function checkStorage(): Promise<StorageCheck> {
  let description: string | null = null
  try {
    const storage = await getStorage()
    description = storage.describe()
    // A name the server could have generated, so it passes the same checks as real uploads.
    const key = `storage-check-${randomBytes(8).toString('hex')}.png`
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${TIMEOUT_MS / 1000} seconds`)), TIMEOUT_MS)
    })
    try {
      await Promise.race([
        (async () => {
          await storage.put(key, randomBytes(16), 'image/png')
          await storage.delete(key)
        })(),
        timeout,
      ])
    } finally {
      clearTimeout(timer)
    }
    return { description, problem: null }
  } catch (error) {
    logError(error, 'setup: image storage check')
    return { description, problem: describeError(error) }
  }
}
