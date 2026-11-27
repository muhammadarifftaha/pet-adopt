import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

/**
 * Every package this app uses that is installed from local source (`workspace:`, `link:` or
 * `file:`), following those packages' own local dependencies too (a plugin's shared helpers).
 * pnpm links each package's dependencies into its own node_modules, which is where they are read.
 */
export function localSourcePackages(packageDir = dirname, found = new Set<string>()): string[] {
  const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as Record<string, Record<string, unknown> | undefined>
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
    if (typeof version !== 'string' || !/^(workspace|link|file):/.test(version) || found.has(name)) continue
    found.add(name)
    localSourcePackages(path.join(packageDir, 'node_modules', name), found)
  }
  return [...found].sort()
}

const isDev = process.env.NODE_ENV !== 'production'
const siteURL = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim()

// Content-Security-Policy for the public site, the admin and the page builder.
//  - Inline scripts stay allowed: Next.js emits inline bootstrap scripts, and a
//    nonce would force every page to render per request, which ends the page caching.
//    Everything else is locked down: no other script origins, no eval in production, no plugins,
//    no framing by other sites, forms and <base> only to this site.
//  - Images come from this site (uploads are served through /media), plus data:/blob: for
//    previews in the admin.
//  - The only thing that may be embedded is a Google Maps embed (see safeMapEmbed in lib/links.ts).
//  - Development also needs eval (React refresh) and websockets (hot reload).
//  - Captcha services (the form builder's spam protection, src/captcha-widget.tsx in the plugin):
//    their scripts, frames and checks, limited to their captcha paths where the service allows it.
//    Fixed here because the CSP is read at start and the chosen service lives in the database;
//    nothing loads from them unless the owner switched protection on.
// Set CSP_REPORT_ONLY=1 to report violations in the browser console without blocking anything.
const CAPTCHA_SCRIPTS = 'https://challenges.cloudflare.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://hcaptcha.com https://*.hcaptcha.com'
const CAPTCHA_FRAMES = 'https://challenges.cloudflare.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://hcaptcha.com https://*.hcaptcha.com'
const CAPTCHA_CONNECT = 'https://www.google.com/recaptcha/ https://hcaptcha.com https://*.hcaptcha.com'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${CAPTCHA_SCRIPTS}`,
  "style-src 'self' 'unsafe-inline' https://hcaptcha.com https://*.hcaptcha.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''} ${CAPTCHA_CONNECT}`,
  // 'self': the admin pages table previews pages in an iframe (/edit/<id>/preview).
  // YouTube (no-cookie) and Vimeo: the Video block, which only frames URLs built by safeVideoEmbed.
  `frame-src 'self' https://www.google.com/maps/ https://www.youtube-nocookie.com https://player.vimeo.com ${CAPTCHA_FRAMES}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // Only meaningful (and safe) when the site is served over HTTPS.
  ...(siteURL.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
].join('; ')

const nextConfig: NextConfig = {
  // Native database drivers and sharp must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ['@countrystatecity/countries', '@libsql/client', 'libsql', 'nodemailer', 'pg', 'sharp', 'undici'],
  // Packages installed from local source (the workspace plugins and SDK, or a plugin in a local
  // folder) ship TypeScript, so Next compiles them. Worked out from package.json, so adding a plugin
  // never needs an edit here. A plugin from npm ships compiled JavaScript and is left out.
  transpilePackages: localSourcePackages(),
  experimental: {
    // Uploads go through server actions; the app allows images up to 10 MB.
    serverActions: { bodySizeLimit: '11mb' },
  },
  images: {
    localPatterns: [
      {
        // Uploaded images are served by src/app/media/[...path]/route.ts.
        pathname: '/media/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Stops other sites from framing the site, the admin or the page builder.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Browsers that have seen the site over HTTPS keep using it for a year, so a later plain-HTTP
          // request cannot be intercepted. Only when the site's own address is https (never for local http).
          ...(siteURL.startsWith('https://') ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
          {
            key: process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },
  // The monorepo root (two levels up): pnpm installs packages there, and the plugin packages in
  // plugins/ and packages/ live outside this app, so Turbopack must be able to read them.
  turbopack: {
    root: path.resolve(dirname, '../..'),
  },
}

export default nextConfig
