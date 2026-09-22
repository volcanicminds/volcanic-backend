import crypto from 'crypto'
import type { AuthFlow, AuthFlowExternal, AuthFlowManagement, ExternalAuthResult } from '../../../types/global.js'

//
// An in-memory flow store with the semantics of the real one (lib/database/managers/authFlow.ts):
// hashed secrets, one proven flow per subject, `version` moved only by `advance` and retirement,
// retirement instead of deletion, the attempts ceiling shared by codes and reservations. The SQL
// is exercised on real engines in test/db/authFlow.spec.ts; this is what the engine and the routes
// run on in memory.
//
const hash = (value: string) => crypto.createHash('sha256').update(String(value)).digest('hex')
const mac = (secret: string, code: string) => crypto.createHmac('sha256', secret).update(code).digest('hex')

export interface FakeFlowRow extends AuthFlow {
  secretHash: string
  stateHash: string | null
  challengeHash: string | null
}

export function fakeFlowStore() {
  const rows = new Map<string, FakeFlowRow>()
  const live = (row: FakeFlowRow | undefined, now = new Date()) => !!row && row.secretHash !== '' && new Date(row.expiresAt) > now
  const view = (row: FakeFlowRow): AuthFlow => {
    const { secretHash, stateHash, challengeHash, ...flow } = row
    void secretHash
    void stateHash
    void challengeHash
    return structuredClone(flow)
  }
  const retire = (row: FakeFlowRow) => {
    row.secretHash = ''
    row.stateHash = null
    row.challengeHash = null
    row.external = null
    row.candidateSubjectId = row.candidateSubjectId ?? row.subjectId
    row.subjectId = null
    row.expiresAt = new Date()
    row.version += 1
  }
  const evict = (subjectId: string, scope: string, keep: string) => {
    for (const row of rows.values()) if (row.subjectId === subjectId && row.scope === scope && row.flowId !== keep) retire(row)
  }
  const mine = (flowId: string, secret: string) => {
    const row = rows.get(flowId)
    return row && row.secretHash === hash(secret) && live(row) ? row : undefined
  }

  const manager: AuthFlowManagement = {
    isImplemented: () => true,

    async openFlow(_ctx, data) {
      if (data.subjectId) evict(data.subjectId, data.scope, data.flowId)
      const row: FakeFlowRow = {
        id: `row-${rows.size + 1}`,
        flowId: data.flowId,
        scope: data.scope,
        subjectId: data.subjectId ?? null,
        candidateSubjectId: data.candidateSubjectId ?? null,
        flowName: data.flowName ?? null,
        stageIndex: 0,
        satisfied: [],
        challengeMethod: null,
        challengeExpiresAt: null,
        challengeAttempts: 0,
        challengeSends: 0,
        lastSentAt: null,
        external: null,
        externalResult: null,
        version: 0,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        createdAt: new Date(),
        expiresAt: new Date(data.expiresAt),
        secretHash: hash(data.secret),
        stateHash: null,
        challengeHash: null
      }
      rows.set(row.flowId, row)
      return view(row)
    },

    async findBySecret(_ctx, flowId, secret) {
      const row = rows.get(flowId)
      if (!row || row.secretHash === '' || row.secretHash !== hash(secret)) return { outcome: 'unknown' }
      return new Date(row.expiresAt) > new Date() ? { outcome: 'current', flow: view(row) } : { outcome: 'expired', flow: view(row) }
    },

    async findByState(_ctx, state) {
      const row = [...rows.values()].find((r) => r.stateHash === hash(state))
      return row && live(row) ? view(row) : null
    },

    async advance(_ctx, flowId, version, patch) {
      const row = rows.get(flowId)
      if (!row || row.version !== version || !(new Date(row.expiresAt) > new Date())) return null
      if (patch.subjectId) evict(patch.subjectId, row.scope, flowId)
      if (patch.subjectId !== undefined) row.subjectId = patch.subjectId
      if (patch.candidateSubjectId !== undefined) row.candidateSubjectId = patch.candidateSubjectId
      if (patch.flowName !== undefined) row.flowName = patch.flowName
      if (patch.stageIndex !== undefined) row.stageIndex = patch.stageIndex
      if (patch.satisfied !== undefined) row.satisfied = [...patch.satisfied]
      row.version += 1
      return view(row)
    },

    async recordChallenge(_ctx, flowId, data) {
      const row = mine(flowId, data.secret)
      if (!row || row.challengeSends >= data.limits.perFlow) return { outcome: 'limit', scope: 'flow', retryAt: null }
      row.challengeMethod = data.method
      row.challengeHash = mac(data.secret, data.code)
      row.challengeExpiresAt = new Date(data.expiresAt)
      row.challengeSends += 1
      row.lastSentAt = new Date()
      return { outcome: 'sent', sends: row.challengeSends, resendAt: row.challengeSends >= data.limits.perFlow ? null : new Date() }
    },

    async consumeChallenge(_ctx, flowId, data) {
      const row = mine(flowId, data.secret)
      if (!row || !row.challengeHash || !(new Date(row.challengeExpiresAt as Date) > new Date())) return { outcome: 'expired' }
      if (row.challengeAttempts >= data.maxAttempts) return { outcome: 'exhausted' }
      if (row.challengeHash === mac(data.secret, data.code)) {
        row.challengeHash = null
        row.challengeExpiresAt = null
        return { outcome: 'ok' }
      }
      row.challengeAttempts += 1
      const remaining = data.maxAttempts - row.challengeAttempts
      return remaining > 0 ? { outcome: 'invalid', remaining } : { outcome: 'exhausted' }
    },

    async recordAttempt(_ctx, flowId, data) {
      const row = mine(flowId, data.secret)
      if (!row || row.challengeAttempts >= data.maxAttempts) return { outcome: 'exhausted' }
      row.challengeAttempts += 1
      return { outcome: 'counted', remaining: data.maxAttempts - row.challengeAttempts }
    },

    async bindExternal(_ctx, flowId, data: { state?: string | null; external: AuthFlowExternal }) {
      const row = rows.get(flowId)
      if (!live(row)) return false
      row!.external = structuredClone(data.external)
      if (data.state !== undefined) row!.stateHash = data.state === null ? null : hash(data.state)
      return true
    },

    async recordExternalResult(_ctx, flowId, result: ExternalAuthResult) {
      const row = rows.get(flowId)
      if (!live(row) || row!.externalResult) return false
      row!.externalResult = structuredClone(result)
      row!.stateHash = null
      return true
    },

    async completeFlow(_ctx, flowId) {
      const row = rows.get(flowId)
      if (!row || row.secretHash === '') return false
      retire(row)
      return true
    },

    async cancelFlow(_ctx, flowId) {
      return manager.completeFlow(_ctx, flowId)
    },

    async purgeExpired(_ctx, before) {
      const cutoff = before ? new Date(before) : new Date()
      let removed = 0
      for (const [id, row] of rows) {
        if (new Date(row.expiresAt) <= cutoff && (!row.lastSentAt || new Date(row.lastSentAt).getTime() <= cutoff.getTime() - 86_400_000)) {
          rows.delete(id)
          removed += 1
        }
      }
      return removed
    }
  }

  return { manager, rows }
}
