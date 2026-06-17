// Copy non-TS runtime assets that `tsc` does not emit into `dist/`.
// The i18n loader resolves dictionaries relative to the compiled file
// (dist/lib/loader -> dist/lib/locales), so the JSON catalogs MUST be present
// under dist/ at runtime. Without this the published package ships with an
// empty i18n catalog and every translation falls back to its key.
import { cpSync, existsSync } from 'node:fs'

const assets = [['lib/locales', 'dist/lib/locales']]

for (const [from, to] of assets) {
  if (existsSync(from)) {
    cpSync(from, to, { recursive: true })
    console.log(`copy-assets: ${from} -> ${to}`)
  }
}
