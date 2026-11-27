// Writes apps/web/.env for a new copy of the project, so a first start needs no hand editing.
//
//   pnpm setup:env                  for local development
//   pnpm setup:env --production     for a server: storage keys are left for you to fill in
//   pnpm setup:env --file <path>    write somewhere else (relative to apps/web)
//
// It copies .env.example, fills BETTER_AUTH_SECRET with a new random value and, for local
// development, the keys of the storage server in docker-compose.yml (they only work for that
// local server, and production refuses them anywhere else). It never overwrites or reads an
// existing file: delete yours first if you really want a new one.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const production = args.includes('--production')
const fileAt = args.indexOf('--file')
const target = path.resolve(process.cwd(), fileAt >= 0 ? (args[fileAt + 1] ?? '') : '.env')

const stop = (message: string): never => {
  console.error(message)
  process.exit(1)
}

if (fileAt >= 0 && !args[fileAt + 1]) stop('Give a path after --file.')
if (existsSync(target)) stop(`${target} already exists and was left alone. Delete it first if you want a new one.`)

const example = path.resolve(process.cwd(), '.env.example')
if (!existsSync(example)) stop(`Cannot find ${example}. Run this from the project (pnpm setup:env).`)

/** Replaces the value of one `NAME=value` line; stops when the example no longer has that line. */
const set = (text: string, name: string, value: string): string => {
  const line = new RegExp(`^${name}=.*$`, 'm')
  if (!line.test(text)) stop(`.env.example has no ${name}= line, so this script needs updating.`)
  return text.replace(line, `${name}=${value}`)
}

let text = set(readFileSync(example, 'utf8'), 'BETTER_AUTH_SECRET', randomBytes(32).toString('hex'))

if (!production) {
  // The development keys live in one place, docker-compose.yml, as the defaults of the storage server.
  const compose = path.resolve(process.cwd(), '../../docker-compose.yml')
  const source = existsSync(compose) ? readFileSync(compose, 'utf8') : ''
  const accessKey = source.match(/GARAGE_DEFAULT_ACCESS_KEY:\s*\$\{GARAGE_ACCESS_KEY:-([0-9A-Za-z]+)\}/)?.[1]
  const secretKey = source.match(/GARAGE_DEFAULT_SECRET_KEY:\s*\$\{GARAGE_SECRET_KEY:-([0-9a-f]+)\}/)?.[1]
  if (accessKey && secretKey) {
    text = set(set(text, 'S3_ACCESS_KEY_ID', accessKey), 'S3_SECRET_ACCESS_KEY', secretKey)
  } else {
    console.warn('The development storage keys were not found in docker-compose.yml: fill in the two S3 keys yourself.')
  }
}

// Only the owner may read it: it holds the secret.
writeFileSync(target, text, { mode: 0o600, flag: 'wx' })

console.log(`Wrote ${target} with a new BETTER_AUTH_SECRET.`)
if (production) {
  console.log('Before the first start, set in it: NEXT_PUBLIC_SERVER_URL, DATABASE_URL and the S3_* storage settings.')
  console.log('docs/deployment.md goes through each one.')
} else {
  console.log('Next: docker compose up -d garage mailpit, then pnpm install and pnpm dev.')
  console.log('The server prints a setup link in its log; open it to create the first account.')
}
