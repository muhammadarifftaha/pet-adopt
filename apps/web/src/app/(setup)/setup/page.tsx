import Link from 'next/link'
import { can } from '@pet-adopt/plugin-sdk'
import { redirect } from 'next/navigation'

import { EmailConfirmBanner } from '@/components/admin/EmailConfirmBanner'
import { EmailSettingsForm } from '@/components/admin/settings/EmailSettingsForm'
import { SetupAccountForm } from '@/components/setup/SetupAccountForm'
import { SetupDone } from '@/components/setup/SetupDone'
import { SetupNav, SETUP_STEPS, type SetupStep } from '@/components/setup/SetupNav'
import { SetupSampleContent } from '@/components/setup/SetupSampleContent'
import { SetupSiteForm } from '@/components/setup/SetupSiteForm'
import { SetupThemePicker } from '@/components/setup/SetupThemePicker'
import { SkipSetup } from '@/components/setup/SkipSetup'
import { getSettings } from '@/lib/queries'
import { MIN_PASSWORD_LENGTH } from '@/server/auth'
import { getEmailSettingsView } from '@/server/email'
import { needsEmailConfirmation } from '@/server/email-change'
import { hasSampleContent } from '@/server/sample-content'
import { getSessionUser } from '@/server/session'
import { announceSetupLink, ensureSetupLink, hasAccounts, isSetupDone, isSetupKeyValid } from '@/server/setup'
import { getStorage } from '@/server/storage'

export const metadata = { title: 'Set up your site' }

// First-time setup (src/server/setup.ts). With no account yet: the first admin account, with the
// key from the setup link in the server's log. Then, for an admin: the site's basics, a theme,
// sample content and email, each skippable, until it is finished or skipped.
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ key?: string | string[]; step?: string | string[] }> }) {
  const { key, step: rawStep } = await searchParams

  if (!(await hasAccounts())) {
    if (!(await isSetupKeyValid(key))) {
      // Print it again, so the newest lines of the log have it.
      const link = await ensureSetupLink()
      if (link) announceSetupLink(link)
      return (
        <section className="flex flex-col gap-3 rounded-lg border p-6">
          <h1 className="text-xl font-semibold">Set up your site</h1>
          <p>
            This site has no accounts yet. To create the first admin account, open the <strong>setup link</strong> printed in the server’s log (it starts with{' '}
            <code className="break-all">/setup?key=</code>). It was just printed again.
          </p>
          <p className="text-sm text-muted-foreground">Only someone who can read the server’s log has it, so nobody else can claim your new site.</p>
        </section>
      )
    }
    return (
      <>
        <SetupNav current="account" />
        <SetupAccountForm setupKey={key as string} minPasswordLength={MIN_PASSWORD_LENGTH} />
      </>
    )
  }

  const user = await getSessionUser()
  if (!user) redirect('/admin/login?redirect=%2Fsetup')
  if (!can(user.role, 'settings:edit') || (await isSetupDone())) redirect('/admin')
  const step: SetupStep = SETUP_STEPS.some((s) => s.key === rawStep && s.key !== 'account') ? (rawStep as SetupStep) : 'site'
  // With email already working (environment variables), changes wait for a confirmed email.
  const confirmFirst = step !== 'email' && step !== 'done' && (await needsEmailConfirmation(user))

  return (
    <>
      <SetupNav current={step} />
      {confirmFirst ? <EmailConfirmBanner email={user.email} /> : null}
      {step === 'site' ? <SetupSiteForm settings={await getSettings()} /> : null}
      {step === 'theme' ? <SetupThemePicker current={(await getSettings()).theme} /> : null}
      {step === 'sample' ? <SetupSampleContent hasSample={await hasSampleContent()} /> : null}
      {step === 'email' ? (
        <section className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold">Email</h1>
            <p className="text-sm text-muted-foreground">
              The site sends password reset links, invites and form notifications by email. Enter your email provider’s SMTP details, or skip this and do it
              later on Settings &gt; Email. Once email works you are asked to confirm your own address: that email doubles as the test.
            </p>
          </div>
          <EmailSettingsForm initial={await getEmailSettingsView()} />
          <div className="flex justify-end">
            <Link href="/setup?step=done" className="text-sm underline underline-offset-4">
              Continue
            </Link>
          </div>
        </section>
      ) : null}
      {step === 'done' ? (
        <SetupDone
          storage={await getStorage().then((s) => s.describe()).catch(() => null)}
          emailReady={(await getEmailSettingsView()).ready}
          needsConfirmation={await needsEmailConfirmation(user)}
          email={user.email}
        />
      ) : null}
      {step !== 'done' ? <SkipSetup /> : null}
    </>
  )
}
