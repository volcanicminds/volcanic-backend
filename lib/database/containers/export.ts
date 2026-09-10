/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Tenant } from '../../../types/global.js'
import type { ExportResult } from '../ports.js'

//
// Taking a customer's data out (T-6.2).
//
// Three refusals, and they are the whole design:
//
//   - **a missing tool is a failure, not a smaller export.** If `pg_dump` is not on the path,
//     or exits non-zero, the operation fails and the partial file is removed. An export that
//     "mostly worked" is worse than none: it is a backup somebody will trust;
//   - **the caller never chooses a path.** The destination is a configured directory and the
//     file name is generated. A route that takes a filesystem path from a request is a path
//     traversal with extra steps, and this route is reachable by an operator over HTTP;
//   - **the export states its schema version.** A dump whose version is unknown can be
//     restored into a container the code no longer matches, and nothing would say so until
//     the data did.
//
const run = promisify(execFile)

export const DEFAULT_EXPORT_DIRECTORY = './data/exports'

export interface ExportRequest {
  /** Where exports live. Configured, never taken from a request. */
  directory?: string
  /** The version the container is at, read before the dump starts. */
  schemaVersion: string | null
  /** Connection string, for the engines that need one. */
  url?: string
}

export class ExportToolMissingError extends Error {
  readonly code = 'EXPORT_TOOL_MISSING'
  constructor(tool: string) {
    super(`${tool} is not available: an export cannot be produced, and a partial one will not be written instead.`)
    this.name = 'ExportToolMissingError'
  }
}

export class ExportFailedError extends Error {
  readonly code = 'EXPORT_FAILED'
  constructor(message: string) {
    super(`The export did not complete: ${message}`)
    this.name = 'ExportFailedError'
  }
}

/**
 * The file an export writes to.
 *
 * Built from the tenant, the version and the instant, and resolved INSIDE the configured
 * directory: a slug that tried to climb out of it lands back in, and the caller has no say
 * in either half.
 */
export function exportPath(tenant: Tenant, request: ExportRequest, extension: string): string {
  const root = path.resolve(request.directory || DEFAULT_EXPORT_DIRECTORY)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeSlug = String(tenant.slug || tenant.id).replace(/[^a-z0-9_-]/gi, '')
  const version = (request.schemaVersion || 'no-migration').replace(/[^a-z0-9_-]/gi, '')

  const file = path.resolve(root, `${safeSlug}-${version}-${stamp}.${extension}`)
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ExportFailedError(`the export path escapes ${root}`)
  }

  fs.mkdirSync(root, { recursive: true })
  return file
}

/** Removes what a failed export left behind: a truncated dump is a trap, not a partial result. */
function discard(file: string): void {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    // Reported through the caller's error; nothing here can do better.
  }
}

/**
 * A Postgres container, through `pg_dump`, limited to the schema that holds it.
 *
 * `--schema` and not a whole-database dump: a container's export must contain that customer's
 * data and no trace of anybody else's, which is invariant 7 applied to a file that will be
 * handed to them.
 */
export async function exportPostgresSchema(tenant: Tenant, request: ExportRequest): Promise<ExportResult> {
  try {
    await run('pg_dump', ['--version'])
  } catch {
    throw new ExportToolMissingError('pg_dump')
  }

  const file = exportPath(tenant, request, 'sql')
  const args = [
    '--schema',
    tenant.locator,
    '--no-owner',
    '--no-privileges',
    '--file',
    file,
    ...(request.url ? ['--dbname', request.url] : [])
  ]

  try {
    await run('pg_dump', args, { maxBuffer: 64 * 1024 * 1024 })
  } catch (error: any) {
    discard(file)
    const reason = String(error?.stderr || error?.message || error).split('\n')[0]

    // A `pg_dump` older than the server refuses to dump it, and that is the same situation as
    // not having one: the tool on this machine cannot produce this export. Saying so with the
    // two version numbers is the difference between an operator installing the right client
    // and an operator debugging their schema.
    if (/server version/i.test(reason) && /pg_dump version/i.test(reason)) {
      throw new ExportToolMissingError(`pg_dump (${reason.replace(/^pg_dump: error: /, '')})`)
    }
    throw new ExportFailedError(reason)
  }

  if (!fs.existsSync(file)) throw new ExportFailedError('pg_dump wrote no file')
  const { size } = fs.statSync(file)
  if (size === 0) {
    discard(file)
    throw new ExportFailedError('pg_dump produced an empty file')
  }

  return { path: file, bytes: size, schemaVersion: request.schemaVersion }
}

/**
 * A file container: checkpoint the WAL, then copy.
 *
 * Without the checkpoint the copy is the database as of the last checkpoint, and the writes
 * that live only in the `-wal` companion are missing: a file that opens cleanly and is quietly
 * out of date, which is the worst shape a backup can have.
 */
export async function exportSqliteFile(
  tenant: Tenant,
  request: ExportRequest,
  source: string,
  checkpoint: () => Promise<void>
): Promise<ExportResult> {
  if (!fs.existsSync(source)) {
    throw new ExportFailedError(`the container file ${source} does not exist`)
  }

  const file = exportPath(tenant, request, 'db')
  try {
    await checkpoint()
    fs.copyFileSync(source, file)
  } catch (error: any) {
    discard(file)
    throw new ExportFailedError(String(error?.message || error))
  }

  const { size } = fs.statSync(file)
  return { path: file, bytes: size, schemaVersion: request.schemaVersion }
}
