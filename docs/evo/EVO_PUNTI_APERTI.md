# EVO punti aperti e regole in vigore

> Le regole del backend v5 stanno nelle specifiche: `docs/*_V5.md`, `llms.txt`, `README.md`,
> `docs/CACHE.md` e `docs/TUNING.md`. Qui restano solo i punti ancora aperti e le poche regole
> che nessuna specifica dice. Dove una regola qui diverge da una specifica, si corregge una delle
> due: non convivono.

---

## Punti aperti

1. **Misure su macchina dedicata.** Il banco di taratura (`npm run tune`, T-9.4) misura bcrypt,
   cache LRU e rate limit, con risultati e provenienza in `docs/TUNING.md`, e nessun default ne
   dipende per ora. La misura disponibile è forzata con `--force` su un portatile di sviluppo con
   carico 3,52 su 10 core, e `connections` non è misurata perché senza `DATABASE_URL` non c'è un
   server vero. Resta da rifare su una macchina dedicata, con `DATABASE_URL`.
2. **Manifest filtrato per ruolo.** Il manifest è uguale per tutti i chiamanti dello stesso piano
   (`docs/API_V5.md`, `llms.txt`), perché filtrarlo per ruolo renderebbe il manifest pinnato
   dell'admin dipendente da chi lo scarica. È aperto se il costo vale la riduzione di superficie.
3. **Sorte di `develop` e `main`**: tabella «Fuori piano» di `EVO_STATO.md`.

---

## Regole in vigore

- **v5 è breaking.** Nessuna finestra di deprecazione e nessun doppio percorso di
  compatibilità: la rottura è dichiarata nel numero di versione. Chi resta su v4 ha la guida
  tecnica di migrazione (`docs/MIGRATION_V4_V5.md`); l'assistenza al porting si dà solo su
  richiesta esplicita del progetto.
- **Chiavi di configurazione.** Le chiavi storiche restano in snake_case (`mfa_policy`,
  `allow_multiple_admin`, `export_directory` e simili); i blocchi della v5 e ogni chiave nuova
  sono camelCase (`control`, `tenants`, `manifest`, `cache`). Nessuna chiave esistente si rinomina
  nella 5.0, perché una chiave rinominata diventa ignorata in silenzio invece di dare errore.
- **Header e cookie insieme.** Quando una richiesta porta sia l'header `Authorization` sia il
  cookie, vale l'header: è la credenziale esplicita di un programma, il cookie quella ambientale
  di un browser, e rifiutare entrambi romperebbe lo Swagger usato da un browser già loggato.
