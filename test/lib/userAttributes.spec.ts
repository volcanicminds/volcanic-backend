/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The attributes of a user are an input of authorization (a RAG reads `department` to open a
// context), so who may write them is the property under test: an administrator under `users`,
// with the shape every reader relies on, and never the person through the self-service edit.
//
import { expect } from 'expect'
import fastify from 'fastify'
import * as userSchemas from '../../lib/schemas/user.js'
import { updateCurrentUser } from '../../lib/api/users/controller/user.js'

const bag = globalThis as any
bag.log = {}

async function echo() {
  const server = fastify()
  for (const schema of Object.values(userSchemas)) server.addSchema(schema)
  server.post(
    '/users',
    { schema: { body: { $ref: 'userBodySchema#' }, response: { 200: { $ref: 'userSchema#' } } } },
    async (req) => req.body
  )
  server.put('/users/me', { schema: { body: { $ref: 'currentUserBodySchema#' } } }, async (req) => req.body)
  await server.ready()
  return server
}

describe('users · attributes (T-7.4 of volcanic-rag)', () => {
  it('takes a map of lists from an administrator, and answers it back', async () => {
    const server = await echo()
    const attributes = { department: ['sales'], cost_center: ['north', 'south'] }
    const res = await server.inject({ method: 'POST', url: '/users', payload: { email: 'a@acme.test', attributes } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).attributes).toEqual(attributes)
    await server.close()
  })

  it('refuses a name or a value outside the shape', async () => {
    const server = await echo()
    const refused = [
      { Department: ['sales'] },
      { department: [] },
      { department: [''] },
      { department: ['sales', 'sales'] },
      { department: [{ name: 'sales' }] },
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, ['x']]))
    ]
    for (const attributes of refused) {
      const res = await server.inject({ method: 'POST', url: '/users', payload: { email: 'a@acme.test', attributes } })
      expect({ attributes, status: res.statusCode }).toEqual({ attributes, status: 400 })
    }
    await server.close()
  })

  it('drops them from the self-service edit, at the schema and in the controller', async () => {
    const server = await echo()
    const res = await server.inject({ method: 'PUT', url: '/users/me', payload: { username: 'me', attributes: { department: ['management'] } } })
    expect(JSON.parse(res.body)).toEqual({ username: 'me' })
    await server.close()

    const written: any[] = []
    const req: any = {
      user: { id: 'u1' },
      data: () => ({ username: 'me', attributes: { department: ['management'] } }),
      server: { userManager: { updateUserById: async (_c: any, id: string, data: any) => written.push({ id, data }) } },
      control: { kind: 'control' },
      routeOptions: { config: { tenantContext: false } }
    }
    await updateCurrentUser(req, {} as any)
    expect(written).toEqual([{ id: 'u1', data: { username: 'me' } }])
  })
})
