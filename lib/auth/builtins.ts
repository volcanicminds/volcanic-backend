import type { Authenticator } from '../../types/global.js'
import { passwordAuthenticator } from './authenticators/password.js'
import { totpAuthenticator } from './authenticators/totp.js'

// The methods the framework ships, registered before a consumer's (T-12.3).
export { passwordAuthenticator, totpAuthenticator }

export const BUILTIN_AUTHENTICATORS: readonly Authenticator[] = [passwordAuthenticator, totpAuthenticator]
