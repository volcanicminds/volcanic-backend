//
// The platform's own identities (T-4.1), described so the console can manage them (T-10.20).
//
// Two schemas, because the two directions are not the same set. What comes back is whatever
// `present()` leaves of a row — the credential columns (`password`, `mfaSecret`,
// `mfaRecoveryCodes`) never leave the process — and what goes in is narrower still: an operator
// is created with an address, a password and control roles, and nothing else about the row is
// editable through a generic write.
//
export const systemUserSchema = {
  $id: 'systemUserSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    externalId: { type: 'string' },
    email: { type: 'string' },
    // Control role codes, always prefixed `system:` (docs/AUTHORIZATION_V5.md §3).
    roles: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockedReason: { type: 'string' },
    blockedAt: { type: 'string' },
    mfaEnabled: { type: 'boolean' },
    version: { type: 'number' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' }
  }
}

export const systemUserBodySchema = {
  $id: 'systemUserBodySchema',
  type: 'object',
  nullable: true,
  // `additionalProperties: false` is the security boundary here and not a nicety: the manager
  // writes the body onto the row as it arrives, minus `password`, `id` and `externalId`, so an
  // undeclared field would be stored exactly as sent. `blocked` and `blockedAt` are absent on
  // purpose — blocking goes through `/block` and `/unblock`, which record the reason — and so is
  // `mfaEnabled`, which is a consequence of enrolling a factor and not a flag to set by hand.
  // `password` is accepted because creation hashes it; an update drops it, so a credential change
  // goes through the password and MFA flows or it does not happen.
  additionalProperties: false,
  properties: {
    email: { type: 'string' },
    password: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } }
  }
}
