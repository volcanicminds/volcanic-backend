module.exports = {
  forbidden: [
    {
      name: 'core-no-datalayer-import',
      comment: 'Il core non deve importare il data layer (lib/database/**) né le sue peer dep',
      severity: 'error',
      from: { path: '^(index\\.ts|lib/(?!database/))' },
      // Le peer si confrontano sul percorso RISOLTO (`node_modules/drizzle-orm/index.cjs`), non sul
      // nome del pacchetto: scritte come `^(drizzle-orm|…)$` quella metà della regola non scattava
      // mai, e il confine reggeva solo per `lib/database/` e `db.ts`.
      to: {
        path: '^lib/database/|^db\\.ts$|(^|/)node_modules/(drizzle-orm|better-sqlite3|@libsql/client|bcrypt|pg)(/|$)'
      }
    },
    {
      name: 'datalayer-may-use-core-types-only',
      comment: 'Il data layer può importare SOLO tipi dal core (no valori a runtime)',
      severity: 'warn',
      from: { path: '^lib/database/' },
      to: { path: '^(lib/(?!database/)|index\\.ts)', dependencyTypesNot: ['type-only'] }
    }
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' } }
}
