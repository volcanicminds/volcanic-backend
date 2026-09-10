/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

//
// Continuous replication of a file container (T-7.3).
//
// The decision this file implements is mostly a decision NOT to write something. Replicating a
// SQLite database continuously means shipping WAL frames, tracking generations, handling
// restarts and torn writes, and getting the restore right on the day it matters. Litestream is
// an existing binary that does exactly that and has been doing it for years, so the framework
// supervises it and does not reimplement it (decision 8).
//
// What the framework owns is the PORT: one interface, so a deployment that needs something
// else later replaces an adapter instead of a design. Litestream is the first and, for the
// cases this framework plans for (files in the clear), the only implementation. A future
// project that needs page-encrypted files is a project, not a variant: Litestream cannot do it
// and pretending the port makes it possible would be a promise the adapter cannot keep.
//
const run = promisify(execFile)

export interface ReplicaTarget {
  /** Where the copies go: `s3://bucket/prefix`, `file:///var/backups`, anything Litestream takes. */
  readonly url: string
  /** The binary. Named rather than assumed, because an operator may ship it anywhere. */
  readonly binary?: string
}

export interface ReplicaStatus {
  readonly locator: string
  readonly running: boolean
  readonly since?: string
  readonly url: string
  readonly lastError?: string
}

/**
 * The seam. One implementation today, and the reason it is an interface is the second one.
 */
export interface ReplicaPort {
  /** Begins replicating a container. Idempotent: replicating twice is replicating once. */
  start(locator: string, file: string): Promise<ReplicaStatus>
  stop(locator: string): Promise<void>
  status(locator: string): ReplicaStatus | null
  list(): ReplicaStatus[]
  /** Puts a container back from its replica, into a file that does not exist yet. */
  restore(locator: string, destination: string): Promise<void>
  shutdown(): Promise<void>
}

export class ReplicaToolMissingError extends Error {
  readonly code = 'REPLICA_TOOL_MISSING'
  constructor(binary: string) {
    super(
      `${binary} is not available, and replication was configured. A container that is supposed to be replicated ` +
        'and is not is worse than one nobody promised to replicate: install Litestream, or remove the replica configuration.'
    )
    this.name = 'ReplicaToolMissingError'
  }
}

export class ReplicaFailedError extends Error {
  readonly code = 'REPLICA_FAILED'
  constructor(message: string) {
    super(message)
    this.name = 'ReplicaFailedError'
  }
}

/** Injectable so the port can be tested without the binary, the way the pool double is. */
export interface ProcessRunner {
  spawn(command: string, args: string[]): ChildProcess
  check(command: string): Promise<void>
}

const realRunner: ProcessRunner = {
  spawn: (command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
  check: async (command) => {
    await run(command, ['version'])
  }
}

export function createLitestreamReplica(target: ReplicaTarget, runner: ProcessRunner = realRunner): ReplicaPort {
  const binary = target.binary || 'litestream'
  const live = new Map<string, { child: ChildProcess; status: ReplicaStatus }>()
  let checked = false

  /**
   * Fail-closed, once (invariant 2). A missing binary is not something to discover on the
   * first container: replication was configured, so the deployment believes its data is being
   * copied somewhere, and nothing is.
   */
  const assertBinary = async () => {
    if (checked) return
    try {
      await runner.check(binary)
      checked = true
    } catch {
      throw new ReplicaToolMissingError(binary)
    }
  }

  const replicaUrl = (locator: string) => `${target.url.replace(/\/+$/, '')}/${locator}`

  return {
    async start(locator: string, file: string): Promise<ReplicaStatus> {
      await assertBinary()

      const existing = live.get(locator)
      if (existing?.status.running) return existing.status

      if (!fs.existsSync(file)) {
        throw new ReplicaFailedError(`there is no container file at ${file} to replicate`)
      }

      const url = replicaUrl(locator)
      const child = runner.spawn(binary, ['replicate', file, url])
      const status: ReplicaStatus = { locator, running: true, since: new Date().toISOString(), url }
      const entry = { child, status: { ...status } }
      live.set(locator, entry)

      child.stderr?.on('data', (chunk: Buffer) => {
        const line = String(chunk).trim()
        if (line && log?.w) log.warn(`Litestream ${locator}: ${line}`)
        entry.status = { ...entry.status, lastError: line || entry.status.lastError }
      })

      // A replicator that dies quietly is the failure mode this whole task exists to avoid:
      // the deployment goes on believing its containers are copied somewhere.
      child.on('exit', (code) => {
        entry.status = { ...entry.status, running: false }
        if (code !== 0 && log?.e) log.error(`Litestream ${locator}: replication stopped with code ${code}`)
        else if (log?.i) log.info(`Litestream ${locator}: replication stopped`)
      })

      if (log?.i) log.info(`Litestream ${locator}: replicating ${file} to ${url}`)
      return entry.status
    },

    async stop(locator: string): Promise<void> {
      const entry = live.get(locator)
      if (!entry) return
      live.delete(locator)
      entry.child.kill('SIGTERM')
    },

    status: (locator: string) => live.get(locator)?.status ?? null,
    list: () => [...live.values()].map((e) => e.status),

    /**
     * Restores into a file that does not exist yet, and refuses otherwise.
     *
     * Overwriting a container from a replica is not a restore, it is a destruction with an
     * extra step: whatever was in the file is gone and nobody asked. A restore that has to
     * replace something goes through the two-phase destruction first.
     */
    async restore(locator: string, destination: string): Promise<void> {
      await assertBinary()

      if (fs.existsSync(destination)) {
        throw new ReplicaFailedError(`${destination} already exists: restoring over a container would destroy it`)
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })

      const child = runner.spawn(binary, ['restore', '-o', destination, replicaUrl(locator)])
      await new Promise<void>((resolve, reject) => {
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new ReplicaFailedError(`litestream restore exited with code ${code}`))
        )
        child.on('error', (e) => reject(new ReplicaFailedError(String(e?.message || e))))
      })

      if (log?.i) log.info(`Litestream ${locator}: restored into ${destination}`)
    },

    async shutdown(): Promise<void> {
      for (const [locator, entry] of [...live.entries()]) {
        live.delete(locator)
        entry.child.kill('SIGTERM')
      }
    }
  }
}
