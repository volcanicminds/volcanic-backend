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
      name: 'federation-libraries-lazy-only',
      comment:
        'Le librerie di federazione (OIDC oggi, SAML domani) sono peer facoltative: si caricano solo con ' +
        "await import(), mai con un import statico, o l'avvio fallirebbe anche dove nessun piano le usa (F42)",
      severity: 'error',
      from: {},
      to: {
        path: '(^|/)node_modules/(openid-client|oauth4webapi|@node-saml|samlify)(/|$)',
        dependencyTypesNot: ['dynamic-import', 'type-only']
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
