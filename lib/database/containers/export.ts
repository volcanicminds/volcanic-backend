/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

//
// Moving a container's SQL between Postgres and a file, through `pg_dump` and `psql`.
//
// Three refusals, and they are the whole design:
//
//   - **a missing tool is a failure, not a smaller export.** If `pg_dump` or `psql` is not on
//     the path, or exits non-zero, the operation fails. An export that "mostly worked" is worse
//     than none: it is a backup somebody will trust;
//   - **the caller never chooses a path or a server.** The provider passes its own connection
//     string, and the file is one the core created inside the configured directory;
//   - **a dump is read line by line before `psql` sees it.** Outside a `COPY` block a line that
//     starts with a backslash is a `psql` meta-command, and a meta-command runs on the machine,
//     not in the database: a package that carries one is refused, whoever wrote it.
//

/** The schema a package's dump names under the `schema` strategy, in place of the tenant's locator. */
export const PACKAGE_SCHEMA = 'vm_package'

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

/** A dump that does not load back to the rows it was made from, or carries a line `psql` would run on the machine. */
export class RestoreIntegrityError extends Error {
  readonly code = 'RESTORE_INTEGRITY_FAILED'
  constructor(message: string) {
    super(`The package does not restore to what it recorded: ${message}`)
    this.name = 'RestoreIntegrityError'
  }
}

/** Fails with the tool's name when it is not installed: the one failure a retry never fixes. */
export async function requireTools(...tools: string[]): Promise<void> {
  for (const tool of tools) await finished(tool, spawn(tool, ['--version'], { stdio: 'ignore' }))
}

/**
 * The exit of a child process, as a promise. `ENOENT` is the tool missing. A `pg_dump` older than
 * the server refuses to dump it, which is the same situation: the tool on this machine cannot
 * produce this export, and saying so with the two versions is what tells an operator to install
 * the right client instead of debugging their schema.
 */
function finished(tool: string, child: ReturnType<typeof spawn>): Promise<void> {
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += String(chunk)
  })
  return new Promise((resolve, reject) => {
    child.on('error', (error: any) => reject(error?.code === 'ENOENT' ? new ExportToolMissingError(tool) : new ExportFailedError(error?.message)))
    child.on('close', (code) => {
      if (code === 0) return resolve()
      const reason = stderr.trim().split('\n')[0] || `${tool} exited with ${code}`
      if (/server version/i.test(reason) && /pg_dump version/i.test(reason)) {
        return reject(new ExportToolMissingError(`pg_dump (${reason.replace(/^pg_dump: error: /, '')})`))
      }
      reject(new ExportFailedError(reason))
    })
  })
}

/**
 * Runs `tool` with `args` while `use` consumes or feeds its streams, and settles when both are
 * done. A failure on either side ends the process, so no half-fed `psql` commits and no `pg_dump`
 * writes on after its reader is gone.
 */
async function running(tool: string, args: string[], use: (child: ChildProcess) => Promise<void>): Promise<void> {
  const child = spawn(tool, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const exit = finished(tool, child)
  try {
    await Promise.all([use(child), exit])
  } catch (error) {
    // A pipe that broke is the process that died, and its own words say why.
    if (['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes((error as any)?.code)) {
      const exited = await exit.then(() => null, (e) => e)
      if (exited) throw exited
    }
    child.kill()
    await exit.catch(() => undefined)
    throw error
  }
}

/**
 * `pg_dump` of `url`: one schema, or the whole database when `schema` is null.
 * `--no-owner --no-privileges`: the roles of this server mean nothing where the dump is loaded.
 */
const dumpArgs = (url: string, schema: string | null) => [
  ...(schema ? ['--schema', schema] : []),
  '--no-owner',
  '--no-privileges',
  '--dbname',
  url
]

/** The dump of `url` and `schema`, through `rewrite`, into `sink`. */
export async function dumpInto(url: string, schema: string | null, rewrite: Transform, sink: Writable): Promise<void> {
  await running('pg_dump', dumpArgs(url, schema), (child) => pipeline(child.stdout!, rewrite, sink))
}

/** `source`, through `rewrite`, into `psql` on `url`, in ONE transaction: a failure leaves nothing loaded. */
export async function loadFrom(url: string, source: Readable, rewrite: Transform): Promise<void> {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--dbname', url]
  await running('psql', args, (child) => {
    child.stdout!.resume()
    return pipeline(source, rewrite, child.stdin!)
  })
}

/** One container straight into another, renamed on the way: nothing is written to a disk. */
export async function copyContainer(fromUrl: string, fromSchema: string | null, toUrl: string, toSchema: string | null): Promise<void> {
  await running('pg_dump', dumpArgs(fromUrl, fromSchema), (child) => loadFrom(toUrl, child.stdout!, rebase(fromSchema, toSchema)))
}

/**
 * The lines of a plain `pg_dump`, with the schema `from` renamed `to`, and every meta-command
 * refused but the two `pg_dump` writes itself (`\restrict` and `\unrestrict`).
 *
 * The rename is lexical: the name as a whole identifier, bare or quoted, outside `COPY` data,
 * whose lines are the customer's values and pass untouched. A table or column with the exact name
 * of the schema would be renamed too; locators are `tenant_<slug>` and the package's is fixed, so
 * neither collides with a table of the framework. `CREATE SCHEMA` gains `IF NOT EXISTS`: the
 * provider creates the container before loading into it, under both strategies.
 */
export function rebase(from: string | null, to: string | null): Transform {
  const quoted = (name: string) => `"${name}"`
  const pattern =
    from && to
      ? new RegExp(`(?<![A-Za-z0-9_$".])(?:${quoted(from)}${/^[a-z_][a-z0-9_]*$/.test(from) ? `|${from}` : ''})(?![A-Za-z0-9_$"])`, 'g')
      : null

  let inCopy = false
  const line = (text: string): string => {
    if (inCopy) {
      if (text === '\\.') inCopy = false
      return text
    }
    if (text.startsWith('\\')) {
      if (/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(text)) return text
      throw new RestoreIntegrityError(`a psql meta-command outside the data: ${text.slice(0, 40)}`)
    }
    let out = pattern ? text.replace(pattern, quoted(to!)) : text
    out = out.replace(/^CREATE SCHEMA (?!IF NOT EXISTS )/, 'CREATE SCHEMA IF NOT EXISTS ')
    if (/^COPY .* FROM stdin;$/.test(out)) inCopy = true
    return out
  }

  // A chunk may end inside a multi-byte character: the decoder holds it for the next one.
  const decoder = new StringDecoder('utf8')
  let rest = ''
  return new Transform({
    transform(chunk, _encoding, done) {
      try {
        const lines = (rest + decoder.write(chunk)).split('\n')
        rest = lines.pop()!
        done(null, lines.map((l) => line(l) + '\n').join(''))
      } catch (error) {
        done(error as Error)
      }
    },
    flush(done) {
      try {
        rest += decoder.end()
        done(null, rest ? line(rest) : '')
      } catch (error) {
        done(error as Error)
      }
    }
  })
}
