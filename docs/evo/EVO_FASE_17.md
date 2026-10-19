# EVO fase 17: il pacchetto di un tenant, esportato, verificato e ripristinato

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce il 13 ottobre 2026 da una constatazione: l'export di un tenant esiste (T-6.2, F77, F78) e
> niente lo ricarica. Nessuna prova ripristina un dump, nessuna rotta lo importa, e un export mai
> ripristinato è un backup di cui qualcuno si fiderà. La fase deve servire due casi: il cliente
> che esce o vuole una copia dei suoi dati, e noi che traslochiamo, dismettiamo o ricarichiamo un
> tenant, sulla stessa macchina o su un'altra.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`; la parte di `volcanic-rag`, il corpus
> ripristinato con il tenant, va scritta in `volcanic-rag/TASKS.md`. Le decisioni sono del
> proprietario, prese il 13 ottobre 2026. Il 19 ottobre 2026 il proprietario ha riaperto la fase:
> F82, F83, F84 e F89 rivisti, F92 e F93 nuovi, compiti T-17.10 e T-17.11.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 1. Decisioni

| # | Decisione | Motivo |
|---|---|---|
| F82 | **Un formato, due profili.** Il *pacchetto cliente* porta i dati del tenant e ciò che serve ad aprirli con il solo Postgres: il dump, gli artefatti dei pacchetti (F78) e un manifest. Il *pacchetto operatore* è il pacchetto cliente più una busta interna: la riga di registro del tenant, i suoi provider di identità e la parte interna del manifest. Il primo è un sottoinsieme stretto del secondo, per tutto ciò che scrive il framework; la parte che l'app tratta con il suo aggancio può cambiare con il profilo (F92, F93). Nel pacchetto cliente non entra niente che descriva la piattaforma: né l'id del tenant, né il locator, né un percorso del server | il cliente che esce o chiede una copia ha diritto ai suoi dati e a niente di ciò che li lega al tenant, al piano di controllo o alle macchine di produzione; a noi, per traslocare, dismettere o ricaricare, servono le stesse cose più quel legame, che sta nel piano di controllo e non nel dump: senza la riga di registro e i provider un export non basta a ricreare il tenant altrove; due esportatori distinti divergerebbero, mentre un sottoinsieme si prova con un confronto |
| F83 | **La chiave di cifratura non esce mai**, in nessun profilo e nemmeno separata dal dump. Nessun export contiene testo cifrato del framework: le credenziali (F84) e i segreti dei provider. I dati che l'app tiene nelle sue tabelle, cifrati o no, sono del cliente: il framework non li legge e non li svuota, li tratta l'aggancio dell'app (F92), e senza aggancio viaggiano come sono. Costo accettato: un valore cifrato con `encrypt()` del backend che viaggia com'è non si apre senza la chiave, né dal cliente né dopo un ripristino su un'altra macchina; la consegna di quella chiave, se servirà, passa per altre vie, fuori dal pacchetto | la chiave è una sola per processo (`MFA_DB_SECRET`, con ripiego su `JWT_SECRET`) e cifra il piano di controllo e tutti i tenant: darla a un cliente è dargli quella di tutti gli altri e, con il ripiego, quella che firma i token; un pacchetto senza testo cifrato del framework non dipende da quella chiave per le parti del framework; solo l'app sa quali sue colonne sono cifrate, con quale chiave e che cosa serve al cliente, e un blocco del framework su ogni valore che sembra cifrato deciderebbe al posto suo |
| F84 | **Le credenziali si svuotano, le colonne restano.** Nel pacchetto: `user.mfa_secret` vuoto con `mfa_enabled` falso; `user.password`, che è obbligatoria, con un valore segnaposto che non corrisponde a nessuna password; `user.reset_password_token` e `user.confirmation_token` vuoti; `session` e `auth_flow` senza righe; `identity_provider.secret_enc` vuoto nella busta. Dopo un ripristino l'utente riattiva il secondo fattore dal setup e reimposta la password dal recupero via mail, o la riceve da un amministratore (`POST /users/:id/password/reset`); l'operatore reinserisce il segreto di ogni provider. Sono le credenziali del framework: quelle che l'app tiene nelle sue tabelle le svuota il suo aggancio (F92) | con le colonne al loro posto il dump ha la forma dello schema vivo e si carica senza toccare la struttura; il legame tra un utente e ciò che è suo non sta nel segreto ma nella riga (id, email, ruoli, identità esterne), che viaggia intatta, e il segreto si riscrive sulla stessa riga con i flussi che esistono già; chi entra con un provider esterno non rifà niente, una volta riconfigurato il provider |
| F85 | **Una regola sola per ogni ripristino**, sulla stessa macchina o su un'altra: quella di F83 e F84, senza eccezione per il caso in cui la chiave coincide. Costo accettato: anche dopo un ripristino sulla stessa macchina gli utenti rifanno il secondo fattore | due regole vorrebbero un'impronta della chiave nel manifest, un confronto all'import e due percorsi da provare; con una sola il ripristino non dipende mai da quale chiave ha la macchina di arrivo |
| F86 | **I token di integrazione cambiano `external_id` al ripristino**, tutti quelli del tenant, e una **riemissione** sul singolo token cambia l'`external_id` e mostra il nuovo bearer una volta. Nome, ruoli e scadenza restano. L'`external_id` degli utenti non cambia. Costo accettato: dopo un ripristino ogni integrazione va riconfigurata con il bearer nuovo, la sentinella di `volcanic-rag` compresa | il bearer non è salvato: è un JWT che porta l'`external_id` della riga in `sub` e il tenant in `tid` (F79), e la richiesta trova la riga cercando quel valore; con un valore nuovo i bearer di prima non trovano più niente, sulla stessa macchina come altrove, mentre una riga bloccata tornerebbe valida con il bearer di prima appena sbloccata; oggi il bearer si vede solo alla creazione, quindi senza riemissione ogni token andrebbe ricreato da capo; all'`external_id` di un utente puntano le identità esterne, le sessioni e il registro degli accessi, e le sue sessioni non viaggiano |
| F87 | **La traccia resta sulla macchina di partenza.** Lo stato corrente sta nella riga di registro, la storia in `governance_log` (F76). Si aggiungono: uno stato per il tenant traslocato, con la destinazione; l'hash del manifest nell'evento di export; gli eventi di import, con la provenienza, sulla macchina di arrivo. L'evento di import non si chiama `tenant.restored` | una riga `destroyed` resta già nel registro e ogni export e ogni distruzione scrivono già intento ed esito, ma l'evento cita l'export con un percorso su disco, che non dice se il file è ancora quello; un tenant traslocato non è distrutto e oggi non ha uno stato suo; `tenant.restored` è già la riattivazione di un tenant sospeso o archiviato |
| F88 | **Un deployment con un solo tenant e il piano di controllo restano fuori**: il loro backup è quello dell'infrastruttura, e qui lo si documenta soltanto | lì un cliente è un tenant ed è un'istanza, quindi è padrone della macchina; la copia dell'intero database la fanno già `pg_dump` e i backup gestiti, e rifarla nel framework duplicherebbe l'infrastruttura |
| F89 | **Esportano e scaricano soltanto `system:admin` e l'amministratore del tenant; ripristina e trasloca soltanto `system:admin`.** `system:admin`, nel piano di controllo, esporta e scarica ogni tenant in tutti e due i profili, lo importa e lo trasloca; l'amministratore, con il ruolo `admin` nel piano del tenant, esporta e scarica solo il suo tenant e solo nel profilo cliente, e non ripristina. Nessun altro ruolo, né `system:operator` né un ruolo di sistema dichiarato da un progetto: le quattro rotte del piano di controllo chiedono il ruolo e non un permesso del catalogo, e `tenants:export` esce dal catalogo. Export e download passano dallo step-up (`freshAuth`) e ogni download scrive un evento di governance. Il piano di controllo resta fuori, come in F88 | chi amministra un tenant ha diritto a una copia dei suoi dati senza passare dall'operatore; la busta descrive la piattaforma (F82) e quindi resta a `system:admin`, come il ripristino, che crea una riga nuova nel piano di controllo e vuole il pacchetto operatore; un permesso del catalogo si può dare a qualunque ruolo di sistema, anche a uno dichiarato da un progetto in `src/config/systemRoles.ts` (`lib/loader/roles.ts`), e oggi `tenants` dà a `system:operator` l'import e il trasloco; un export fa uscire tutti i dati di un tenant, più di un'impersonificazione, che già chiede lo step-up, e oggi né l'export né il download lasciano traccia di chi ha preso il pacchetto |
| F90 | **Ogni ripristino scrive una riga nuova, con un id di tenant nuovo**, sulla stessa macchina come dopo un trasloco su un'altra. Una riga `destroyed` resta com'è | `destroyed` è uno stato finale (`EVO_STATO.md`, 27 settembre 2026): riaprire quella riga sarebbe tornare al difetto che quello stato ha chiuso, un tenant di nuovo attivo sopra una storia che lo dice distrutto; con un id nuovo anche dopo un trasloco la regola resta una, come in F85, e l'id di origine sta nella busta, da cui passa all'evento di import come provenienza (F87); nessun bearer in giro porta ancora l'id di prima, perché le sessioni non viaggiano e i token cambiano `external_id` (F86) |
| F91 | **Il ripristino fa impostare all'operatore la password del primo amministratore.** Gli altri utenti la reimpostano come in F84 | dopo un ripristino tutte le password sono segnaposto: se sulla macchina di arrivo la posta non funziona, nel tenant non entra nessuno, nemmeno chi dovrebbe reimpostare le password degli altri; la creazione di un tenant fa già così, con l'amministratore e la sua password nel corpo della richiesta |
| F92 | **L'app tratta i suoi dati con due agganci facoltativi di `TenantLifecycle`.** `pack` gira all'export sulla copia temporanea del contenitore, dopo che il framework ha svuotato le sue credenziali e prima dei conteggi e del dump, e riceve il profilo dell'export (F93): lì l'app decide colonna per colonna se lasciare un valore, scriverlo in chiaro o svuotarlo. `unpack` gira al ripristino, dopo il caricamento e le migrazioni e prima di `restore` o `create`, e cifra di nuovo, con la chiave della macchina di arrivo, ciò che `pack` ha messo in chiaro. Se `pack` dichiara di aver scritto valori da ricifrare, il manifest lo registra e un'app senza `unpack` vede il ripristino rifiutato prima di costruire, come oggi una parte senza `restore`. Un'app senza agganci esporta come oggi | il dato è dell'app e la scelta è sua (F83); sulla copia temporanea l'aggancio non tocca il contenitore vivo e trova le righe già senza le credenziali del framework, e i conteggi di integrità (T-17.5) misurano ciò che entra davvero nel pacchetto; `create` non sa di girare in un ripristino e `restore` gira solo quando c'è una parte su disco, quindi la ricifratura vuole un passo suo; un valore in chiaro rimasto tale dopo un ripristino sarebbe un dato che l'app credeva cifrato, per questo il rifiuto |
| F93 | **Il profilo si sceglie all'export**, obbligatorio in `POST /tenants/:id/export`, e il pacchetto ne porta uno solo, scritto nel manifest; il download consegna quel profilo e non ne prende un altro. L'export della distruzione e quello del trasloco sono `operator`. La busta si scrive sul server in tutti e due i casi; il tar `client` non la contiene. Il ripristino accetta solo un pacchetto `operator` | con `pack` il dump può cambiare con il profilo (F92), mentre oggi il dump si scrive una volta all'export e il profilo si sceglie al download; due dump per ogni export raddoppierebbero spazio, tempo e verifiche per un profilo che spesso nessuno scarica; la busta resta sul server perché il download la usa per riconoscere il tenant del pacchetto e porta la firma; con il profilo obbligatorio nessuno ottiene per distrazione un pacchetto che non si ripristina |

## 2. Compiti

Ogni compito si chiude con le sue prove e con un difetto piantato che le fa cadere, come nella
fase 16.

- [x] **T-17.1** Il manifest (F82). Accanto al dump, un file che elenca ogni file del pacchetto
  con il suo hash, la versione di schema (oggi sta solo nel nome del file), la strategia e ciò che
  ogni pacchetto di `tenantLifecycles` dichiara di sé; per il rag, il motore e il modello di
  embedding. Due parti: quella che va al cliente e quella interna, con l'id del tenant e il
  locator. La risposta di `POST /tenants/:id/export` porta l'hash del manifest.
  **Chiuso il 15 ottobre 2026.** Il pacchetto è una cartella (`lib/util/tenantPackage.ts`):
  `tenant.sql`, `tenant.<nome>` per ogni pacchetto, `manifest.json` senza id, locator né percorsi,
  `envelope.json` legata all'hash del manifest; `describe` nuovo su `TenantLifecycle`. Prove in
  `test/lib/tenantPackage.spec.ts` (18); difetto piantato (controllo hash spento): 4 cadute.
- [x] **T-17.2** Il pacchetto cliente (F82, F84, F89). Le credenziali svuotate secondo F84. Sotto
  la strategia `schema` il dump non porta il nome dello schema, che è il locator. Un download per
  l'operatore di sistema, nel piano di controllo: la risposta non porta più il percorso sul disco
  del server, che oggi è l'unico modo di raggiungere il file. Via proposta: il dump grezzo
  ricaricato in un contenitore temporaneo, ripulito lì e riesportato, che è lo stesso passaggio
  di T-17.5.
  **Chiuso il 15 ottobre 2026** sulla via proposta: dump grezzo in un contenitore temporaneo,
  `lib/database/containers/scrub.ts` lì, poi il dump del pacchetto con lo schema rinominato in
  `vm_package`. `GET /tenants/:id/exports/:package` risponde un tar ustar, `profile=client` senza
  busta. Prove in `test/migrations/export.spec.ts` (10 su Postgres) e nel banco
  `tenantLifecycle.e2e`; difetto piantato (`mfa_secret` non svuotato): cadute.
- [x] **T-17.3** La busta dell'operatore (F82, F84). La riga di registro, i provider di identità
  del tenant con `secret_enc` vuoto, la parte interna del manifest. La distruzione rimuove i
  provider (`lib/api/tenants/controller/tenants.ts`): dopo una distruzione la busta è l'unico
  posto in cui restano.
  **Chiuso il 15 ottobre 2026.** La busta porta la riga e i provider senza segreto; l'`exportRef`
  della distruzione è il nome del pacchetto. Prove nel banco (`profile=operator` con la busta,
  `client` senza) e in `test/lib/destruction.spec.ts`.
- [x] **T-17.4** Il ripristino (F84, F85, F86, F90, F91). Un'operazione del framework che crea il
  contenitore dal pacchetto: la creazione rifiuta un contenitore già lì (F80), quindi un dump
  caricato a mano non si può registrare dopo. `TenantLifecycle` prende `restore`, chiamato dopo
  il caricamento del dump, con lo stesso annullamento di F78 quando un pacchetto fallisce. Sotto
  `schema` il dump entra nel locator di arrivo. La riga di registro è nuova e con un id nuovo,
  anche quando sulla stessa macchina ce n'è una `destroyed` con lo stesso slug. Oggi lì non può
  esserlo: `tenant_slug_uq` e `tenant_locator_uq` sono indici unici su tutte le righe, e la
  distruzione lascia alla riga `destroyed` il suo slug e il suo locator. Gli indici devono
  escludere le righe `destroyed`, nella migrazione iniziale. La richiesta porta la password del
  primo amministratore; via proposta: l'utente con `is_founder`, quello che la creazione scrive
  per primo. Al termine: nessuna sessione, nessun flusso di login, ogni token con un
  `external_id` nuovo.
  **Chiuso il 15 ottobre 2026.** `POST /tenants/import` con `{ package, founderPassword }`;
  `restoreContainer` del provider con il lettore che rifiuta i meta-comandi di `psql`; indici
  parziali `WHERE status <> 'destroyed'` in `0000_initial_control.sql`; provider di identità
  ripristinati `disabled`. Prove: 16 nel banco `tenantLifecycle.e2e` sulle due strategie (giro
  completo, slug di un tenant distrutto riusato), rifiuti in `tenantPackage.spec.ts`; difetti
  piantati (token non rinnovati, indice senza `WHERE`, stato del provider tenuto): cadute.
- [x] **T-17.5** La verifica di integrità. Gli hash del manifest ricontrollati, poi il dump
  ricaricato in un contenitore temporaneo e i conteggi di riga confrontati con quelli
  dell'origine, gli stessi che `inspect` calcola per l'anteprima di distruzione. Un hash dice che
  il file non è cambiato, non che si apre.
  **Chiuso il 15 ottobre 2026.** All'export il pacchetto si ricarica in un secondo contenitore
  temporaneo e i conteggi si confrontano; al ripristino gli hash, poi i conteggi del manifest
  (`RESTORE_INTEGRITY_FAILED`, contenitore eliminato). Prove in `export.spec.ts`; difetto
  piantato (controllo dei meta-comandi spento): cadute.
- [x] **T-17.6** La traccia (F87). Lo stato del tenant traslocato e la sua destinazione sulla
  riga di registro; l'hash del manifest nel `detail` di `tenant.exported`, accanto al percorso;
  gli eventi di import, con il loro nome e la provenienza: l'id di origine del tenant e l'hash
  del manifest da cui è stato caricato.
  **Chiuso il 15 ottobre 2026.** Stato `moved` e colonna `moved_to`, `POST /tenants/:id/move`
  (`TENANT_PACKAGE_MISMATCH` per un pacchetto d'altri), eventi `tenant.imported` e `tenant.moved`.
  Prove in `governanceLog.e2e.spec.ts` e nel banco.
- [x] **T-17.7** La riemissione di un token (F86). `lib/api/token/routes.ts` ha otto rotte
  (elenco, conteggio, lettura, creazione, modifica, cancellazione, blocco, sblocco) e nessuna
  riemette un bearer. La nuova cambia l'`external_id` e risponde con il bearer, una volta; il
  ripristino usa la stessa operazione su tutti i token del tenant, senza mostrare niente.
  **Chiuso il 15 ottobre 2026.** `POST /token/:id/reissue` e `resetExternalId` del manager. Prove
  in `tokenApex.spec.ts` e `integrationToken.e2e.spec.ts`.
- [x] **T-17.8** La documentazione di F88, nel README accanto a "Exporting a container": che
  cosa copre l'export di un tenant, e che un deployment con un solo tenant e il piano di
  controllo si salvano con i backup dell'infrastruttura.
  **Chiuso il 15 ottobre 2026.** La sezione "Exporting a container" del README non c'è più dopo
  la riscrittura a istantanea: F88 sta in un paragrafo di "What it gives you", e per esteso in
  `docs/API_V5.md` §6.3 e in `llms.txt` §2.12.
- [x] **T-17.9** La firma del pacchetto (opzione A del proprietario, 15 ottobre 2026). La
  revisione di sicurezza ha aggirato il lettore dei meta-comandi in quattro modi (barra a metà
  riga, fine di `COPY` con `\.\r`, riga di `COPY` dentro `$$`, `client_encoding` SJIS): un hash
  dice che niente è cambiato, non chi ha sigillato. La busta porta un HMAC-SHA256 con
  `PACKAGE_SIGNING_KEY`; `PACKAGE_VERIFY_KEYS` verifica soltanto (chiave ruotata, istanza di
  provenienza di un trasloco). Senza chiave l'export scrive la busta non firmata e risponde
  `signed: false`; il ripristino risponde 503 `RESTORE_NOT_AVAILABLE` senza chiavi e 422
  `RESTORE_SIGNATURE_INVALID` a una busta non firmata, di un'altra chiave o alterata. Il cliente
  apre il pacchetto senza chiave, quindi F83 regge. Il lettore resta come seconda linea.
  **Chiuso il 15 ottobre 2026.** `lib/util/tenantPackage.ts`, `importTenant`, controllo di
  robustezza all'avvio in `index.ts`. Prove in `tenantPackage.spec.ts`, compreso un pacchetto
  riscritto e risigillato senza chiave.
- [x] **T-17.10** Gli agganci dell'app e il profilo all'export (F82, F83, F84, F92, F93). `pack`
  e `unpack` su `TenantLifecycle` in `types/global.d.ts`: `pack` riceve il tenant, il contenitore
  temporaneo e il profilo, e risponde se ha scritto valori da ricifrare; `unpack` riceve il
  tenant e il contenitore di arrivo. In `exportContainer` del provider `pack` gira dopo
  `scrubCredentials` e prima di `countRows`; sotto `schema` l'app lavora con il contenitore che
  riceve, non con il locator. Il profilo entra nel corpo di `POST /tenants/:id/export`, nel
  manifest e nell'esportazione della distruzione e del trasloco come `operator`; il download
  perde il parametro `profile`; l'import rifiuta un pacchetto `client` e uno che chiede `unpack`
  a un'app che non lo ha. Prove: un aggancio che svuota una colonna e uno che la decifra e la
  ricifra, sulle due strategie; difetto piantato (`pack` chiamato dopo i conteggi, `unpack`
  saltato).
  **Chiuso il 19 ottobre 2026.** `PackageProfile`, `pack` e `unpack` in `types/global.d.ts`;
  `packInPackages`, `unpackInPackages` e `unrestorable` in `lib/util/tenantLifecycle.ts`; il
  provider riceve una funzione `pack(handle)` e non sa niente degli agganci, e l'export fallisce
  se gli agganci hanno `pack` e il provider non l'ha chiamata. Il manifest porta `profile` e
  `unpack` per pacchetto, e `openPackage` rifiuta un profilo assente o sconosciuto e un `unpack`
  non booleano. Un export senza profilo valido risponde 400 `EXPORT_PROFILE_REQUIRED`; import e
  trasloco rifiutano un pacchetto `client` con 409 `RESTORE_PROFILE_MISMATCH` (decisione del
  proprietario del 19 ottobre 2026: un solo codice per i due); `unpack` gira solo per i pacchetti
  segnati, e un pacchetto segnato senza `unpack` in questa build risponde 409
  `RESTORE_PACKAGE_UNAVAILABLE`. Prove: in `tenantPackage.spec.ts` rifiuti, ordine dei passi al
  ripristino e annullamento di un `unpack` che fallisce; in `test/migrations/export.spec.ts`
  `pack` vede la copia già senza credenziali, le righe che toglie non si contano e il contenitore
  vivo resta com'era; nel banco `tenantLifecycle.e2e`, sulle due strategie, un aggancio `vault`
  che decifra una colonna cifrata con `encrypt()` in tutti e due i profili e nel profilo `client`
  svuota una colonna e toglie una riga, il valore ripristinato è di nuovo cifrato e si decifra
  nell'originale, e il pacchetto `client` non si ripristina né trasloca. Esito con
  `DATABASE_URL` su un database di prova dedicato: `npm test` 1101 prove, nessuna saltata;
  `test:e2e:mt:pg` 63, banco `tenantLifecycle.e2e` 18 sulle due strategie; rag-sample
  `test:tenants` 9 su 9 nelle quattro combinazioni; admin 228. Difetti piantati: `pack` dopo
  `countRows` fa cadere 1 prova del provider (`ExportFailedError`, `widget: 1 expected, 0 found`)
  e 4 del banco; `unpack` saltato ne fa cadere 2 in `tenantPackage.spec.ts` e 2 nel banco (il
  valore ripristinato resta in chiaro).
- [ ] **T-17.11** Chi esporta, scarica e ripristina (F89). Due rotte nel piano del tenant, solo
  per il ruolo `admin` e con `freshAuth`: l'export del proprio tenant, sempre `client`, e il suo
  download, con il tenant preso dal token e mai dai parametri. Nel piano di controllo
  `POST /tenants/:id/exports`, `GET /tenants/:id/exports/:package`, `POST /tenants/import` e
  `POST /tenants/:id/move` passano al solo ruolo `system:admin`, senza permesso del catalogo;
  `tenants:export` esce da `SYSTEM_CAPABILITIES`, dai tipi, da `docs/AUTHORIZATION_V5.md`,
  `docs/API_V5.md` e `llms.txt`.
  `freshAuth` sull'export e sul download dei due piani. Un evento di governance a ogni download,
  dei due piani, con il nome del pacchetto, l'hash del manifest e chi scarica. Prove: un
  amministratore scarica il suo tenant, non quello di un altro né il profilo `operator`; un ruolo
  del tenant diverso da `admin` riceve 403; `system:operator` e un ruolo di sistema con `tenants`
  ricevono 403 sulle quattro rotte; un token senza conferma recente riceve `STEP_UP_REQUIRED` sui
  due piani; il download scrive l'evento; difetto piantato (tenant preso dal parametro,
  `freshAuth` tolto, `tenants` di nuovo sull'import).
  **Decisioni del proprietario del 19 ottobre 2026, prima del codice.** Percorsi: una rotta ha un
  piano solo e il router rifiuta all'avvio quella che li mescola (`docs/AUTHORIZATION_V5.md`
  §2.1), quindi i due piani hanno gli stessi nomi e prefissi diversi. Nel controllo
  `POST /tenants/:id/exports` (prima `/:id/export`) e `GET /tenants/:id/exports/:package`; nel
  tenant `POST /exports` e `GET /exports/:package`, in `lib/api/exports`, accese solo con i
  tenant. Il rinomino tocca il mock dell'admin, il test del rag-sample, gli e2e e i documenti.
  Export e download stanno in un solo modulo comune, e le rotte dei due piani sono due ingressi
  sottili. Nel tenant un pacchetto di un altro tenant o `operator` risponde 404, come un nome
  sconosciuto. Il manifest porta l'id del tenant, che decide di chi è un pacchetto: lo slug si
  sceglie di nuovo all'import. Evento: azione `tenant.downloaded` con pacchetto, hash del
  manifest, profilo e byte; l'intenzione si scrive prima del primo byte, e se non si scrive il
  download non parte (503); l'esito a fine flusso. L'autore porta la colonna `actor_plane`
  (`control` o `tenant`), scritta direttamente in `0006_governance_log_control.sql` senza una
  migrazione nuova, perché non c'è produzione; i database locali che l'hanno già applicata si
  ricreano. Rotazione: un solo pacchetto `client` per tenant, da qualunque piano venga, perché
  è lo stesso pacchetto; un export nuovo riuscito cancella il precedente dopo aver scritto il
  suo, e i pacchetti `operator` non ruotano mai. Un export mentre è in corso un altro export o un
  download dello stesso tenant risponde 409. Quota: `TENANT_EXPORT_MAX` export (default 3) ogni
  `TENANT_EXPORT_WINDOW` (default un'ora) per tenant, contati sul registro di governance dopo
  aver preso il blocco: solo gli export del piano del tenant, partiti, riusciti o no; oltre, 429
  con `Retry-After`. Anti-flood: il plugin `rateLimit` per IP sulle quattro rotte di export e
  download dei due piani, a dieci volte la quota al minuto, ricavato e senza una variabile sua;
  vale solo dove il progetto tiene acceso il plugin, che resta una sua scelta libera (una
  intranet può spegnerlo), mentre la quota vale sempre.
  Le due variabili entrano in `docs/CONFIGURATION_V5.md`. Conseguenza nota: chi impersona o usa
  un token d'integrazione riceve `STEP_UP_NOT_AVAILABLE` e non esporta. Prove in più: la
  rotazione (il secondo export cancella il primo `client`, l'`operator` resta), il 409, il 429
  con `Retry-After`, e la quota non consumata dagli export del controllo.

## 3. Segnalato, non toccato

- Chiusi il 19 ottobre 2026 da T-7.12 di `volcanic-rag` (`volcanic-rag@1b93c7b`,
  `volcanic-rag-sample@c858b03`): `ragLifecycle()` ha `describe` e `restore`, anche dell'indice
  LanceDB fuori dal database, e la suite dei tenant del sample esporta, distrugge e ripristina un
  tenant che risponde come prima.
