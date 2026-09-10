/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-7.3: continuous replication, behind a port.
//
// The framework does not replicate anything: Litestream does, and the framework supervises it.
// So these tests are about the SUPERVISION, which is the part that can be wrong here: does a
// missing binary fail loudly, is starting twice the same as starting once, does a replicator
// that dies say so, and does a restore refuse to overwrite a container.
//
// The process runner is injected, the way the pool double is in T-3.1: a test that needs
// Litestream installed is a test that runs on one machine.
//
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import {
  createLitestreamReplica,
  ReplicaFailedError,
  ReplicaToolMissingError,
  type ProcessRunner
} from '../../lib/database/containers/replica.js'

;(global as any).log = {}

/** A child process that never runs anything, and can be made to exit on command. */
class FakeChild extends EventEmitter {
  killed = false
  stderr = new EventEmitter()
  kill(signal?: string) {
    this.killed = true
    this.emit('exit', signal === 'SIGTERM' ? 0 : 1)
    return true
  }
}

function fakeRunner(over: any = {}) {
  const started: Array<{ command: string; args: string[] }> = []
  const children: FakeChild[] = []
  return {
    started,
    children,
    runner: {
      spawn: (command: string, args: string[]) => {
        started.push({ command, args })
        const child = new FakeChild()
        children.push(child)
        // A restore is expected to finish; a replication is expected to keep running.
        if (args[0] === 'restore') setImmediate(() => child.emit('exit', over.restoreFails ? 1 : 0))
        return child as never
      },
      check: async () => {
        if (over.missing) throw new Error('command not found')
      }
    } as ProcessRunner
  }
}

/**
 * The machine `code` of a rejection.
 *
 * Asserted alongside the class because they are not the same promise: the class name is
 * internal and a consumer never sees it, while the code travels in the response body and is
 * what a client branches on. A test that pins only the class lets the contract change silently.
 */
const codeOfRejection = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e: any) {
    return e?.code ?? 'NO_CODE'
  }
  return 'NO_ERROR'
}

describe('replica · supervising Litestream (T-7.3)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-replica-'))
    file = path.join(dir, 'acme.db')
    fs.writeFileSync(file, 'SQLite format 3')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('replicates the file to the configured destination', async () => {
    const { runner, started } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    const status = await replica.start('acme', file)
    expect(status.running).toBe(true)
    expect(started[0].command).toBe('litestream')
    expect(started[0].args).toEqual(['replicate', file, 's3://backups/tenants/acme'])
    await replica.shutdown()
  })

  it('refuses to run when the binary is not there', async () => {
    const { runner } = fakeRunner({ missing: true })
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    // A container the deployment believes is being copied, and is not, is worse than one
    // nobody promised to copy.
    await expect(replica.start('acme', file)).rejects.toThrow(ReplicaToolMissingError)
    expect(await codeOfRejection(replica.start('acme', file))).toBe('REPLICA_TOOL_MISSING')
    await expect(replica.restore('acme', path.join(dir, 'restored.db'))).rejects.toThrow(ReplicaToolMissingError)
  })

  it('is the same whether it is started once or twice', async () => {
    const { runner, started } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    await replica.start('acme', file)
    await replica.start('acme', file)
    expect(started.length).toBe(1)
    await replica.shutdown()
  })

  it('refuses to replicate a container that is not there', async () => {
    const { runner } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)
    await expect(replica.start('ghost', path.join(dir, 'missing.db'))).rejects.toThrow(/no container file/)
  })

  it('notices when the replicator dies, instead of reporting it as running', async () => {
    const { runner, children } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    await replica.start('acme', file)
    expect(replica.status('acme')?.running).toBe(true)

    // A replicator that dies quietly is the failure this whole task exists to avoid.
    children[0].emit('exit', 1)
    expect(replica.status('acme')?.running).toBe(false)
    await replica.shutdown()
  })

  it('stops the copy on request, and on shutdown', async () => {
    const { runner, children } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    await replica.start('acme', file)
    await replica.start('globex', file)
    expect(replica.list().length).toBe(2)

    await replica.stop('acme')
    expect(replica.status('acme')).toBe(null)

    await replica.shutdown()
    expect(children.every((c) => c.killed)).toBe(true)
    expect(replica.list()).toEqual([])
  })

  it('restores into a new file, and refuses to restore over one', async () => {
    const { runner, started } = fakeRunner()
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)

    const destination = path.join(dir, 'restored.db')
    await replica.restore('acme', destination)
    expect(started[0].args).toEqual(['restore', '-o', destination, 's3://backups/tenants/acme'])

    // Restoring over a container is not a restore, it is a destruction with an extra step.
    await expect(replica.restore('acme', file)).rejects.toThrow(/would destroy it/)
  })

  it('reports a failed restore as a failure', async () => {
    const { runner } = fakeRunner({ restoreFails: true })
    const replica = createLitestreamReplica({ url: 's3://backups/tenants' }, runner)
    await expect(replica.restore('acme', path.join(dir, 'out.db'))).rejects.toThrow(ReplicaFailedError)
    expect(await codeOfRejection(replica.restore('acme', path.join(dir, 'out.db')))).toBe('REPLICA_FAILED')
  })
})
