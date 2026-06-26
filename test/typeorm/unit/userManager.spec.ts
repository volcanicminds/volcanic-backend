/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import * as bcrypt from 'bcrypt'
import { retrieveUserByPassword } from '../../../lib/database/typeorm/loader/userManager.js'

// Stub QueryRunner whose repository returns the given user from findOneBy.
function fakeRunner(user: any) {
  return { manager: { getRepository: () => ({ findOneBy: async () => user }) } } as any
}

// S6 — constant-time credential check that never reveals whether the email exists.
describe('userManager.retrieveUserByPassword (S6)', () => {
  before(() => {
    ;(global as any).entity = { User: 'User' }
  })

  it('returns null when the user does not exist (no enumeration)', async () => {
    const r = await retrieveUserByPassword('nobody@example.com', 'whatever', fakeRunner(null))
    expect(r).toBeNull()
  })

  it('returns null on wrong password', async () => {
    const password = await bcrypt.hash('correct-horse', 12)
    const r = await retrieveUserByPassword('a@b.com', 'wrong', fakeRunner({ email: 'a@b.com', password }))
    expect(r).toBeNull()
  })

  it('returns the user on correct password', async () => {
    const password = await bcrypt.hash('correct-horse', 12)
    const user = { id: '1', email: 'a@b.com', password }
    const r = await retrieveUserByPassword('a@b.com', 'correct-horse', fakeRunner(user))
    expect(r).toBe(user)
  })

  it('rejects missing parameters', async () => {
    await expect(retrieveUserByPassword('', 'x', fakeRunner(null))).rejects.toThrow()
    await expect(retrieveUserByPassword('a@b.com', '', fakeRunner(null))).rejects.toThrow()
  })
})
