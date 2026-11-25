/**
 * Checks that the configured upload storage works: writes a small test file, reads it back,
 * confirms it is there, deletes it and confirms it is gone. Run it after setting the S3_*
 * variables, before uploading anything:
 *   pnpm storage:check
 *
 * Each step that fails says which permission or setting to look at. Nothing else in the bucket is
 * touched; the test file has a random name.
 */
import { randomBytes } from 'node:crypto'

const { getStorage } = await import('../src/server/storage')

const step = async <T>(label: string, hint: string, fn: () => Promise<T>): Promise<T> => {
  try {
    const result = await fn()
    console.log(`  ok    ${label}`)
    return result
  } catch (error) {
    const { name, message, $metadata } = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
    const status = $metadata?.httpStatusCode ? ` (HTTP ${$metadata.httpStatusCode})` : ''
    console.log(`  FAIL  ${label}: ${name ?? 'Error'}${status}: ${(message ?? String(error)).split('\n')[0]}`)
    console.log(`        ${hint}`)
    process.exit(1)
  }
}

const storage = await step('read the storage settings', 'Fix the variable the message names (see .env.example).', () => getStorage())
console.log(`Upload storage: ${storage.describe()}`)

// A name the server could have generated, so it passes the same checks as real uploads.
const key = `storage-check-${randomBytes(8).toString('hex')}.png`
const body = randomBytes(64)

await step('write a test file', 'The keys need permission to write objects, and the bucket name and endpoint must be right.', () =>
  storage.put(key, body, 'image/png'),
)
const read = await step('read it back', 'The keys need permission to read objects.', () => storage.get(key))
if (!read || !read.body.equals(body)) {
  console.log('  FAIL  read it back: the file came back different from what was written.')
  process.exit(1)
}
await step('see that it exists', 'The keys need permission to read object metadata (HEAD).', async () => {
  if (!(await storage.exists(key))) throw new Error('the file was written but is reported missing')
})
await step('delete it', 'The keys need permission to delete objects; remove the test file by hand: ' + key, () => storage.delete(key))
await step('see that it is gone', 'The file may still be in the bucket: ' + key, async () => {
  if (await storage.exists(key)) throw new Error('the file is still there after deleting it')
  if (await storage.get(key)) throw new Error('the file can still be read after deleting it')
})

console.log('\nUpload storage works.')
process.exit(0)
