# EVO stato dei lavori

> **Questo file è lo stato, non il piano.** Cosa fare, con quali file e con quale criterio di
> chiusura, sta in `EVO_FRAMEWORK.md`; le decisioni stanno in `EVO_PUNTI_APERTI.md`. Qui una
> riga per compito e nient'altro: descrivere di nuovo un compito qui significa crearne una
> seconda versione che diverge alla prima modifica.
>
> **Regola unica**: una casella si chiude solo con un'**evidenza citata**, cioè un `file:riga`,
> un identificativo di commit o l'output di un comando. Senza evidenza resta aperta.
>
> Linea di lavoro: branch `develop`, versione bersaglio `5.0.0`, data layer Drizzle.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

**Prossimo passo**: T-0.1 (versione alpha, test nel type-check, job Postgres in CI), poi T-0.2,
il banco nero, che va scritto prima di qualunque codice nuovo e **deve fallire** sul codice
attuale. I contratti sono già fissati: si legge `docs/TESTING_V5.md` §2 e si scrive.

**Prima di toccare qualsiasi cosa**, leggere la sezione 0 di `EVO_FRAMEWORK.md`: dice quali
documenti esistono e in che ordine si leggono.

---

## Fase 0: preparazione e prove

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-0.1 | Branch, versione, catena di verifica, rimozione di TypeORM | `[x]` | `develop` allineato a `main` e pubblicato; versione `5.0.0-alpha.0`; data layer TypeORM rimosso con le suite che ci giravano sopra (resta `test/lib`); Drizzle e i driver come peer opzionali, verificati su Node 24.11; subpath `/typeorm` fuori da `exports`; decoratori tolti dal build; `tsconfig.test.json` mette i test nel type-check senza emetterli in `dist` (D-25); CI su `develop` e prerelease su dist-tag `next`. `npm run check-all` verde, `npm test` 49 verdi. Commit `db20063` e seguente |
| T-0.2 | Banco di prova nero su Postgres reale | `[x]` | `test/e2e-mt-pg/`: harness, app di prova con le due sonde, i sette test di `docs/TESTING_V5.md` §2.4. Script `npm run test:e2e:mt:pg`, job `test-pg` in CI da cui dipende la pubblicazione. **Rosso come deve essere**: fallisce su `db.js` mancante. Verificato il 6 settembre 2026 contro `postgres:16-alpine` con `DB_POOL_MAX=1` |
| T-0.3 | Le specifiche dei contratti | `[x]` | scritte il 6 settembre 2026: `docs/SCHEMA_V5.md`, `MAGIC_QUERY_V5.md`, `MANAGERS_V5.md`, `AUTHORIZATION_V5.md`, `API_V5.md`, `CONFIGURATION_V5.md`, `TESTING_V5.md`. Decisioni nell'appendice di `EVO_PUNTI_APERTI.md` |
| T-0.4 | Verifica della matrice delle combinazioni | `[x]` | sezione 1 di `EVO_FRAMEWORK.md`, quattro combinazioni confermate il 6 settembre 2026 |

## Fase 1: la forma del sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-1.1 | Configurazione `control` e `tenants` | `[ ]` | |
| T-1.2 | Due tipi distinti, `ControlHandle` e `TenantHandle` | `[ ]` | |
| T-1.3 | Porte del data layer e subpath `/db` | `[ ]` | |
| T-1.4 | Matrice di capacità e rifiuto all'avvio | `[ ]` | |
| T-1.5 | Regola su cosa sta nel piano di controllo | `[ ]` | |

## Fase 2: il data layer su Drizzle

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-2.1 | Schema base v5 | `[ ]` | |
| T-2.2 | Adattatore Postgres | `[ ]` | |
| T-2.3 | Adattatore SQLite e libSQL | `[ ]` | |
| T-2.4 | Magic Query v5 | `[ ]` | |
| T-2.5 | Manager riscritti | `[ ]` | |
| T-2.6 | Derivazione di chiave non bloccante | `[ ]` | |

## Fase 3: isolamento del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-3.1 | Contesto tenant senza stato di sessione | `[ ]` | |
| T-3.2 | Il tenant si lega al token | `[ ]` | |
| T-3.3 | Sparisce la connessione globale | `[ ]` | |
| T-3.4 | I job dichiarano il contesto | `[ ]` | |
| T-3.5 | Il tracciamento riceve il contesto | `[ ]` | |
| T-3.6 | La cache non attraversa i contenitori | `[ ]` | |

## Fase 4: identità e ruoli di sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-4.1 | Utenti e ruoli di sistema nel piano di controllo | `[ ]` | |
| T-4.2 | Impersonificazione tracciata | `[ ]` | |
| T-4.3 | «Fondatore» risolto nel contenitore | `[ ]` | |

## Fase 5: migrazioni e flotta

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-5.1 | Motore, formato, collocazione della versione | `[ ]` | |
| T-5.2 | Due insiemi di migrazioni | `[ ]` | |
| T-5.3 | Migratore di flotta, comando e API | `[ ]` | |
| T-5.4 | Controllo di allineamento all'avvio | `[ ]` | |

## Fase 6: ciclo di vita del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-6.1 | Creazione | `[ ]` | |
| T-6.2 | Export del contenitore | `[ ]` | |
| T-6.3 | Distruzione a due fasi | `[ ]` | |

## Fase 7: contenitore per tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-7.1 | Contenitore su Postgres e cache LRU | `[ ]` | |
| T-7.2 | Contenitore su file, SQLite e libSQL | `[ ]` | |
| T-7.3 | Replica continua dietro una porta | `[ ]` | |

## Fase 8: igiene del core e chiusura

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-8.1 | Sicurezza del core (CORS, enumerazione, dipendenze) | `[ ]` | |
| T-8.2 | Raccolta dei difetti minori | `[ ]` | |
| T-8.3 | Guida di migrazione v4 → v5 | `[ ]` | si accumula riga per riga a ogni rottura, non si scrive alla fine |
| T-8.4 | Allineamento di `volcanic-backend-sample` e `volcanic-admin` | `[ ]` | |

---

## Fuori piano, da non perdere

| | Stato | Nota |
|---|---|---|
| Push forzato di `develop` su `origin` | `[ ]` | il remoto è indietro di 209 commit; serve una richiesta esplicita |
| Cartelli sui documenti v4 | `[x]` | `DATA_LAYER_MAGIC.md` e `CONFIGURATION.md` marcati come sostituiti, `AUTH_COMPOSABLE_EVOLUTION.md` come rinviato fuori dalla v5 |
| `docs/AUTHORIZATION_MODEL.md` | `[-]` | resta valido: `AUTHORIZATION_V5.md` lo estende, non lo sostituisce |
| Dipendenze Drizzle installate e verificate su Node 24.11 | `[ ]` | `drizzle-orm`, `drizzle-kit`, `better-sqlite3` (build nativo, da provare), `@libsql/client`. `pg` e `bcrypt` ci sono già |
| `npm audit fix` sulla baseline | `[ ]` | da fare **prima** di aggiungere le dipendenze nuove, altrimenti l'audit successivo non dice più chi ha portato cosa |
| Finestra senza rete di test | `[~]` | aperta il 6 settembre 2026. `check-all` e `npm test` sono verdi, ma restano 49 test su 432: le suite end-to-end si rifanno in fase 2 su `docs/TESTING_V5.md` §1, recuperando gli spec da `main` (`git show main:test/e2e/auth-lifecycle.e2e.spec.ts`). Ripristino del codice vecchio: `git checkout main -- lib/database typeorm.ts` |
| Misure di tempo rifatte su macchina dedicata | `[ ]` | quelle dell'appendice A vengono da un portatile condiviso: non usarle per dimensionare |
