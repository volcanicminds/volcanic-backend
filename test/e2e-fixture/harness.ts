/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Consumer-app fixture harness. Boots the framework with the working directory
// pointed at test/fixtures/app, so the file-discovery loaders pick up that app's
// src/: custom roles, a custom-role-gated route + controller, a custom global
// middleware, a schema override, and (lot 2.2) the change-log tracking config.
//
// process.chdir() is safe here: each suite runs in its own mocha process.
//
import path from 'path'
import { fileURLToPath } from 'url'
import { start as startServer } from '../../index.js'
import { start as startDatabase, closeEmbedded, userManager, dataBaseManager } from '../../typeorm.js'
import { UserSchema, UserClass } from '../e2e/userEntity.js'
import { WidgetSchema, WidgetClass, ChangeSchema } from './entities.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/app')

export const ADMIN = { email: 'admin@fx.test', password: 'Admin-pw-12345', roles: ['admin'] }
export const EDITOR = { email: 'editor@fx.test', password: 'Editor-pw-1234', roles: ['editor'], firstName: 'Edie' }
export const PLAIN = { email: 'plain@fx.test', password: 'Plain-pw-12345', roles: ['public'] }

let ds: any
let server: any
let originalCwd: string

async function seedUser(data: any) {
  const u: any = await userManager.createUser(data)
  await userManager.updateUserById(u.id, { confirmed: true, confirmedAt: new Date() } as any)
  return u
}

export async function setup() {
  if (server) return server

  originalCwd = process.cwd()
  process.chdir(FIXTURE_DIR) // loaders discover ./src/* of the consumer app

  ds = await startDatabase({
    type: 'pglite',
    synchronize: false,
    logging: false,
    entities: [UserSchema, WidgetSchema, ChangeSchema]
  })
  await ds.synchronize()
  ;(global as any).entity = { User: UserClass, Widget: WidgetClass, Change: 'Change' }

  await seedUser(ADMIN)
  await seedUser(EDITOR)
  await seedUser(PLAIN)

  // a couple of widgets to list/update
  const wrepo = ds.getRepository(WidgetClass)
  await wrepo.save(wrepo.create({ name: 'alpha', value: 1 }))
  await wrepo.save(wrepo.create({ name: 'beta', value: 2 }))

  server = await startServer({ userManager, dataBaseManager })
  await server.ready()
  return server
}

export async function teardown() {
  if (server) await server.close()
  if (ds?.isInitialized) await ds.destroy()
  await closeEmbedded()
  if (originalCwd) process.chdir(originalCwd)
}

export function app() {
  return server
}

export async function login(email: string, password: string): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

export function widgetByName(name: string) {
  return ds.getRepository(WidgetClass).findOneBy({ name })
}

export function listChanges() {
  return ds.getRepository('Change').find()
}
