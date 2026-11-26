// Recognising Better Auth's errors in server actions (src/server/actions/auth.ts, two-factor.ts).
import { APIError } from 'better-auth/api'

/**
 * Better Auth's errors. Not `instanceof APIError` alone: inside the Next bundle the error Better Auth
 * throws can come from another copy of the class than the one `better-auth/api` gives us, and the
 * check fails (a wrong password then showed "Something went wrong" and was not logged).
 */
export function isAuthError(error: unknown): error is APIError {
  return error instanceof APIError || (error instanceof Error && error.name === 'APIError' && 'status' in error)
}

/** The error's code (`INVALID_CODE`, `INVALID_PASSWORD`...), or undefined. */
export function authErrorCode(error: APIError): string | undefined {
  const code = (error.body as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : undefined
}
