import Link from 'next/link'
import { FiAlertTriangle, FiCheckCircle, FiMail } from 'react-icons/fi'

import { Badge } from '@pet-adopt/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import { getEmailPlugin, type PluginInfo } from '@/plugins/registry'
import type { SessionUser } from '@/server/types'

import { SendTestEmail } from './SendTestEmail'

// The built-in page of a plugin that has no home screen of its own (/admin/plugins/<name>): what
// it is, what it adds to the admin, and, for the plugin that sends the site's email, its setup
// (from the plugin's `email.status()`, which never includes secrets) and a test send.

export function PluginOverview({ info, user }: { info: PluginInfo; user: SessionUser }) {
  const email = info.email ? getEmailPlugin() : null
  const status = email?.sender.status?.() ?? null
  const ready = status ? status.ready : true

  const adds = [
    ...info.screens.map((screen) => ({
      key: screen.href,
      kind: 'Screen',
      node: (
        <Link href={screen.href} className="underline underline-offset-4">
          {screen.title}
        </Link>
      ),
    })),
    ...info.widgets.map((title) => ({ key: `widget-${title}`, kind: 'Dashboard card', node: <span>{title}</span> })),
    ...(info.email ? [{ key: 'email', kind: 'Email', node: <span>Sends the site’s email (password reset links)</span> }] : []),
  ]

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {info.description ? <p className="text-sm text-muted-foreground">{info.description}</p> : null}

      {email ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <FiMail aria-hidden />
                Email{status ? ` through ${status.provider}` : ''}
              </CardTitle>
              {ready ? (
                <Badge>
                  <FiCheckCircle aria-hidden />
                  Ready
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <FiAlertTriangle aria-hidden />
                  Not set up
                </Badge>
              )}
            </div>
            <CardDescription>
              {ready
                ? 'The site can send email: people can ask for a password reset link from the sign-in page.'
                : 'The site sends no email until this is set up, so people cannot ask for a reset link by email. An admin can still create one on the Users screen.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {status?.details?.length ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
                {status.details.map((detail) => (
                  <div key={detail.label} className="contents">
                    <dt className="text-muted-foreground">{detail.label}</dt>
                    <dd className="break-words">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {!ready && status?.setup ? (
              <div className="rounded-lg border border-dashed p-3 text-sm">
                <p className="font-medium">To set it up</p>
                <p className="mt-1 text-muted-foreground">{status.setup}</p>
              </div>
            ) : null}
            <SendTestEmail defaultTo={user.email} disabled={!ready} />
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="plugin-adds-heading" className="flex flex-col gap-2">
        <h2 id="plugin-adds-heading" className="font-semibold">
          What it adds
        </h2>
        {adds.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {adds.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.kind}</Badge>
                {item.node}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing visible in the admin besides this page.</p>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Plugin name: <code>{info.name}</code>. Plugins are set up in <code>pet-adopt.config.ts</code>.{' '}
        <Link href="/admin/plugins" className="underline underline-offset-4">
          All plugins
        </Link>
      </p>
    </div>
  )
}
