import Link from 'next/link'
import React from 'react'
import { FiAlertTriangle } from 'react-icons/fi'

// Shown on the forms screen and in "New form" until the site has a live privacy policy page
// (agreed with the owner: a warning, not a block, so forms can be drafted while it is written).
// Forms collect personal data, and people must be told how it is used where they type it.
export function PrivacyWarning({ settingsHref, canChoose }: { settingsHref: string | null; canChoose: boolean }) {
  return (
    <div role="note" className="flex gap-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 text-sm">
      <FiAlertTriangle aria-hidden className="mt-0.5 size-4 flex-none text-amber-700 dark:text-amber-400" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">Publish a privacy policy before collecting answers</p>
        <p className="text-muted-foreground">
          Forms collect personal data (names, emails, phone numbers). Visitors must be told what you collect, why, who
          sees it, and how to ask for it to be corrected or deleted. Write it as a page, publish it, then{' '}
          {canChoose && settingsHref ? (
            <>
              choose it in <Link href={settingsHref} className="underline underline-offset-4">Site settings</Link> (Navigation).
            </>
          ) : (
            'ask an admin to choose it in Site settings.'
          )}{' '}
          Every form and the site footer will then link to it.
        </p>
      </div>
    </div>
  )
}
