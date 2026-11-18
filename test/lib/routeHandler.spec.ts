/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import Fastify from 'fastify'
import fs from 'fs'
import { registerHooks } from 'module'
import os from 'os'
import path from 'path'
import { Writable } from 'stream'
import { pathToFileURL } from 'url'
import { controllerHandler } from '../../lib/loader/router.js'

//
// Every route handler is wrapped in an async function, because the controller module is
// imported on the first request. A sync controller that answers through `reply.send()` returns
// undefined, and an async wrapper resolving undefined tells Fastify to send again. The second
// send happens while async `preSerialization` hooks are still running (the framework's tracking
// hook plus any project hook), so it wins the race: the client gets its 200, and the log gets
// ERR_HTTP_HEADERS_SENT and a phantom 500 on every request. The defect is only in the log, so
// that is what these assertions read.
//
;(global as any).log = {} // all log.x flags falsy -> silent

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volcanic-route-handler-'))
const controller = path.join(dir, 'probe')
fs.writeFileSync(
  controller + '.js',
  [
    'export function syncSend(_req, reply) { reply.send({ ok: true }) }',
    'export async function asyncReturnSend(_req, reply) { return reply.send({ ok: true }) }',
    'export async function asyncReturnValue() { return { ok: true } }',
    'export function syncReturnValue() { return { ok: true } }'
  ].join('\n')
)

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function serve(func: string) {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString())
      done()
    }
  })
  const server = Fastify({ logger: { level: 'warn', stream } })
  // Two async hooks, as the sample has: each adds microtask turns before the payload is
  // serialized, which is what lets a second send overtake the first.
  server.addHook('preSerialization', async (_req, _reply, payload) => {
    await tick()
    return payload
  })
  server.addHook('preSerialization', async () => {
    await tick()
  })
  server.get('/probe', controllerHandler(controller, func, `probe.${func}`))
  await server.ready()
  const res = await server.inject({ method: 'GET', url: '/probe' })
  await tick()
  await server.close()
  return { res, log: lines.join('') }
}

describe('loader/router: controllerHandler', () => {
  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  for (const func of ['syncSend', 'asyncReturnSend', 'asyncReturnValue', 'syncReturnValue']) {
    it(`answers once when the controller is ${func}`, async () => {
      const { res, log } = await serve(func)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(log).not.toContain('ERR_HTTP_HEADERS_SENT')
      expect(log).not.toContain('already sent')
    })
  }

  it('still refuses a controller method that does not exist', async () => {
    const { res } = await serve('missing')
    expect(res.statusCode).toBe(500)
    expect(res.body).toBe('Invalid handler method probe.missing')
  })

  // Node caches the module anyway, so the only trace of a per-request import() is the loader
  // resolving the specifier again: the resolve hook sees every call.
  it('imports the controller module once, not on every request', async () => {
    const target = pathToFileURL(controller + '.js').href
    let resolves = 0
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === target) resolves++
        return next(specifier, context)
      }
    })
    try {
      const server = Fastify()
      server.get('/probe', controllerHandler(controller, 'syncReturnValue', 'probe.syncReturnValue'))
      await server.ready()
      for (let i = 0; i < 3; i++) {
        expect((await server.inject({ method: 'GET', url: '/probe' })).statusCode).toBe(200)
      }
      await server.close()
    } finally {
      hooks.deregister()
    }
    expect(resolves).toBe(1)
  })

  it('tries a failed import again on the next request', async () => {
    const late = path.join(dir, 'late')
    const server = Fastify()
    server.get('/late', controllerHandler(late, 'syncReturnValue', 'late.syncReturnValue'))
    await server.ready()
    const missing = await server.inject({ method: 'GET', url: '/late' })
    expect(missing.statusCode).toBe(500)
    expect(missing.body).toBe('Invalid handler module late.syncReturnValue')
    fs.writeFileSync(late + '.js', 'export function syncReturnValue() { return { ok: true } }')
    const found = await server.inject({ method: 'GET', url: '/late' })
    await server.close()
    expect(found.statusCode).toBe(200)
    expect(found.json()).toEqual({ ok: true })
  })
})
