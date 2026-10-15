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
> proprietario, prese il 13 ottobre 2026.

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
| F82 | **Un formato, due profili.** Il *pacchetto cliente* porta i dati del tenant e ciò che serve ad aprirli con il solo Postgres: il dump, gli artefatti dei pacchetti (F78) e un manifest. Il *pacchetto operatore* è il pacchetto cliente più una busta interna: la riga di registro del tenant, i suoi provider di identità e la parte interna del manifest. Il primo è un sottoinsieme stretto del secondo. Nel pacchetto cliente non entra niente che descriva la piattaforma: né l'id del tenant, né il locator, né un percorso del server | il cliente che esce o chiede una copia ha diritto ai suoi dati e a niente di ciò che li lega al tenant, al piano di controllo o alle macchine di produzione; a noi, per traslocare, dismettere o ricaricare, servono le stesse cose più quel legame, che sta nel piano di controllo e non nel dump: senza la riga di registro e i provider un export non basta a ricreare il tenant altrove; due esportatori distinti divergerebbero, mentre un sottoinsieme si prova con un confronto |
| F83 | **La chiave di cifratura non esce mai**, in nessun profilo e nemmeno separata dal dump. Nessun export contiene testo cifrato | la chiave è una sola per processo (`MFA_DB_SECRET`, con ripiego su `JWT_SECRET`) e cifra il piano di controllo e tutti i tenant: darla a un cliente è dargli quella di tutti gli altri e, con il ripiego, quella che firma i token; un pacchetto senza testo cifrato non dipende da nessuna chiave e si apre su qualunque macchina |
| F84 | **Le credenziali si svuotano, le colonne restano.** Nel pacchetto: `user.mfa_secret` vuoto con `mfa_enabled` falso; `user.password`, che è obbligatoria, con un valore segnaposto che non corrisponde a nessuna password; `user.reset_password_token` e `user.confirmation_token` vuoti; `session` e `auth_flow` senza righe; `identity_provider.secret_enc` vuoto nella busta. Dopo un ripristino l'utente riattiva il secondo fattore dal setup e reimposta la password dal recupero via mail, o la riceve da un amministratore (`POST /users/:id/password/reset`); l'operatore reinserisce il segreto di ogni provider | con le colonne al loro posto il dump ha la forma dello schema vivo e si carica senza toccare la struttura; il legame tra un utente e ciò che è suo non sta nel segreto ma nella riga (id, email, ruoli, identità esterne), che viaggia intatta, e il segreto si riscrive sulla stessa riga con i flussi che esistono già; chi entra con un provider esterno non rifà niente, una volta riconfigurato il provider |
| F85 | **Una regola sola per ogni ripristino**, sulla stessa macchina o su un'altra: quella di F83 e F84, senza eccezione per il caso in cui la chiave coincide. Costo accettato: anche dopo un ripristino sulla stessa macchina gli utenti rifanno il secondo fattore | due regole vorrebbero un'impronta della chiave nel manifest, un confronto all'import e due percorsi da provare; con una sola il ripristino non dipende mai da quale chiave ha la macchina di arrivo |
| F86 | **I token di integrazione cambiano `external_id` al ripristino**, tutti quelli del tenant, e una **riemissione** sul singolo token cambia l'`external_id` e mostra il nuovo bearer una volta. Nome, ruoli e scadenza restano. L'`external_id` degli utenti non cambia. Costo accettato: dopo un ripristino ogni integrazione va riconfigurata con il bearer nuovo, la sentinella di `volcanic-rag` compresa | il bearer non è salvato: è un JWT che porta l'`external_id` della riga in `sub` e il tenant in `tid` (F79), e la richiesta trova la riga cercando quel valore; con un valore nuovo i bearer di prima non trovano più niente, sulla stessa macchina come altrove, mentre una riga bloccata tornerebbe valida con il bearer di prima appena sbloccata; oggi il bearer si vede solo alla creazione, quindi senza riemissione ogni token andrebbe ricreato da capo; all'`external_id` di un utente puntano le identità esterne, le sessioni e il registro degli accessi, e le sue sessioni non viaggiano |
| F87 | **La traccia resta sulla macchina di partenza.** Lo stato corrente sta nella riga di registro, la storia in `governance_log` (F76). Si aggiungono: uno stato per il tenant traslocato, con la destinazione; l'hash del manifest nell'evento di export; gli eventi di import, con la provenienza, sulla macchina di arrivo. L'evento di import non si chiama `tenant.restored` | una riga `destroyed` resta già nel registro e ogni export e ogni distruzione scrivono già intento ed esito, ma l'evento cita l'export con un percorso su disco, che non dice se il file è ancora quello; un tenant traslocato non è distrutto e oggi non ha uno stato suo; `tenant.restored` è già la riattivazione di un tenant sospeso o archiviato |
| F88 | **Un deployment con un solo tenant e il piano di controllo restano fuori**: il loro backup è quello dell'infrastruttura, e qui lo si documenta soltanto | lì un cliente è un tenant ed è un'istanza, quindi è padrone della macchina; la copia dell'intero database la fanno già `pg_dump` e i backup gestiti, e rifarla nel framework duplicherebbe l'infrastruttura |
| F89 | **Il pacchetto cliente lo scarica l'operatore di sistema**, che poi lo consegna. L'amministratore del tenant non lo scarica da sé, per ora | oggi l'export scrive un file sul server e risponde con il suo percorso: non c'è download, e la rotta è del piano di controllo (`tenants:export`); una consegna in autonomia vorrebbe una rotta nel piano del tenant, con i suoi permessi e i suoi limiti, e non serve per partire |
| F90 | **Ogni ripristino scrive una riga nuova, con un id di tenant nuovo**, sulla stessa macchina come dopo un trasloco su un'altra. Una riga `destroyed` resta com'è | `destroyed` è uno stato finale (`EVO_STATO.md`, 27 settembre 2026): riaprire quella riga sarebbe tornare al difetto che quello stato ha chiuso, un tenant di nuovo attivo sopra una storia che lo dice distrutto; con un id nuovo anche dopo un trasloco la regola resta una, come in F85, e l'id di origine sta nella busta, da cui passa all'evento di import come provenienza (F87); nessun bearer in giro porta ancora l'id di prima, perché le sessioni non viaggiano e i token cambiano `external_id` (F86) |
| F91 | **Il ripristino fa impostare all'operatore la password del primo amministratore.** Gli altri utenti la reimpostano come in F84 | dopo un ripristino tutte le password sono segnaposto: se sulla macchina di arrivo la posta non funziona, nel tenant non entra nessuno, nemmeno chi dovrebbe reimpostare le password degli altri; la creazione di un tenant fa già così, con l'amministratore e la sua password nel corpo della richiesta |

## 2. Compiti

Ogni compito si chiude con le sue prove e con un difetto piantato che le fa cadere, come nella
fase 16.

- [ ] **T-17.1** Il manifest (F82). Accanto al dump, un file che elenca ogni file del pacchetto
  con il suo hash, la versione di schema (oggi sta solo nel nome del file), la strategia e ciò che
  ogni pacchetto di `tenantLifecycles` dichiara di sé; per il rag, il motore e il modello di
  embedding. Due parti: quella che va al cliente e quella interna, con l'id del tenant e il
  locator. La risposta di `POST /tenants/:id/export` porta l'hash del manifest.
- [ ] **T-17.2** Il pacchetto cliente (F82, F84, F89). Le credenziali svuotate secondo F84. Sotto
  la strategia `schema` il dump non porta il nome dello schema, che è il locator. Un download per
  l'operatore di sistema, nel piano di controllo: la risposta non porta più il percorso sul disco
  del server, che oggi è l'unico modo di raggiungere il file. Via proposta: il dump grezzo
  ricaricato in un contenitore temporaneo, ripulito lì e riesportato, che è lo stesso passaggio
  di T-17.5.
- [ ] **T-17.3** La busta dell'operatore (F82, F84). La riga di registro, i provider di identità
  del tenant con `secret_enc` vuoto, la parte interna del manifest. La distruzione rimuove i
  provider (`lib/api/tenants/controller/tenants.ts`): dopo una distruzione la busta è l'unico
  posto in cui restano.
- [ ] **T-17.4** Il ripristino (F84, F85, F86, F90, F91). Un'operazione del framework che crea il
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
- [ ] **T-17.5** La verifica di integrità. Gli hash del manifest ricontrollati, poi il dump
  ricaricato in un contenitore temporaneo e i conteggi di riga confrontati con quelli
  dell'origine, gli stessi che `inspect` calcola per l'anteprima di distruzione. Un hash dice che
  il file non è cambiato, non che si apre.
- [ ] **T-17.6** La traccia (F87). Lo stato del tenant traslocato e la sua destinazione sulla
  riga di registro; l'hash del manifest nel `detail` di `tenant.exported`, accanto al percorso;
  gli eventi di import, con il loro nome e la provenienza: l'id di origine del tenant e l'hash
  del manifest da cui è stato caricato.
- [ ] **T-17.7** La riemissione di un token (F86). `lib/api/token/routes.ts` ha otto rotte
  (elenco, conteggio, lettura, creazione, modifica, cancellazione, blocco, sblocco) e nessuna
  riemette un bearer. La nuova cambia l'`external_id` e risponde con il bearer, una volta; il
  ripristino usa la stessa operazione su tutti i token del tenant, senza mostrare niente.
- [ ] **T-17.8** La documentazione di F88, nel README accanto a "Exporting a container": che
  cosa copre l'export di un tenant, e che un deployment con un solo tenant e il piano di
  controllo si salvano con i backup dell'infrastruttura.

## 3. Segnalato, non toccato

- `volcanic-rag`: `ragLifecycle()` non ha un `restore`, e sotto LanceDB l'indice è una cartella
  fuori dal database. Da scrivere in `volcanic-rag/TASKS.md`.
- `volcanic-rag-sample/test-tenants/tenants.spec.ts` prova l'export di un tenant con il suo
  corpus, non il ripristino.
