# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**
(GitHub's private vulnerability reporting).

Include what you found, the steps to reproduce it, the affected version or commit, and the impact you expect.
Please do not test against sites you do not own, and do not access, change or delete data that is not yours.

You can expect an acknowledgement within a few days. This is a volunteer-run project, so fixes are made as
quickly as the maintainer's time allows. We will keep you updated, agree a disclosure date with you, and credit
you in the release notes if you want that.

## Supported versions

The project is pre-1.0. Only the latest commit on `main` receives security fixes.

## Running it safely

- Set every secret in `.env.example` to a long random value (for example `openssl rand -hex 32`) before the
  first production start, and create the first owner account yourself so nobody else can claim it.
- Serve the site over HTTPS, and set `NEXT_PUBLIC_SERVER_URL` to the exact public address.
- If you run a reverse proxy or CDN, make sure the client address header it sets cannot be forged by visitors.
- Use PostgreSQL with a strong password in production and never expose the database port to the internet.
- Never commit `.env`. Keep storage keys scoped to the uploads bucket only.
- Keep dependencies up to date, and review the security headers in `next.config.ts` before adding embeds or
  external scripts.

## Scope

In scope: this repository's code and its default configuration. Out of scope: vulnerabilities in third-party
packages that have no impact here (report those upstream), problems that need a compromised server or an
already-signed-in admin acting maliciously, missing hardening in a deployment's own hosting, and denial of
service from sheer traffic volume.
