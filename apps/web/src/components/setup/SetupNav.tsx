import Link from 'next/link'
import { FiCheck } from 'react-icons/fi'

// The steps of the first-time setup, in order (src/app/(setup)/setup/page.tsx). Steps after the
// account are links, so any can be visited or skipped.
export const SETUP_STEPS = [
  { key: 'account', label: 'Your account' },
  { key: 'site', label: 'Your site' },
  { key: 'theme', label: 'Theme' },
  { key: 'sample', label: 'Sample content' },
  { key: 'email', label: 'Email' },
  { key: 'done', label: 'Done' },
] as const

export type SetupStep = (typeof SETUP_STEPS)[number]['key']

export function SetupNav({ current }: { current: SetupStep }) {
  const index = SETUP_STEPS.findIndex((step) => step.key === current)
  return (
    <nav aria-label="Setup steps">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {SETUP_STEPS.map((step, i) => {
          const here = step.key === current
          const linkable = current !== 'account' && step.key !== 'account'
          const done = i < index
          // Steps before this one are passed (done or skipped): a tick, and words for screen readers.
          const label = (
            <>
              {done ? <FiCheck aria-hidden className="mr-1 inline size-3.5" /> : null}
              {`${i + 1}. ${step.label}`}
              {done ? <span className="sr-only"> (done or skipped)</span> : null}
            </>
          )
          return (
            <li key={step.key} className={here ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
              {linkable && !here ? (
                <Link href={`/setup?step=${step.key}`} className="underline underline-offset-4 hover:text-foreground">
                  {label}
                </Link>
              ) : (
                <span aria-current={here ? 'step' : undefined}>{label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
