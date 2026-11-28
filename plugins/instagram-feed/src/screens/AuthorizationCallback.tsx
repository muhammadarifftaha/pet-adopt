import { accessPermission, can, type PluginScreenProps } from '@pet-adopt/plugin-sdk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pet-adopt/ui/components/card'
import Link from 'next/link'

import { AuthorizationCallbackClient } from './AuthorizationCallbackClient'
import { BASE } from './paths'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

// Where Instagram sends the browser back after its sign-in: `?code=…&state=…` when the person
// agreed, `?error=…` when they did not. The code and the state are never drawn. Instagram's own
// `error_description` is not drawn either: anyone can put any text into a link to this screen.
// The screen's access level is `admin`, which audit can view, so people who may not connect get an
// explanation instead of a refused action.
export function AuthorizationCallback({ searchParams, user }: Pick<PluginScreenProps, 'searchParams' | 'user'>) {
  if (!can(user.role, accessPermission('admin', 'edit'))) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>Connecting Instagram</CardTitle>
          <CardDescription>Your role can view the Instagram connection but not change it. Ask an admin or a developer to connect the account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={BASE} className="text-sm underline underline-offset-4">
            Back to Instagram feed
          </Link>
        </CardContent>
      </Card>
    )
  }
  const error = first(searchParams.error)
  return (
    <AuthorizationCallbackClient
      code={first(searchParams.code)}
      state={first(searchParams.state)}
      refused={error ? (error === 'access_denied' ? 'denied' : 'failed') : null}
    />
  )
}
