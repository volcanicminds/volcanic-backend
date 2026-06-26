// Copy non-TS runtime assets that `tsc` does not emit into `dist/`.
// The i18n loader resolves dictionaries relative to the compiled file
// (dist/lib/loader -> dist/lib/locales), so the JSON catalogs MUST be present
// under dist/ at runtime. Without this the published package ships with an
// empty i18n catalog and every translation falls back to its key.
import { cpSync, existsSync } from 'node:fs'

const assets = [
  ['lib/locales', 'dist/lib/locales'],
  // Core declaration files (`.d.ts`) are NOT emitted by `tsc` into `dist/`, but
  // `dist/index.d.ts` re-exports types from `./types/global.js` (which imports
  // `./orm.js`). Without these under `dist/types/`, consumers get unresolved
  // types (attw "Internal resolution error"). The data layer types live in
  // `types/database/typeorm/global.ts` (a real `.ts`, emitted by tsc) → no copy.
  ['types/global.d.ts', 'dist/types/global.d.ts'],
  ['types/orm.d.ts', 'dist/types/orm.d.ts']
]

for (const [from, to] of assets) {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true })
    console.log(`copy-assets: ${from} -> ${to}`)
  }
}
