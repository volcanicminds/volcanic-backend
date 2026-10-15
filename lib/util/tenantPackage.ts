import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import type { IdentityProvider, Tenant, TenantStrategy } from '../../types/global.js'

//
// The package of a tenant: a folder in the export directory, written by an export and read by an
// import (docs/API_V5.md §6.3).
//
//   <slug>-<version>-<instant>/
//     tenant.sql      the dump, with no credential in it
//     tenant.<name>   what each package of `tenantLifecycles` keeps outside the container
//     manifest.json   every file above with its hash, and what the customer needs to open them
//     envelope.json   the operator's part: the registry row and the identity providers
//
// The manifest is the customer's: it names no id, no locator and no path of this machine. The
// envelope binds itself to the manifest by its hash and travels only with the operator's copy.
//

export const MANIFEST = 'manifest.json'
export const ENVELOPE = 'envelope.json'
export const DUMP = 'tenant.sql'

const PACKAGE_FORMAT = 'volcanic-tenant-package'
const ENVELOPE_FORMAT = 'volcanic-tenant-envelope'
const NAME = /^[A-Za-z0-9_-]+$/

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT
  version: 1
  createdAt: string
  tenant: { name: string; slug: string }
  schemaVersion: string | null
  strategy: TenantStrategy
  engine: string
  /** `schema` is the one the dump creates its tables in; null when it names none and loads into `public`. */
  dump: { file: string; schema: string | null; rowCounts: Record<string, number> }
  /** Every package of `tenantLifecycles` at export time; `file` is null for one that keeps nothing outside the container. */
  packages: { name: string; file: string | null; description: Record<string, unknown> | null }[]
  files: { path: string; bytes: number; sha256: string }[]
}

export interface PackageEnvelope {
  format: typeof ENVELOPE_FORMAT
  version: 1
  manifestSha256: string
  tenant: Tenant
  /** Without their secrets, which never leave: an operator enters each one again after a restore. */
  identityProviders: IdentityProvider[]
}

/** A package that cannot be trusted as it is: missing, altered, or not one at all. */
export class PackageInvalidError extends Error {
  readonly code = 'RESTORE_PACKAGE_INVALID'
  constructor(message: string) {
    super(`The package cannot be used: ${message}`)
    this.name = 'PackageInvalidError'
  }
}

export const exportRoot = (): string => path.resolve(global.config?.options?.export_directory || './data/exports')

/**
 * Creates the folder of a new package and answers its name. Built from the slug, the version, the
 * instant and a random suffix, never from a request; `mkdir` without `recursive` on the last
 * segment, so two exports never share a folder, in the same millisecond either.
 */
export function createPackage(tenant: Tenant, schemaVersion: string | null): { name: string; dir: string } {
  const root = exportRoot()
  fs.mkdirSync(root, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = String(tenant.slug || tenant.id).replace(/[^a-z0-9_-]/gi, '')
  const version = (schemaVersion || 'no-migration').replace(/[^a-z0-9_-]/gi, '')
  const name = `${slug}-${version}-${stamp}-${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  return { name, dir }
}

/** The folder of the package `name`, or null. A name is a file name: anything else is not looked up. */
export function packageDir(name: unknown): string | null {
  if (typeof name !== 'string' || !NAME.test(name)) return null
  const dir = path.join(exportRoot(), name)
  return fs.existsSync(dir) && fs.lstatSync(dir).isDirectory() ? dir : null
}

const sha256 = async (file: string): Promise<string> => {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Every file under `dir`, relative, in a stable order. A link is refused: it points outside what the hashes cover. */
function filesUnder(dir: string, relative = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new PackageInvalidError(`${rel} is a link`)
    if (entry.isDirectory()) out.push(...filesUnder(dir, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** Writes the manifest over every file in `dir`, and answers it with its hash: the hash an export reports. */
export async function sealPackage(
  dir: string,
  body: Omit<PackageManifest, 'format' | 'version' | 'files'>
): Promise<{ manifest: PackageManifest; sha256: string; bytes: number }> {
  const files: PackageManifest['files'] = []
  for (const rel of filesUnder(dir).filter((f) => f !== MANIFEST && f !== ENVELOPE)) {
    const full = path.join(dir, rel)
    files.push({ path: rel, bytes: fs.statSync(full).size, sha256: await sha256(full) })
  }
  const manifest: PackageManifest = { format: PACKAGE_FORMAT, version: 1, ...body, files }
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0)
  return { manifest, sha256: await sha256(path.join(dir, MANIFEST)), bytes }
}

export function writeEnvelope(dir: string, body: Omit<PackageEnvelope, 'format' | 'version'>): void {
  const envelope: PackageEnvelope = { format: ENVELOPE_FORMAT, version: 1, ...body }
  fs.writeFileSync(path.join(dir, ENVELOPE), JSON.stringify(envelope, null, 2), { flag: 'wx' })
}

const readJson = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new PackageInvalidError(`${path.basename(file)} is missing or is not JSON`)
  }
}

/**
 * Reads a package and checks it: the manifest's own format, every file it lists with the bytes
 * and hash it records, no file it does not list, and an envelope bound to this manifest. A hash
 * says a file did not change; whether it restores is the provider's check.
 */
export async function openPackage(dir: string): Promise<{ manifest: PackageManifest; envelope: PackageEnvelope; sha256: string }> {
  const manifest = readJson(path.join(dir, MANIFEST)) as unknown as PackageManifest
  if (manifest.format !== PACKAGE_FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new PackageInvalidError(`${MANIFEST} is not a version 1 ${PACKAGE_FORMAT}`)
  }
  const envelope = readJson(path.join(dir, ENVELOPE)) as unknown as PackageEnvelope
  const digest = await sha256(path.join(dir, MANIFEST))
  if (envelope.format !== ENVELOPE_FORMAT || envelope.version !== 1 || envelope.manifestSha256 !== digest) {
    throw new PackageInvalidError(`${ENVELOPE} does not belong to this manifest`)
  }

  const listed = new Set(manifest.files.map((f) => f.path))
  for (const rel of filesUnder(dir)) {
    if (rel !== MANIFEST && rel !== ENVELOPE && !listed.has(rel)) throw new PackageInvalidError(`${rel} is not in the manifest`)
  }
  for (const file of manifest.files) {
    const full = path.resolve(dir, String(file.path))
    if (!full.startsWith(dir + path.sep) || !fs.existsSync(full)) throw new PackageInvalidError(`${file.path} is missing`)
    if (fs.statSync(full).size !== file.bytes || (await sha256(full)) !== file.sha256) {
      throw new PackageInvalidError(`${file.path} is not the file the manifest records`)
    }
  }
  if (!listed.has(manifest.dump?.file)) throw new PackageInvalidError('the manifest names no dump')
  return { manifest, envelope, sha256: digest }
}

//
// A tar archive of a package, as a stream: the one file an operator downloads. POSIX ustar, which
// every `tar` reads; written here because it is sixty lines and a dependency would be the only one
// the core has for it.
//
const BLOCK = 512

function tarHeader(name: string, size: number, directory: boolean, mtime: number): Buffer {
  let prefix = ''
  let base = name
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155)
    prefix = name.slice(0, cut)
    base = name.slice(cut + 1)
    if (cut <= 0 || Buffer.byteLength(prefix) > 155 || Buffer.byteLength(base) > 100) {
      throw new PackageInvalidError(`${name} is too long for a tar entry`)
    }
  }
  if (size >= 8 ** 11) throw new PackageInvalidError(`${name} is too large for a tar entry`)

  const header = Buffer.alloc(BLOCK)
  const octal = (value: number, offset: number, length: number) =>
    header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii')
  header.write(base, 0, 100, 'utf8')
  octal(directory ? 0o755 : 0o644, 100, 8)
  octal(0, 108, 8)
  octal(0, 116, 8)
  octal(size, 124, 12)
  octal(Math.floor(mtime / 1000), 136, 12)
  header.fill(' ', 148, 156)
  header.write(directory ? '5' : '0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return header
}

/** The package as a tar stream, under a folder named after it, with the files `include` keeps. */
export function tarPackage(dir: string, name: string, include: (relative: string) => boolean): Readable {
  const files = filesUnder(dir).filter(include)
  async function* entries() {
    const made = new Set<string>()
    const folder = (rel: string) => {
      const out: Buffer[] = []
      const parts = rel.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/')
        if (!made.has(sub)) {
          made.add(sub)
          out.push(tarHeader(`${sub}/`, 0, true, Date.now()))
        }
      }
      return out
    }
    for (const rel of files) {
      const full = path.join(dir, rel)
      const { size, mtimeMs } = fs.statSync(full)
      yield* folder(path.posix.dirname(`${name}/${rel}`))
      yield tarHeader(`${name}/${rel}`, size, false, mtimeMs)
      let written = 0
      for await (const chunk of fs.createReadStream(full)) {
        written += (chunk as Buffer).length
        yield chunk as Buffer
      }
      if (written !== size) throw new PackageInvalidError(`${rel} changed while it was read`)
      if (size % BLOCK) yield Buffer.alloc(BLOCK - (size % BLOCK))
    }
    yield Buffer.alloc(BLOCK * 2)
  }
  return Readable.from(entries())
}
