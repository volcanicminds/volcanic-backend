module.exports = {
  forbidden: [
    {
      name: 'core-no-datalayer-import',
      comment: 'Il core non deve importare il data layer (lib/database/**) né le sue peer dep',
      severity: 'error',
      from: { path: '^(index\\.ts|lib/(?!database/))' },
      to: { path: '^lib/database/|^typeorm\\.ts$|^(typeorm|bcrypt|pluralize|reflect-metadata|pg)$' }
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
