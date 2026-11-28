# Deploying Pet Adopt

How to run a site in production: on your own server, or on a server you run for someone else.

The README's [Production](../README.md#production) section is the short version. This guide goes step by step and explains the settings that are easy to get wrong.

## What you need

| Piece | What it is for | Notes |
|---|---|---|
| **Node.js** 22.23.4 or newer, or 24.22.1 or newer | Runs the site | With [pnpm](https://pnpm.io). There is no npm lockfile. |
| **A database** | Pets, pages, accounts, settings | PostgreSQL for production. A SQLite file works for one small server. |
| **S3-compatible object storage** | Every uploaded image | Required. Nothing is stored on the server's disk. |
| **A reverse proxy you control** | HTTPS, and telling the site each visitor's address | Required. See [The reverse proxy](#the-reverse-proxy). |
| **An SMTP server** | Invites, password resets, form notifications | Optional, but most of the account features depend on it. |

The site itself keeps no files, so the server can be replaced at any time. Everything that matters lives in the database and the storage bucket.

## Step by step

### 1. Get the code and install

```bash
git clone <your-fork-url> pet-adopt
cd pet-adopt
pnpm install --frozen-lockfile
pnpm setup:env --production
```

**`pnpm setup:env --production`** copies `apps/web/.env.example` to `apps/web/.env` and fills in a new random `BETTER_AUTH_SECRET`. It leaves the storage keys for you to fill in, and the file is readable by its owner only. It never overwrites or reads a file that is already there: if `apps/web/.env` exists, it stops and changes nothing. `--file <path>` writes somewhere else, for example to prepare the settings for your host's environment screen. To do it by hand instead, copy the example file and set the secret yourself.

On your own machine, for development, run `pnpm setup:env` without `--production`: it also fills in the keys of the local storage server from `docker-compose.yml`. Those keys only work for that local server, and production refuses them.

Every setting below goes in `apps/web/.env`, or in your host's environment settings. `apps/web/.env.example` documents each one.

### 2. Set the two required values

```bash
# apps/web/.env
BETTER_AUTH_SECRET=<already filled in by setup:env; otherwise the output of: openssl rand -hex 32>
NEXT_PUBLIC_SERVER_URL=https://adopt.example.com
```

- **`BETTER_AUTH_SECRET`** signs sessions and encrypts stored secrets (the SMTP password, sign-in provider secrets, captcha keys, two-factor secrets). It must be at least 32 random characters, or the server refuses to start.
  - **Keep it safe and keep it the same.** If it changes, everyone is signed out, two-factor stops working for accounts that had it, and every stored secret has to be typed in again.
  - **Back it up** with your other secrets. A database backup is not fully usable without it.
- **`NEXT_PUBLIC_SERVER_URL`** is the site's exact public address, with `https://` and no trailing slash. Links in emails are built from it, and it is the only origin allowed to make signed-in requests.
  - **It must be set when you build**, not only when you start: part of it is compiled into the pages. Changing it means building again.

### 3. Choose the database

**PostgreSQL (recommended):**

```bash
DATABASE_URL=postgres://user:password@db.example.com:5432/pet_adopt
```

- Give the site its own database and a user that owns only that database.
- Never expose the database port to the internet.
- On a pooled connection, use the pooler's address. On serverless hosts set `DB_POOL_MAX` low (1 to 3); the default is 10 connections per server.

**A SQLite file (one small server only):**

```bash
DATABASE_URL=file:/var/lib/pet-adopt/pet-adopt.db
```

- The folder must be on a disk that survives restarts and redeploys, and the site's user must be able to write to it.
- One server only. Two servers cannot share a SQLite file.

**Hosted libSQL** is also supported (`DATABASE_URL=libsql://…` with `DATABASE_AUTH_TOKEN`).

### 4. Set up upload storage

```bash
S3_BUCKET=pet-adopt-media
S3_ENDPOINT=https://s3.example.com     # leave unset for AWS S3
S3_ACCESS_KEY_ID=<your key>
S3_SECRET_ACCESS_KEY=<your secret>
# S3_REGION=        # default us-east-1
# S3_PREFIX=        # a folder inside the bucket, to share one bucket between sites
```

- **Create keys for this site only**, with read, write and delete access to this one bucket.
- **The bucket can stay private.** Visitors load images through the site's own `/media` route.
- **Do not use the keys printed in `docker-compose.yml`.** They are for the local development server and anyone can read them. Production refuses them unless the storage server is on the same machine.
- **Check it** before going further:

  ```bash
  pnpm --filter @pet-adopt/web storage:check
  ```

  It writes, reads and deletes a test file, and names the setting that is wrong if a step fails.

### 5. Build

```bash
pnpm build
```

For PostgreSQL and hosted libSQL, the build **migrates the database first** and fails if it cannot. That way new code never runs against an older database. A SQLite file migrates itself when the site first opens it.

If the build machine cannot reach the database (a container image built elsewhere, for example):

```bash
SKIP_BUILD_MIGRATE=1 pnpm build     # on the build machine
pnpm migrate                        # on a machine that can reach the database, before starting
```

### 6. Start

```bash
pnpm --filter @pet-adopt/web exec next start -H 127.0.0.1 -p 3000
```

- `-H 127.0.0.1` makes the site listen only on the server itself, so visitors can only reach it through your reverse proxy. Use this whenever the proxy runs on the same machine.
- `pnpm start` also works, but listens on every network interface. Use it only when a firewall or a private network already keeps the port away from the internet. A visitor who can reach the port directly can send any `X-Forwarded-For` header and the site will believe it, which gets them past every limit.

The server stops with a clear message if `BETTER_AUTH_SECRET` is weak, `NEXT_PUBLIC_SERVER_URL` is missing, or the storage settings are wrong.

To keep it running, use a process manager. A systemd unit, as an example:

```ini
# /etc/systemd/system/pet-adopt.service
[Unit]
Description=Pet Adopt
After=network-online.target

[Service]
User=petadopt
WorkingDirectory=/srv/pet-adopt
ExecStart=/usr/bin/pnpm --filter @pet-adopt/web exec next start -H 127.0.0.1 -p 3000
Environment=NODE_ENV=production
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### 7. Put the reverse proxy in front

See [the next section](#the-reverse-proxy). Do this before creating the first account.

### 8. Create the first account

On a new site, the server prints a **setup link** in its log when it starts:

```
<NEXT_PUBLIC_SERVER_URL>/setup?key=…
```

Open it, create the admin account, and follow the short guided setup. Whoever can read the log can claim the site, so do this straight away.

For installs with nobody at the keyboard, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (12 characters or more) instead. The server creates that admin on its first start. Remove the two values afterwards.

### 9. Check it

- `https://adopt.example.com/health` answers `{"ok":true}`.
- The homepage loads over HTTPS.
- Sign in, upload an image in **Media**, and open it.
- In **Email → Sending**, send a test email. If it lands in junk, check that the domain you send from has SPF, DKIM and DMARC records, as your mail provider describes.
- Read the server log for warnings. One to look for is described under [Check the client address](#check-the-client-address).

## The reverse proxy

The site must run behind a reverse proxy that you control. It does two jobs:

1. **HTTPS.** The site speaks plain HTTP to the proxy; the proxy holds the certificate.
2. **The visitor's address.** Every limit on sign-in guessing, password resets and form sending counts per visitor address. The site learns that address from a header the proxy sets.

### Why the header matters

A visitor can send any `X-Forwarded-For` header they like. The site therefore trusts only the part of the header that **your proxy** wrote, counted from the end:

- `CLIENT_IP_HEADER` names the header (default `x-forwarded-for`).
- `TRUSTED_PROXY_HOPS` says how many of your own proxies add to it (default `1`).

With one proxy, the last entry is the visitor. With a CDN in front of your own proxy, the visitor is the second entry from the end, so the value is `2`.

| Setup | `CLIENT_IP_HEADER` | `TRUSTED_PROXY_HOPS` |
|---|---|---|
| One reverse proxy on the server | *(default)* | `1` *(default)* |
| A CDN, then your reverse proxy | *(default)* | `2` |
| A CDN that sends its own header with the visitor's address, and the site is reachable **only** through it | that header's name | `1` |

**If these are wrong:**

- **Too low:** the site sees the address of your CDN or proxy for every visitor. All visitors then share one set of limits, so a few wrong passwords from anyone lock everyone out for a while.
- **Too high:** the site reads a value the visitor wrote, so someone can dodge the limits by changing the header.
- **The port is reachable without the proxy:** the same as too high. The visitor's own header is believed.
- **`CLIENT_IP_HEADER` names a header nothing sets:** the site cannot tell visitors apart. It then counts every attempt on an email address together, so anyone can lock an owner out of sign-in for ten minutes at a time.

### Examples

**Caddy** (gets and renews the certificate by itself):

```caddy
adopt.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name adopt.example.com;
    # ssl_certificate and ssl_certificate_key go here

    client_max_body_size 11m;   # uploads are up to 10 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

As the only proxy, both leave the defaults (`x-forwarded-for`, one hop) correct.

**Behind a CDN, the two differ:**

- **nginx** with the line above adds the CDN's address to the header it received. Set `TRUSTED_PROXY_HOPS=2` and nothing else.
- **Caddy** discards the header it received unless it trusts the sender, and writes only the CDN's address. Without the setting below, every visitor looks like the CDN whatever `TRUSTED_PROXY_HOPS` says. Tell Caddy which addresses are your CDN's, then set `TRUSTED_PROXY_HOPS=2`:

```caddy
{
	servers {
		trusted_proxies static 198.51.100.0/24   # your CDN's address ranges
	}
}

adopt.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Use the ranges your CDN publishes, and keep them current. Also make sure the server accepts connections only from the CDN, or a visitor can skip it.

Whatever proxy you use, allow request bodies of at least 11 MB, or image uploads near the 10 MB limit will fail at the proxy.

### Check the client address

After the proxy is in place, sign in and open **Activity** in the admin. Your sign-in entry shows the address the site saw.

- **It is your own public address:** the settings are right.
- **It is the proxy's or the CDN's address:** `TRUSTED_PROXY_HOPS` is too low.
- **It is `127.0.0.1` or another address on your own network:** the request did not come through the proxy, or the proxy does not set the header.
- **It is blank**, and the server log says `Sign-in throttling cannot tell clients apart`: `CLIENT_IP_HEADER` names a header that nothing sets.

To be sure a visitor cannot choose the address, send a request with a made-up header and a wrong password, then look at the failed sign-in in **Activity**:

```bash
curl -X POST https://adopt.example.com/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: https://adopt.example.com' \
  -H 'X-Forwarded-For: 203.0.113.99' \
  -d '{"email":"you@example.com","password":"not-the-password"}'
```

The entry must show your own address. If it shows `203.0.113.99`, `TRUSTED_PROXY_HOPS` is too high or the port is reachable without the proxy.

## Running a site for someone else

When you host a site for a client, the client's admins sign in to a server on **your** network. Two settings in the admin make the server connect to an address someone typed:

- **Authentication → Sign-in providers**
- **Email → Sending** (the mail server)

By default the site refuses any such address that is inside a private network, so an admin cannot use these screens to reach machines that only your server can see. Two switches turn that protection off:

| Variable | Effect |
|---|---|
| `AUTH_PROVIDER_PRIVATE_ADDRESSES=1` | Sign-in providers may be on a private network |
| `SMTP_PRIVATE_ADDRESSES=1` | A mail server typed on the Email screen may be on a private network |

**Leave both unset when you host for someone else.**

If you want the site to use a mail server on your own network, set it yourself with `SMTP_HOST` (and the other `SMTP_*` variables). A mail server set that way is trusted, shows as read-only in the admin, and needs no switch.

Other things to settle with a client:

- **Who holds the admin role.** Admins manage accounts and settings. The developer role can change settings, themes and plugins but cannot see personal data or manage accounts. The audit role can look at everything and change nothing.
- **Two-factor.** Under **Authentication → Two-factor** you can require it for chosen roles.
- **A privacy policy.** Forms collect personal data. Choose the policy page under **Site settings → Navigation**; forms then link to it.

## Backups

A site is three things. Back up all three, and **restore the database and the bucket together**: the database refers to image files by name, so one without the other leaves broken images or orphaned files.

| What | How |
|---|---|
| **The database** | PostgreSQL: `pg_dump`. SQLite: `sqlite3 pet-adopt.db ".backup backup.db"`, which is safe while the site runs. Copying the file by hand is not, unless the site is stopped. |
| **The storage bucket** | Copy or sync the bucket with your storage provider's tool, or switch on its versioning. |
| **The secrets** | `BETTER_AUTH_SECRET` and the rest of the environment. Without the same secret, restored accounts lose two-factor and every stored password and key must be entered again. |

Take the database backup first and the bucket copy straight after. A bucket that is slightly newer than the database only holds a few unused files; a database newer than the bucket has images that are missing.

**Test a restore** into a scratch database and bucket before you need one.

## Updating

```bash
git pull
pnpm install --frozen-lockfile
pnpm build        # migrates PostgreSQL and hosted libSQL, then builds
# restart the server
```

- **Back up first.** Migrations change the database and are not reversed by going back to older code.
- **Read the release notes** for changed settings.
- With more than one server, build once, then restart them one after another. The build's migration runs before any of them starts the new code.

`git pull` brings the site and the plugins kept in the repository's `plugins/` folder. Plugins you installed from npm are updated separately, below.

### Plugins installed from npm

A plugin added with `pnpm --filter @pet-adopt/web add <name>` comes from npm, and `git pull` does not move it. Update it on your own machine, test, and commit the result:

```bash
pnpm update -r "@pet-adopt/plugin-*"            # stays inside the ranges in apps/web/package.json
pnpm update -r --latest "@pet-adopt/plugin-*"   # or: move to the newest release
pnpm typecheck
pnpm build
```

- **A plain `pnpm update` stays inside the version range** written in `apps/web/package.json`. An exact version (`0.1.0`) does not move at all, and `^0.1.0` takes only patch releases while the version starts with 0. A new minor release (0.2.0) can need action from you, so read the plugin's changelog before you use `--latest`.
- **Plugins from other authors** have their own names: put each one in place of the pattern, as in `pnpm update -r --latest acme-pet-adopt-gallery`.
- **Check `apps/web/package.json` afterwards.** Plugins kept in the repository's `plugins/` folder must still say `workspace:*`. If one now names a version from npm, put `workspace:*` back and run `pnpm install`.
- **A plugin needs a recent enough site.** Plugins depend on the SDK (`@pet-adopt/plugin-sdk`), which comes with the site. If pnpm warns about an unmet peer dependency on `@pet-adopt/plugin-sdk`, the new plugin version needs a newer site: update the site first (`git pull`, as above), or stay on the plugin version you have.
- **Commit** the changed `apps/web/package.json` and `pnpm-lock.yaml`, then deploy as above. A plugin update can bring migrations for its own tables: `pnpm build` applies them on PostgreSQL and hosted libSQL, and a local SQLite file applies them when the server starts.

## More than one server

Works with PostgreSQL or hosted libSQL. Sessions, sign-in limits and settings are in the database, so servers share them.

Two things differ between servers for a short time:

- **Pages:** each server keeps its own page cache. After you publish, the server that handled the request shows the change at once; the others catch up within 60 seconds.
- **Sign-in providers:** a change takes effect at once on the server that saved it and within 30 seconds on the others.

## Settings reference

The full list, with explanations, is in `apps/web/.env.example`. The ones that matter for a deployment:

| Variable | Required | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | Signs sessions and encrypts stored secrets |
| `NEXT_PUBLIC_SERVER_URL` | Yes, at build and start | The public address |
| `DATABASE_URL` | Yes for PostgreSQL | The database |
| `DATABASE_AUTH_TOKEN` | Hosted libSQL only | Its access token |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes | Upload storage |
| `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | Depends on the provider | Where and how to reach the bucket |
| `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS` | When the defaults do not fit | How the visitor's address is read |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | No | Email, instead of the admin screen |
| `AUTH_PROVIDER_PRIVATE_ADDRESSES`, `SMTP_PRIVATE_ADDRESSES` | No | Allow private addresses (see above) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | No | Create the first admin without the setup link |
| `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS` | No | PostgreSQL connection limits |
| `SEARCH_INDEXING=off` | On staging | Keeps search engines away |
| `CSP_IMG_SRC` | For a plugin that shows pictures from another service | Other https hosts pictures may load from, separated by spaces. Empty by default; the plugin's README says what to enter |
| `SKIP_BUILD_MIGRATE`, `MIGRATE_ON_PREVIEW` | No | When the build migrates |
| `ACTIVITY_LOG_DAYS` | No | How long the activity log is kept (default 365) |

## When something goes wrong

| What you see | Likely cause |
|---|---|
| The server stops at start with a message about `BETTER_AUTH_SECRET` | It is missing, shorter than 32 characters, or still a placeholder |
| Every page answers 500 right after a deploy | The storage settings are wrong. The log says which one; run `storage:check` |
| "still hold the placeholders from .env.example" | The two storage keys were not replaced |
| "are the development keys from docker-compose.yml" | Production is using the local development keys |
| Signing in is refused, or saving anything fails while signed in | `NEXT_PUBLIC_SERVER_URL` does not match the address in the browser exactly (scheme, host and port) |
| Images upload but large ones fail | The proxy's body size limit is below 11 MB |
| "This server is inside a private network" on the Email screen | The mail server is on a private address. Set it with `SMTP_HOST` instead |
| Emailed links point at `localhost` | `NEXT_PUBLIC_SERVER_URL` was not set when the site was built |
| An owner is locked out of sign-in | Wait ten minutes, or run `NEW_PASSWORD=… pnpm admin:reset-password <email>` on the server |
| The last admin lost their two-factor device | `pnpm --filter @pet-adopt/web admin:reset-2fa <email>` on the server |
| The build fails at "migrate" | The build machine cannot reach the database. See step 5 |

Errors are written to the server's log only. Point your host's log collection or an error monitor at it; the site has none built in.

## What this guide does not cover

- **A container image.** The project does not ship a `Dockerfile` yet. The steps above work inside one: build with `SKIP_BUILD_MIGRATE=1`, run `pnpm migrate` when the container starts, and pass the settings as environment variables.
- **Managed platforms.** The site runs anywhere that runs a Next.js server with a database and S3-compatible storage. On Vercel, preview builds skip migrations and are never indexed by search engines.
- **Tuning** the database or the proxy beyond the settings named here.

## What has been tested

So you know how far to trust each part:

- **Tested:** a production build and start on one machine with SQLite and with PostgreSQL, uploads against four S3-compatible servers, the setup link, and Node.js 22 and 24. Email was sent through a public mail server with TLS on port 465 and STARTTLS on port 587. The client address was checked behind nginx and behind Caddy, alone and with a second proxy in front standing in for a CDN, using the examples in this guide without their certificates. The 11 MB body limit was checked on nginx.
- **Not yet tested by the project:** a real CDN, a CDN that sends its own header with the visitor's address, the proxies' HTTPS setup, the systemd unit, a PostgreSQL connection pooler, hosted libSQL against a live account, and more than one server at once.

If you run one of the untested setups, the [client address check](#check-the-client-address) is the first thing to confirm.
