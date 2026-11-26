import Link from 'next/link'
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
          const label = `${i + 1}. ${step.label}`
          return (
            <li key={step.key} className={here ? 'font-semibold text-foreground' : i < index ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>
              {linkable && !here ? (
                <Link href={`/setup?step=${step.key}`} className="no-underline hover:underline">
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
