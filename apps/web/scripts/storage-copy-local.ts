/**
 * Copies uploads from a local folder into the S3 storage set by the S3_* variables. The site no
 * longer stores files on disk; use this once to move the uploads of a site that did (they were in
 * data/media at the repo root by default):
 *   pnpm storage:copy-local                     copies data/media, skipping what the bucket has
 *   pnpm storage:copy-local --from <folder>     another folder (relative to apps/web)
 *   pnpm storage:copy-local --dry-run           only lists what it would copy
 *
 * Files already in the bucket are skipped, so it is safe to run again. Local files are never
 * changed or deleted; remove the folder yourself once the site shows every image. Only names the
 * server generates are copied (other files are listed as skipped), with the content type the
 * upload had.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const { SAFE_FILENAME } = await import('../src/server/media-url')
const { getStorage } = await import('../src/server/storage')

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fromAt = args.indexOf('--from')
const from = fromAt >= 0 ? args[fromAt + 1] : '../../data/media'

try {
  if (!from || from.startsWith('--')) throw new Error('--from needs a folder, for example --from ../../data/media')
  const folder = path.resolve(process.cwd(), from)
  const bucket = await getStorage()
  console.log(`From: local folder ${folder}\nTo:   ${bucket.describe()}${dryRun ? '\n(dry run: nothing is copied)' : ''}\n`)

  let names: string[]
  try {
    names = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`There is no folder at ${folder}: nothing to copy.`)
    throw error
  }

  let copied = 0
  let present = 0
  const skipped: string[] = []
  for (const name of names) {
    if (!SAFE_FILENAME.test(name)) {
      skipped.push(name)
      continue
    }
    if (await bucket.exists(name)) {
      present++
      continue
    }
    if (!dryRun) {
      const body = await fs.readFile(path.join(folder, name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null // removed while we were copying
        throw error
      })
      if (!body) continue
      await bucket.put(name, body, TYPES[name.split('.').pop() as string] ?? 'application/octet-stream')
    }
    copied++
    if (copied % 50 === 0) console.log(`  ${copied} ${dryRun ? 'to copy' : 'copied'}...`)
  }

  console.log(`${dryRun ? 'Would copy' : 'Copied'} ${copied} file(s); ${present} already in the bucket.`)
  if (skipped.length) console.log(`Skipped ${skipped.length} file(s) with names the site never creates: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''}`)
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
