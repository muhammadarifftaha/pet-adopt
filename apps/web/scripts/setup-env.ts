// Writes apps/web/.env for a new copy of the project, so a first start needs no hand editing.
//
//   pnpm setup:env                  for local development
//   pnpm setup:env --production     for a server: the storage keys are left for you to fill in
//   pnpm setup:env --file <path>    write somewhere else (relative to the folder you typed it in)
//
// It copies .env.example, fills BETTER_AUTH_SECRET with a new random value (32 bytes as 64 hex
// characters) and, for local development, the keys of the storage server in docker-compose.yml
// (they only work for that local server, and production refuses them anywhere else). It never
// overwrites or reads an existing file: delete yours first if you really want a new one. The file
// is written readable by its owner only (mode 0600), because it holds the secret.
//
// Plain TypeScript with no imports from the app, so it also runs with `node` alone.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const stop = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// Paths of the project come from where this script lives, so the folder it is started from does not matter.
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const example = path.join(appDir, '.env.example')
const compose = path.join(appDir, '..', '..', 'docker-compose.yml')

let production = false
let file: string | null = null
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--production') production = true
  else if (arg === '--file') {
    const next = args[++i]
    if (!next || next.startsWith('--')) stop('Give a path after --file.')
    file = next
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: pnpm setup:env [--production] [--file <path>]')
    process.exit(0)
  } else stop(`Unknown option ${arg}. Usage: pnpm setup:env [--production] [--file <path>]`)
}

// pnpm runs package scripts inside apps/web and keeps the folder the command was typed in as INIT_CWD.
const typedIn = process.env.INIT_CWD || process.cwd()
const target = file ? path.resolve(typedIn, file) : path.join(appDir, '.env')

if (existsSync(target)) stop(`${target} already exists and was left alone. Delete it first if you want a new one.`)
if (!existsSync(example)) stop(`Cannot find ${example}.`)

/** Replaces the value of one `NAME=value` line; stops when the example no longer has that line. */
const set = (text: string, name: string, value: string): string => {
  const line = new RegExp(`^${name}=.*$`, 'm')
  if (!line.test(text)) stop(`.env.example has no ${name}= line, so scripts/setup-env.ts needs updating.`)
  return text.replace(line, `${name}=${value}`)
}

let text = set(readFileSync(example, 'utf8'), 'BETTER_AUTH_SECRET', randomBytes(32).toString('hex'))

if (!production) {
  // The development keys live in one place, docker-compose.yml, as the defaults of the storage server.
  const source = existsSync(compose) ? readFileSync(compose, 'utf8') : ''
  const accessKey = source.match(/GARAGE_DEFAULT_ACCESS_KEY:\s*\$\{GARAGE_ACCESS_KEY:-(GK[0-9a-f]{24})\}/)?.[1]
  const secretKey = source.match(/GARAGE_DEFAULT_SECRET_KEY:\s*\$\{GARAGE_SECRET_KEY:-([0-9a-f]{64})\}/)?.[1]
  if (accessKey && secretKey) {
    text = set(set(text, 'S3_ACCESS_KEY_ID', accessKey), 'S3_SECRET_ACCESS_KEY', secretKey)
  } else {
    console.warn('The development storage keys were not found in docker-compose.yml: fill in the two S3 keys yourself.')
  }
}

// 'wx' refuses to replace anything that appeared since the check above (a file, or a link to one).
try {
  writeFileSync(target, text, { mode: 0o600, flag: 'wx' })
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') stop(`${target} already exists and was left alone. Delete it first if you want a new one.`)
  stop(`Could not write ${target}${code ? ` (${code})` : ''}.`)
}

console.log(`Wrote ${target} with a new BETTER_AUTH_SECRET.`)
if (production) {
  console.log('Before the first build, set in it: NEXT_PUBLIC_SERVER_URL, DATABASE_URL and the S3_* storage settings.')
  console.log('The settings page of the docs (https://pet-adopt.dev/docs/developers/deployment/settings) goes through each one.')
} else {
  console.log('Next: docker compose up -d garage mailpit, then pnpm dev.')
  console.log('The server prints a setup link in its log; open it to create the first account.')
}
