//
// Every `user` row the framework creates passes through `createUserWith`, so `onUserCreated` sees
// all of them. A creation path that calls the manager directly would leave the project's own
// table, a profile keyed by `user.id`, without a row for that user, and nothing else would notice.
//
import { expect } from 'expect'
import fs from 'node:fs'
import path from 'node:path'

const LIB = path.resolve(import.meta.dirname, '../../lib')
// The helper itself, and the manager that defines the method.
const ALLOWED = new Set(['util/userCreation.ts', 'database/managers/user.ts'])

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('util/userCreation · one door for every user', () => {
  it('leaves no call to createUser in lib outside createUserWith', () => {
    const offenders = sources(LIB)
      .map((file) => path.relative(LIB, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => /\.createUser\(/.test(fs.readFileSync(path.join(LIB, file), 'utf8')))
    expect(offenders).toEqual([])
  })
})
