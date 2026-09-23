import type { Authenticator } from '../../types/global.js'
import { passwordAuthenticator } from './authenticators/password.js'
import { totpAuthenticator } from './authenticators/totp.js'
import { emailOtpAuthenticator } from './authenticators/emailOtp.js'
import { oidcAuthenticator } from './authenticators/oidc.js'

// The methods the framework ships, registered before a consumer's (T-12.3). A registered method is
// not an offered one: a plane offers what its `authFlows.ts` lists, and the boot refuses a listed
// `email-otp` without a delivery port, and a listed `oidc` without its library.
export { passwordAuthenticator, totpAuthenticator, emailOtpAuthenticator, oidcAuthenticator }

export const BUILTIN_AUTHENTICATORS: readonly Authenticator[] = [
  passwordAuthenticator,
  totpAuthenticator,
  emailOtpAuthenticator,
  oidcAuthenticator
]
