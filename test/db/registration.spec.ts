/* eslint-disable @typescript-eslint/no-explicit-any */
//
// `createUser` with `created`: the user and the project's own row, such as a profile keyed by
// `user.id`, are written together or not at all. On PGlite, where a call on the outer handle
// waits for the open transaction: the taken-address lookup must run after it, or never returns.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { start, access } from '../../db.js'

const PASSWORD = 'pw-123456789'

describe('database/managers/user · createUser with the project part of a registration', function () {
  this.timeout(60000)
  let layer: any
  let control: any

  const rows = async (text: string) => (await access(control, 'test').execute(sql.raw(text))).rows
  const profileOf = (tx: any, user: any, firstName: string) =>
    access(tx, 'test').execute(sql`insert into user_profile (user_id, first_name) values (${user.id}, ${firstName})`)

  before(async () => {
    layer = await start({ control: { engine: 'pglite' } } as any)
    await layer.migrations.apply({ locator: 'public' })
    control = layer.provider.control()
    await access(control, 'test').execute(sql.raw('create table user_profile (user_id uuid primary key, first_name text not null)'))
  })

  after(async () => {
    await layer?.shutdown()
  })

  it('commits the user and the project row together, the row written through the transaction', async () => {
    const user = await layer.userManager.createUser(control, { email: 'anna@acme.test', password: PASSWORD }, (tx: any, created: any) =>
      profileOf(tx, created, 'Anna')
    )
    expect(await rows(`select first_name from user_profile where user_id = '${user.id}'`)).toEqual([{ first_name: 'Anna' }])
  })

  it('leaves no user when the project part throws', async () => {
    const failing = layer.userManager.createUser(control, { email: 'bruno@acme.test', password: PASSWORD }, async (tx: any, created: any) => {
      await profileOf(tx, created, 'Bruno')
      throw new Error('consent missing')
    })
    await expect(failing).rejects.toThrow('consent missing')
    expect(await layer.userManager.retrieveUserByEmail(control, 'bruno@acme.test')).toBeNull()
    expect(await rows(`select count(*)::int as n from user_profile`)).toEqual([{ n: 1 }])
  })

  it('answers a taken address as before, without running the project part', async () => {
    let ran = false
    const taken = layer.userManager.createUser(control, { email: 'Anna@Acme.test', password: PASSWORD }, async () => {
      ran = true
    })
    await expect(taken).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' })
    expect(ran).toBe(false)
  })

  it('rethrows a collision of the project row as it is, not as a taken address', async () => {
    const [{ user_id: existing }] = await rows('select user_id from user_profile limit 1')
    const clash = layer.userManager.createUser(control, { email: 'carla@acme.test', password: PASSWORD }, (tx: any) =>
      profileOf(tx, { id: existing }, 'Carla')
    )
    await expect(clash).rejects.not.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' })
    expect(await layer.userManager.retrieveUserByEmail(control, 'carla@acme.test')).toBeNull()
  })
})
