# EVO fase 12: motore di autenticazione componibile

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`, una
> riga per compito; le decisioni prese qui vanno riportate in `EVO_PUNTI_APERTI.md` come righe
> `F29` e seguenti. La fase riprende il progetto rinviato di `docs/AUTH_COMPOSABLE_EVOLUTION.md`,
> scritto contro la v4 e dichiarato fuori dalla v5 (`EVO_FRAMEWORK.md:50`), e lo riallinea al
> codice della v5 su decisione del manutentore del 18 settembre 2026.
>
> **Regola unica**, la stessa delle fasi precedenti: una casella si chiude solo con
> un'**evidenza citata**, cioè un `file:riga`, un identificativo di commit o l'output di un
> comando. Senza evidenza resta aperta.
>
> Perimetro: `volcanic-backend`, branch `v5`, più il porting di `volcanic-backend-sample` e
> `volcanic-admin` (entrambi su `v5`), perché le rotte di login attuali **spariscono**. SAML è
> rinviato a una fase successiva (§3). La replica resta affidata al solo adattatore Litestream e
> non è toccata. Data: 18 settembre 2026.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 0. Perché la fase esiste

Il login della v5 è un percorso scritto a mano, due volte. Sul piano tenant `login` verifica la
password e, se l'utente ha il secondo fattore o la politica lo impone, firma un JWT con
`role: 'pre-auth-mfa'` da cinque minuti e risponde 202 (`lib/api/auth/controller/auth.ts:393-406`,
`lib/util/credential.ts:285-292`); la verifica TOTP sta in un'altra rotta che rilegge quel token
da sé (`auth.ts:671-741`). Sul piano di controllo la stessa storia è riscritta in
`lib/api/system/controller/systemAuth.ts:70-118` e `:274-319`, con differenze che nessuno ha
scelto: il tenant legge il token temporaneo dall'header (`auth.ts:674`), la piattaforma dal corpo
(`systemAuth.ts:279-280`); il tenant risponde 401 `AUTH_INVALID_CREDENTIALS` a un login fallito
(`auth.ts:84-87`), la piattaforma 403 «Wrong credentials» senza codice (`systemAuth.ts:87-89`),
mentre `docs/API_V5.md:182` promette per la piattaforma «the same uniform messages as §2.1».
L'unico «secondo passo» esistente è tenuto in piedi da una lista bianca di otto percorsi
confrontati con `endsWith` nel gancio di autenticazione (`lib/hooks/onRequest.ts:14-23`,
`:134-145`).

Aggiungere un metodo, un codice via email, un accesso federato, oggi significa riscrivere due
controller e allargare quella lista. Il progetto rinviato risolveva il problema con un contratto
per i metodi e un motore a stadi; la v5 nel frattempo ha cambiato quasi tutto ciò su cui quel
progetto poggiava: due piani con identità separate, un registro delle sessioni con rotazione
(fase 11), una politica MFA che è un pavimento per piano e per tenant (`lib/util/mfaPolicy.ts:41-56`),
nessun contesto implicito (`lib/util/tenancy.ts:55`), il tenant legato al token e mai alla query
string (`lib/util/tenantResolution.ts:22-33`). Il documento v4 va quindi rifatto, non eseguito.

La lista bianca ha già prodotto un difetto grave: il token temporaneo apriva le rotte di
iscrizione anche per chi aveva già un fattore, e la sola password bastava a sostituire il fattore
della vittima ed entrare, sui due piani. Il commit `1b50994` lo ha chiuso prima della fase
(T-12.1): `setup` ed `enable` rispondono 409 `MFA_ALREADY_ENABLED` (`auth.ts:583`,
`systemAuth.ts:229`, `:249`). La fase lo chiude alla radice, perché il token temporaneo e la lista
bianca spariscono. La correzione per le versioni 4.x e 3.x pubblicate è stata declinata per ora e
non è un compito di questa fase.

## 1. Le decisioni

### 1.1 Le quattro del manutentore, da non riaprire

| | Decisione | Criterio |
|---|---|---|
| F29 | il motore si **riallinea alla v5 e si implementa**: serve entrambi i piani (`/auth/*` per gli utenti del tenant, `/system/auth/*` per le identità di piattaforma), chiude con il registro delle sessioni e la rotazione della fase 11, e rispetta il pavimento MFA per piano e per tenant | due login scritti due volte hanno già divergito tre volte (§0); un motore solo, parametrizzato per piano come `lib/util/renewal.ts`, è l'unico modo di non riscriverli una terza |
| F30 | metodi della fase: `password` e `totp` (il comportamento di oggi, diventato autenticatore), `email-otp` e **OIDC** come implementazioni vere; il contratto `Authenticator` pronto per sms, social e per un metodo a ritorno in POST come SAML, dimostrato da un autenticatore finto nei test. SAML è **rinviato** a una fase successiva (§3) | un contratto provato solo sui metodi che lo hanno ispirato non è un contratto; SAML porta una scelta di libreria ancora aperta |
| F31 | `/auth/login`, `/auth/mfa/verify` con il token `pre-auth-mfa`, e le gemelle `/system/auth/*`, sono **sostituite** da `/auth/flow/*` e `/system/auth/flow/*`; sample e console si portano. Le rotte di gestione del fattore (`setup`, `enable`, `disable`) **restano**, ma solo per sessioni complete: decisione F45 | siamo in alpha, la rottura è gratuita ora e costosa dopo la 5.0.0 |
| F32 | replica: Litestream resta l'unico adattatore, fuori perimetro | nessun legame con l'autenticazione |

### 1.2 Le decisioni di progetto

Ogni voce ha una raccomandazione, il perché e le alternative scartate. Vanno trascritte in
`EVO_PUNTI_APERTI.md` con la sola riga che vale, come si è fatto per la fase 11. F44 è stata
decisa dal manutentore nella forma della tabella persistita; F48 chiusa con (b), rinviata dopo la 5.0.

**F33. Dove vive la configurazione dei flussi.** Un file nuovo, `src/config/authFlows.ts`,
scoperto come `roles.ts`: default del framework in `lib/config/authFlows.ts`, file del progetto
cercato con lo stesso `normalizePatterns` di `lib/loader/roles.ts:116-121`. Il file del progetto
**sostituisce per intero** il blocco di un piano, non si fonde. Gli autenticatori personalizzati
arrivano invece da `start()`, accanto ai manager (`index.ts:323-335`), sotto la chiave
`authenticators`. Perché: la configurazione generale si fonde in profondità
(`lib/loader/general.ts`, `deepMerge`), e una lista di stadi fusa con quella del framework è il
modo più silenzioso di ottenere un login con un fattore in meno; un file a parte con semantica di
sostituzione dice esattamente ciò che è scritto. Gli autenticatori stanno in `start()` perché hanno
bisogno di manager e perché i test li iniettano senza scrivere file. Scartati: un blocco `auth` in
`general.ts` (fusione in profondità), il percorso v4 `src/config/authFlow.ts` al singolare con i
metodi dichiarati nello stesso file (lega codice eseguibile al caricamento della configurazione,
che `preload()` fa prima del data layer).

**F34. La forma di un flusso.** Per piano: una lista `identify` di metodi che stabiliscono chi è
il soggetto (il primo stadio, scelto dall'utente fra le alternative), poi una lista ordinata
`flows`, ognuno con `roles`, `stages` e facoltativamente `identifiers` (gli identificatori che quel
ruolo accetta). Dopo l'identificazione il motore sceglie il **primo** flusso i cui ruoli
intersecano quelli del soggetto; `'*'` è obbligatorio ed è l'ultimo. Uno stadio è
`{ anyOf: [...], optional?: true }`: `anyOf` è l'OR, la lista di stadi è l'AND. Nessun linguaggio di
espressioni: la condizione «solo se ha un fattore» del v4 (`when: 'subject.mfaEnabled'`) diventa
`optional: true`, cioè lo stadio si applica se il soggetto ha almeno un metodo dello stadio già
iscritto, e ogni verificatore risponde a `isEnrolled(subject)`. Perché: l'identità non è nota prima
del primo stadio, quindi un flusso scelto per ruolo non può governare il primo stadio, e il v4
fingeva di farlo; un valutatore di espressioni, anche ristretto, è codice da verificare in più
senza un caso d'uso che `optional` non copra. Scartati: flussi scelti prima dell'identificazione
(impossibile senza rivelare i ruoli di un indirizzo), `when` come espressione.

```ts
// src/config/authFlows.ts (forma, non codice finale)
export default {
  tenant: {
    identify: ['password', 'email-otp', 'oidc'],
    flows: [
      { roles: ['admin'], identifiers: ['password', 'oidc'], stages: [{ anyOf: ['totp', 'idp-mfa'] }] },
      { roles: ['*'], stages: [{ anyOf: ['totp', 'email-otp'], optional: true }] }
    ],
    returnUrl: 'https://app.example.com/login/return',
    providers: {
      google: { type: 'oidc', issuer: 'https://accounts.google.com', clientId: '...',
                clientSecretEnv: 'GOOGLE_CLIENT_SECRET', redirectUri: 'https://api.example.com/auth/flow/return/oidc' }
    }
  },
  control: {
    identify: ['password'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }]
  }
}
```

Il default del framework riproduce il comportamento di oggi: `identify: ['password']` e un solo
flusso `'*'` con `totp` facoltativo, su entrambi i piani.

**F35. Il pavimento MFA lo applica il motore, non il flusso.** Quando la politica effettiva
(`tenantPolicy`, `mfaPolicy.ts:52`; `controlPolicy`, `:46`) è `MANDATORY`, il motore esige che il
flusso completato contenga un secondo fattore (un verificatore locale, o `idp-mfa` accettato per
F41), qualunque cosa dica la configurazione; se il soggetto non ha fattori iscritti, il motore
aggiunge uno stadio di iscrizione `totp` dentro il flusso. `OFF` chiude le iscrizioni ma non la
verifica di chi ha già un fattore (`mfaPolicy.ts:58`), come oggi. Perché: la politica è un
pavimento per costruzione (T-10.19), e un pavimento che una riga di configurazione può abbassare non
è un pavimento. Scartato: tradurre la politica in stadi al caricamento, che non vede la politica
per tenant, letta a ogni richiesta dalla riga del registro.

**F36. Il credenziale del flusso è opaco, e `pre-auth-mfa` sparisce.** Formato
`vf1.<routing>.<flowId>.<segreto>`, parsing con le stesse regole di
`parseRefreshCredential` (`lib/util/session.ts:67-75`), in tabella solo lo SHA-256 del segreto.
Viaggia in un canale suo: in modalità cookie un cookie firmato `auth_flow` (piano tenant) o
`control_flow` (piano di controllo), httpOnly, `SameSite=Strict`, con path limitato a
`/auth/flow` e `/system/auth/flow` (con `COOKIE_PATH_PREFIX`, come `refreshCookiePath` in
`credential.ts:147-155`); in modalità bearer il campo `flow` del corpo, **mai** l'header
`Authorization`. Il gancio di autenticazione non lo vede mai, perché non è un JWT, quindi la lista
bianca `MFA_SETUP_WHITELIST` si cancella invece di generalizzarsi. Qualunque JWT che porti il claim
`role` viene rifiutato ovunque, per sempre: il framework non ne firma più, e un token `pre-auth-mfa`
ancora valido nei cinque minuti successivi al deploy passerebbe, senza lista bianca, per una
sessione completa. Perché: è l'argomento di F20 applicato al flusso; ogni passo legge comunque la
riga per contare i tentativi, quindi la firma non aggiunge nulla e costa uno spazio di nomi che si
confonde con l'access token. Scartati: il `JWT_FLOW_SECRET` del v4 (un secondo segreto per una
proprietà che la riga dà gratis), il credenziale nell'header (lo leggerebbero il resolver del
tenant e il gancio, `lib/loader/tenant.ts:212-226`, `onRequest.ts:93-100`).

**F37. Stato del flusso, un solo flusso vivo per soggetto, limiti.** Tabella `auth_flow` in
`appTables` (`lib/database/schema/pg.ts:42`), quindi nel contenitore del soggetto per F19: il piano
di controllo monta già le tabelle applicative, e le righe di sistema portano `scope: 'control'`
come `session` (`pg.ts:180`). Un flusso **occupa lo slot del soggetto solo quando il soggetto è
provato** (primo stadio superato): da quel momento un nuovo flusso provato dello stesso soggetto
cancella il precedente nella stessa istruzione, e il vecchio credenziale non trova più la riga.
I flussi non ancora provati (un `email-otp` identificatore con il solo indirizzo, un OIDC in attesa
del ritorno) non sfrattano nessuno. Limiti di default, sovrascrivibili nel blocco `limits` di
`authFlows.ts` e da ambiente (`AUTH_FLOW_TTL`, `AUTH_OTP_TTL`, `AUTH_OTP_MAX_ATTEMPTS`,
`AUTH_OTP_MAX_SENDS`):

| Parametro | Default | Motivo |
|---|---|---|
| vita del flusso, assoluta | 600 s | copre un'email lenta e un ritorno dall'IdP; non si allunga mai |
| vita di un codice | 300 s | |
| tentativi errati per flusso | 5, poi il flusso muore | un OTP sbagliato non blocca mai l'account, chiude il flusso |
| invii per flusso | 3 | |
| invii per soggetto | 5 in 15 minuti e 20 in 24 ore, **su tutti i flussi** | ricominciare non azzera il conto, altrimenti il tetto per flusso non è un tetto |
| lunghezza del codice | 6 cifre come verificatore, 8 come identificatore | vedi sotto |

Sulla lunghezza, un conto (stima, non misura): come identificatore basta l'indirizzo per chiedere un
codice, quindi un attaccante ottiene al massimo 20 invii al giorno per 5 tentativi, 100 tentativi
al giorno; su 10⁶ codici a sei cifre sono circa il 3,6% di successo in un anno, su 10⁸ a otto cifre
lo 0,04%. Come verificatore l'attaccante ha già superato il primo fattore, e sei cifre sono lo
standard. Il codice non si conserva in chiaro né come hash semplice: si conserva
`HMAC-SHA256(segreto del flusso, codice)`, così una copia della tabella non basta a provare i
10⁶ codici offline, perché la chiave è il segreto del flusso che la tabella non contiene. Consumo e
incremento dei tentativi sono `UPDATE` condizionati con controllo delle righe toccate, mai lettura e
poi scrittura. Scartati: il puntatore `flowId` sulla riga `user` del v4 (una colonna in più sulla
tabella più letta, e non esiste per i flussi senza soggetto), la coppia puntatore più tabella
(due scritture per un'informazione), gli OTP in cache di processo (non sopravvive a più istanze).

**F38. Dove sta la configurazione degli IdP.** In entrambi i posti, con due regole diverse per i
segreti. A livello di deployment, in `authFlows.ts` sotto `providers` per piano: serve al
single-tenant e al piano di controllo (gli operatori che entrano con l'IdP aziendale), e il segreto
del client è **solo un riferimento** a una variabile d'ambiente (`clientSecretEnv`), mai un valore.
Per tenant, in una tabella nuova del registro, `identity_provider` in `registryTables`
(`pg.ts:212`), con `tenant_id`, `key`, `type`, la configurazione non segreta in `jsonb` e il
segreto cifrato con la stessa funzione del segreto MFA (`lib/database/crypto.ts:59`, chiave
`MFA_DB_SECRET` con ripiego su `JWT_SECRET`, `:39-40`). La colonna `type` nasce con il solo valore
`oidc` e resta pronta per `saml`. La scrive l'operatore di piattaforma con la capability `tenants`,
dalle rotte di controllo del blocco H. **Mai** in `tenant.config`: quel `jsonb` (`pg.ts:225`) è
serializzato verso chi legge il tenant (`lib/schemas/tenant.ts:27`), e un segreto lì dentro esce
alla prima lista. Perché il per-tenant: il caso realistico di SSO in multi-tenant è «il cliente
porta il suo Entra ID», e un deploy per cliente non scala. Perché la cifratura sta nel data layer:
il core non può importare `crypto.ts` (regola `core-no-datalayer-import`,
`.dependency-cruiser.cjs:4-13`), quindi il manager restituisce la configurazione già decifrata.
Scartati: il solo deployment (un deploy per ogni nuovo cliente SSO), i soli riferimenti ad
ambiente anche per tenant (centinaia di variabili), una capability nuova `tenants:sso` (il
catalogo è chiuso, `types/global.d.ts:67-75`, e `tenants` governa già la configurazione del
tenant, politica MFA compresa, `lib/api/tenants/controller/tenants.ts:183`, `:268`).

**F39. Il ritorno da un IdP: come si lega flusso e tenant senza query string.** Il ritorno è una
navigazione del browser che arriva senza token e, con il resolver `header`, senza header: oggi
sarebbe 400 `TENANT_REQUIRED` (`lib/loader/tenant.ts:138-140`). Il legame lo porta il parametro
che il protocollo stesso restituisce, `state` in OIDC, nella forma `st1.<routing>.<segreto di 128
bit>`: circa 63 byte, dimensionato già per stare nel limite di 80 byte che la specifica SAML impone
a `RelayState`, così il metodo rinviato userà lo stesso formato. Il `routing` sceglie il
contenitore, esattamente come il prefisso del refresh (F20); il segreto si cerca per hash
**dentro** quel contenitore, quindi un `routing` alterato non trova nulla; se la richiesta dichiara
un tenant (sottodominio) e non coincide, è 403 `TENANT_MISMATCH` come in `tenant.ts:124-129`. Non è
il tenant in query string che la decisione 9 vieta: quella era una **dichiarazione** creduta,
questo è un indirizzo verificato da una riga scritta quando il tenant era stato risolto nel modo
normale. PKCE `S256` sempre, anche con client confidenziale; `nonce` sempre; verificatore PKCE e
`nonce` nella riga, cifrati dal manager come il segreto dell'IdP. Il ritorno arriva su una rotta
generica per metodo, `/auth/flow/return/:method`, che passa l'input al metodo (`complete` del
contratto, T-12.2) e **non emette sessioni**: registra l'esito nella riga e risponde 303 verso
`returnUrl` del piano, senza nulla nell'URL; il frontend riprende con
`POST /auth/flow/step { method: 'oidc' }` e il suo credenziale di flusso, e solo lì nasce la
sessione, con i cookie `Strict` di sempre. Così il login CSRF (l'attaccante fa atterrare il
proprio codice sul browser della vittima) finisce nella riga dell'attaccante, che solo il suo
credenziale può riscuotere. Perché i cookie non servono al ritorno: un cookie `Strict` non arriva
su una navigazione da un altro sito (e un POST da un altro sito non porta neppure i `Lax`, il caso
di SAML); progettare il ritorno senza cookie evita di abbassare `SameSite`
(`credential.ts:163-172`). Scartati: flusso nel piano di controllo con un indice globale (mette
dati di utenti dei tenant fuori dal loro contenitore), il credenziale di flusso intero dentro
`state` (finisce nei log dell'IdP e nella cronologia), la sessione emessa direttamente dal ritorno
(cookie scritti su una risposta cross-site e token negli URL in modalità bearer), una rotta di
ritorno dedicata a OIDC (la seconda, per SAML, sarebbe una copia).

**F40. Collegamento degli account e provisioning JIT.** Tabella `external_identity` in `appTables`,
chiave unica `(scope, provider, issuer, subject)`; mai l'email da sola. Una riga collega
un'identità esterna a un `subjectId` (l'`externalId` del soggetto, come `session.subject_id`,
`pg.ts:176`). In questa fase nasce in tre modi soli: il provisioning JIT, il collegamento per
email **solo** se il provider lo dichiara (`linkByEmail: true`), con `email_verified: true` nel
token e il dominio dell'indirizzo in `emailDomains` del provider, e la creazione da parte di un
amministratore; si toglie dall'utente o da un amministratore. Il collegamento avviato dall'utente
già loggato è rinviato dopo la 5.0 (F48). Il JIT è **spento** di default, solo sul piano tenant, con
ruoli dichiarati nel provider che non possono contenere l'admin (la stessa regola di `register`,
`auth.ts:109-118`); il JIT vuole l'email verificata dal provider, e senza non crea nulla (un account
non confermato occuperebbe l'indirizzo del suo vero titolare); l'utente nasce `confirmed` e con una password
inutilizzabile (hash bcrypt di 32 byte casuali mai mostrati) perché la colonna è `notNull`
(`pg.ts:53`). Sul piano di controllo il JIT non esiste: le identità di sistema si provvedono
(`docs/API_V5.md:178`). Perché la tripla: `sub` è unico solo per issuer, e l'email cambia, si
ricicla e su molti IdP non è verificata; collegare per email è la porta classica del takeover.
Scartati: collegamento per email di default, JIT di default, colonne `provider_id` sulla tabella
`user` (un utente può avere più identità esterne).

**F41. OIDC e il secondo fattore.** Di default l'MFA dell'IdP **non conta**. Un provider può
dichiarare `mfa: { trust: 'amr', values: ['mfa', 'hwk', 'otp'] }` o `trust: 'acr'`; in quel caso
il motore, se il token lo porta, segna lo pseudo-metodo `idp-mfa` come soddisfatto, e la richiesta
lo chiede esplicitamente con `acr_values`. `idp-mfa` vale solo dove un flusso lo elenca in `anyOf`,
e per il pavimento di F35. Perché: `amr` e `acr` sono affermazioni di un terzo, affidabili quanto
la sua configurazione; lasciarle contare di default significa che un IdP configurato male abbassa
il pavimento del framework. Scartati: fiducia implicita, fiducia globale per piano.

**F42. La libreria OIDC.** `openid-client` `^6.8` (6.8.8 del 5 settembre 2026, rilasci mensili,
ESM puro con `"type": "module"`, dipendenze `jose` e `oauth4webapi` dello stesso autore,
certificato OpenID, PKCE, `nonce`, discovery, `customFetch` per i test senza rete). **Peer
dependency facoltativa** in `peerDependenciesMeta`, come i driver (`package.json:116-147`), caricata
con `await import()` come `lib/database/adapters/sqlite/index.ts:151-166`; se un flusso di un piano
elenca `oidc` e la libreria manca, l'avvio si rifiuta con il comando da eseguire. Una regola nuova
di `dependency-cruiser` vieta gli import statici delle librerie di federazione fuori dai tipi,
scritta già per comprendere quella SAML che verrà, e i tipi pubblici del framework non le
nominano. Scartati: `oauth4webapi` diretto (lo stesso autore, più codice nostro per ottenere ciò
che `openid-client` già fa), `@fastify/oauth2` (OAuth2 senza validazione dell'ID token), le
strategie di Passport (idiomi di Express).

**F43. Consegna del codice email.** Un port nuovo, `ChallengeDeliveryManagement`, con default Null
Object: `deliver({ channel: 'email', to, code, purpose, expiresAt, plane, tenantId, subjectId,
locale })`. Il consumer lo cabla su `Mailer` di `@volcanicminds/tools/mailer` (`send` con `to`,
`subject`, `html`, `volcanic-tools/lib/mailer/index.ts:27-37`, `:89`) o su qualunque altra cosa, e
**compone lui oggetto e testo**: il backend emette dati, non presentazione né traduzioni. La
destinazione è sempre derivata dal server (l'email in archivio del soggetto), mai dal corpo; la
forma mascherata (`d***@a***.com`) è un dato del descrittore. Come identificatore, `email-otp`
risponde lo stesso 202 con lo stesso descrittore che l'indirizzo esista o no, e la consegna parte
dopo che la risposta è decisa, senza attenderla, perché la latenza di un SMTP è un cronometro. Lo
stesso port servirà `sms` con `channel: 'sms'`. Se un flusso elenca `email-otp` e il port non è
implementato, l'avvio si rifiuta, come oggi per `MANDATORY` senza MFA (`mfaPolicy.ts:85-96`,
`index.ts:347-352`). Scartati: import di `@volcanicminds/tools` nel core (dipendenza circolare
dell'ecosistema e testo nel backend), invio sincrono atteso (enumerazione per tempo).

**F44. Registro degli accessi persistito, e rate limit.** Decisione del manutentore: una tabella
`access_log`, non il solo log di processo. Il progetto:

- **dove**: in `appTables`, quindi una tabella per contenitore con lo stesso nome sui due dialetti
  e nei due insiemi di migrazioni: nel contenitore del tenant gli eventi dei suoi utenti, nel piano
  di controllo quelli delle identità di piattaforma, con la colonna `scope` come `session`
  (`pg.ts:180`), perché senza tenant i due tipi di soggetto convivono nello stesso contenitore. È
  F19 applicata al registro: l'export o la distruzione di un tenant si porta via i suoi accessi, e
  un operatore non legge gli accessi di un cliente se non entrando con un'impersonificazione, che
  lascia traccia;
- **colonne**: `id` (uuid v7, quindi ordinato nel tempo), `occurred_at`, `scope`, `event`,
  `outcome` (`success` | `failure`), `code` (il codice di esito o di rifiuto, per esempio
  `AUTH_INVALID_CREDENTIALS`), `subject_id` (l'`externalId`, nullo quando il soggetto non è noto),
  `methods` (gli `id` dei metodi coinvolti), `provider` (la chiave dell'IdP, se c'è), `flow_id`,
  `sid`, `ip` troncato. Nient'altro: niente user agent (la riga `session` lo ha già per le sessioni
  vive), niente indirizzo tentato quando il soggetto è ignoto (è un dato personale di chi forse non
  è neppure un utente), e **mai** password, codici, segreti, token, asserzioni o claim;
- **eventi**, lista chiusa, un tipo TypeScript e un controllo nel manager che rifiuta il resto:
  `login.succeeded`, `login.failed`, `flow.started`, `stage.passed`, `stage.failed`,
  `challenge.sent`, `challenge.refused`, `flow.expired`, `flow.exhausted`, `idp.linked`,
  `idp.unlinked`, `idp.provisioned`, `idp.rejected`, `mfa.enrolled`, `mfa.disabled`, `logout`,
  `session.revoked`, `session.reuse_detected`, `tokens.invalidated`. Il rinnovo riuscito **non** si
  registra: avviene ogni ora per ogni sessione viva e la riga `session` ne tiene già
  `last_used_at`;
- **indirizzo IP troncato**, non cifrato con hash: IPv4 a `/24`, IPv6 a `/48`. Un hash di un IPv4,
  anche con chiave, si inverte provando i 2³² indirizzi appena la chiave esce, e la chiave è un
  segreto in più da ruotare; il troncamento non si inverte, non ha chiavi, e conserva ciò che serve
  davvero a chi indaga, cioè «la stessa rete ha provato quaranta account in un'ora». Una variabile
  `ACCESS_LOG_IP=none` lo toglie del tutto per chi vuole meno ancora;
- **conservazione**: `ACCESS_LOG_RETENTION_DAYS`, default **90** giorni per il piano tenant, e
  `ACCESS_LOG_CONTROL_RETENTION_DAYS`, default **180** per il piano di controllo, nel blocco
  `accessLog` della configurazione (camelCase per F5) con l'ambiente che vince, come `sessions`.
  Novanta giorni coprono una revisione trimestrale e la finestra tipica in cui un incidente viene
  scoperto; per gli operatori di piattaforma il default sale a sei mesi perché il provvedimento del
  Garante sugli amministratori di sistema (27 novembre 2008) chiede di conservarne gli accessi
  logici per almeno sei mesi. È una lettura da far verificare al consulente privacy del consumer,
  non un parere legale;
- **pulizia**: cancellazione per predicato (`occurred_at` anteriore alla soglia), una sola
  istruzione come la purga delle sessioni, opportunistica su una scrittura ogni cinquanta e da CLI
  con `npx volcanic access-log --purge [--tenants]`, con la stessa paginazione della flotta di
  `sessions` (`bin/volcanic.mjs:28`, `:57-60`);
- **la scrittura non fa mai fallire un login**: un solo `insert` sullo stesso handle della
  richiesta, attesa dentro un `try` che in caso di errore scrive a log e prosegue. Attesa e non
  lanciata dopo la risposta, perché l'handle del tenant si restituisce a fine risposta
  (`lib/loader/tenant.ts:77-79`) e una scrittura tardiva lo userebbe dopo; e scritta su entrambi i
  rami di un `email-otp` identificatore, così non diventa il cronometro che F43 toglie. La riga di
  log di processo resta, per i deploy senza data layer e per chi raccoglie i log altrove;
- **contratto**: `AccessLogManagement` con `isImplemented`, `record(ctx, entry)`,
  `findQuery(ctx, query)`, `countQuery(ctx, query)`, `purgeBefore(ctx, before)`; default Null
  Object, e il core chiede `isImplemented()` prima di scrivere, quindi senza data layer si scrive
  solo a log;
- **lettura**: `GET /access-log` e `GET /access-log/count` sul piano tenant per il ruolo `admin`,
  `GET /system/access-log` e `/count` sul piano di controllo con una capability nuova del catalogo
  di controllo, `access-log`, concessa a `system:auditor` e implicita per `system:admin`
  (`lib/config/systemRoles.ts:16-40`). Paginazione e filtri con Magic Query (`executeFind`,
  `lib/database/query/index.ts:273`), su un elenco chiuso di campi filtrabili (`event`, `outcome`,
  `code`, `subjectId`, `occurredAt`), in sola lettura: nessuna rotta scrive o cancella righe.

Una tabella che si riempie di login falliti è anche una superficie: la crescita è limitata dal rate
limit per IP qui sotto e dalla conservazione. Rate limit per IP sulla falsariga di `authRateLimit`
(`lib/api/auth/routes.ts:5-8`), in aggiunta ai tetti per flusso e per soggetto di F37, che sono i
veri cancelli:

| Rotta | Limite per IP |
|---|---|
| `GET /auth/flow/options` | 60 al minuto |
| `POST /auth/flow/start` | `AUTH_RATELIMIT_MAX` per `AUTH_RATELIMIT_WINDOW` (10 al minuto) |
| `POST /auth/flow/step` | 10 al minuto |
| `POST /auth/flow/challenge` | 5 al minuto |
| `GET /auth/flow/return/:method` | 20 al minuto |
| `POST /auth/flow/cancel` | nessuno |

Scartati: il solo log di processo (non interrogabile da una console, perso con la rotazione dei
log), riusare `TrackingManagement` (registra modifiche di entità con `NewChange`,
`types/global.d.ts:586-595`, forma che non c'entra), una tabella unica nel piano di controllo per
tutti i tenant (sposta dati personali dei clienti fuori dal loro contenitore), una coda in processo
con scrittore in lotti come nel v4 (servirebbe un handle proprio per ogni contenitore, e perde gli
eventi a ogni crash).

**F45. Sessioni, refresh, `reset_external_id_on_login` e le rotte MFA.** Il completamento del
flusso chiama `issueSession` (`credential.ts:238-275`) **una volta**, con la stessa `SessionOrigin`
di oggi (`auth.ts:36-46`, `systemAuth.ts:50-60`): rotazione, grazia e riuso non cambiano. La riga
`session` guadagna `auth_methods` (i metodi soddisfatti, per esempio `["oidc","idp-mfa"]`), nella
stessa migrazione delle tabelle nuove, perché «questa sessione è nata senza secondo fattore» è
un'informazione che dopo non si ricostruisce e che una futura richiesta di step-up vorrà.
`reset_external_id_on_login` si applica una volta, al completamento, solo sul piano tenant come
oggi (`auth.ts:408-410`, `:718-720`), con l'avviso di T-11.15 (`index.ts:517-527`). Il token
`pre-auth-mfa` sparisce per F36. Le rotte `/auth/mfa/setup`, `/auth/mfa/enable`,
`/auth/mfa/disable` e le gemelle di sistema **restano** come gestione dell'account; il 409
`MFA_ALREADY_ENABLED` per chi ha già un fattore è già in vigore (T-12.1). Restano da fare due cose:
richiedono una sessione completa, perché nessun token temporaneo esiste più, ed `enable` **smette
di emettere una sessione** (`auth.ts:645-664`): l'emissione serviva al percorso di iscrizione
forzata, che entra nel flusso. `/auth/mfa/verify` sparisce. Perché restano: iscrivere, sostituire o
togliere un fattore è un'operazione su un account già autenticato, con la politica per tenant come
vincolo; dentro il flusso vive solo l'iscrizione obbligata da `MANDATORY`. Scartato: spostare
tutto nel flusso (trasformerebbe il login nel pannello dell'account).

**F46. Senza data layer.** Senza un `AuthFlowManagement` implementato funzionano solo i flussi che
si chiudono in una richiesta (`password` senza stadi applicabili); se un piano dichiara stadi,
`email-otp` o `oidc`, l'avvio si rifiuta. È F28 applicata al login: un secondo passo senza memoria
è un secondo passo che non conta i tentativi.

**F47. Il contratto delle risposte.** 202 per ogni autenticazione parziale, mai 200; 200 con lo
stesso corpo del login attuale (`auth.ts:421-432`: utente, `token`, `refreshToken`,
`securityPolicy`) al completamento. Il 202 porta `flow` (il credenziale in bearer, `null` in
modalità cookie, con `expiresAt`) e `stage` con `options`: per ogni metodo l'`id`, il `kind`, e
quando serve `challenge` (canale, destinazione mascherata, scadenza, prossimo invio possibile),
`enrol` (per l'iscrizione nel flusso) o `action`, che è `{ type: 'redirect', url }` per OIDC e ha
già la variante `{ type: 'post', url, fields }` per un metodo che, come SAML, parte con un modulo
inviato dal browser. Solo codici e identificatori, nessuna etichetta. `GET /auth/flow/options` è
senza stato: elenca gli identificatori del piano e, per il tenant risolto, i provider attivi,
senza creare righe.

**F48 (chiusa il 18 settembre 2026: (b), dopo la 5.0). Il collegamento avviato dall'utente già loggato.** È il pulsante «collega il mio
account Google» nel profilo: l'utente, con una sessione valida, avvia un giro OIDC il cui esito
si attacca **al soggetto della sessione** invece di aprire un login. La difficoltà non è tecnica,
è di sicurezza: chi ruba una sessione, anche solo per l'ora di vita di un access token, può
collegare un proprio account esterno e da quel momento rientrare con esso quando vuole. Quel
collegamento sopravvive al cambio di password, alla chiusura di tutte le sessioni e perfino al
cambio di `external_id`, perché la riga lega l'identità esterna al soggetto e non a una sessione:
è una porta sul retro che il proprietario non vede, se non va a guardare la lista.

Le due strade:

- **(a) dentro la 5.0.** Serve un flusso con uno scopo diverso dal login (`purpose: 'link'`) che
  parte da una sessione completa e chiede **una riautenticazione fresca** (il primo fattore, e il
  secondo se il soggetto lo ha) prima del giro esterno, cioè lo step-up che oggi non esiste; poi il
  ritorno collega invece di autenticare; poi un evento `idp.linked` nel registro degli accessi e
  una notifica al soggetto attraverso `ChallengeDeliveryManagement`. Costo stimato: due o tre
  compiti in più, e il primo uso reale dello step-up, che meriterebbe un progetto suo;
- **(b) dopo la 5.0.** In questa fase i collegamenti nascono solo per JIT, per email verificata
  su un dominio dichiarato, o da un amministratore (F40), e l'utente può solo vederli e toglierli.
  È un'aggiunta pura: introdurla dopo non rompe nulla, perché è una rotta nuova e un valore nuovo
  di `purpose`.

Raccomandazione: **(b)**. I casi SSO realistici di un framework multi-tenant (il cliente porta il
suo IdP aziendale) sono coperti da JIT e dal collegamento per dominio; il collegamento
self-service serve soprattutto ai login social dei prodotti consumer, e farlo senza step-up
significa spedire la porta sul retro descritta sopra. Meglio farlo una volta, insieme allo step-up
(che servirà anche a cambiare password e fattore in modo sicuro), che due volte. Nessun compito
finché il manutentore non decide.

**F49 (decisa il 23 settembre 2026). Chi può creare un account in un tenant.** Tre modalità, dalla
più chiusa alla più aperta: `invite` (gli account li crea un amministratore, o il JIT di un provider
ristretto a una directory), `approval` (registrazione libera con l'email verificata, poi
l'approvazione esplicita di un amministratore del tenant) e `open` (registrazione libera con
l'email verificata). Due livelli, ciascuno con i propri dati:

- **il piano di controllo decide l'insieme ammesso.** Per tutti i tenant: l'impostazione
  `account_creation` del contenitore di controllo, scritta da `PUT /system/account-creation` con
  la capability `tenants`, e in sua assenza `options.account_creation` del deployment
  (`ACCOUNT_CREATION_ALLOWED`, `ACCOUNT_CREATION_DEFAULT`; di fabbrica tutte e tre ammesse e
  `invite` come valore iniziale). Per un tenant solo: `config.account_creation.allowed` della sua
  riga di registro, scritto con `PUT /tenants/:id` e validato come `mfa_policy`, che **sostituisce**
  l'insieme globale per quel tenant (può restringerlo o allargarlo: lo decide la stessa persona);
- **il tenant sceglie dentro l'insieme.** L'`admin` del tenant scrive la modalità con
  `PUT /settings/account-creation`, salvata nel proprio contenitore (tabella `setting`, chiave
  `account_creation.mode`); una modalità fuori dall'insieme è rifiutata alla scrittura con
  `ACCOUNT_CREATION_NOT_ALLOWED`.

La modalità effettiva è la scelta del tenant se sta nell'insieme; altrimenti il valore iniziale
globale se sta nell'insieme; altrimenti la più chiusa dell'insieme. Così un insieme ristretto dopo
la scelta vale subito, senza toccare i dati del tenant, e non apre mai più di quanto è ammesso.
Vale per **entrambe** le porte: `/auth/register` (`invite` risponde 403 `REGISTRATION_CLOSED`, che
dice la regola del tenant e nulla sugli indirizzi) e il JIT di F40 (sotto `invite` solo se il
provider elenca `emailDomains`, perché chi l'ha configurato ha autorizzato quella directory; sotto
`approval` l'account nasce in attesa e il collegamento c'è già, così dopo l'approvazione il login
seguente passa). L'attesa è la colonna `approved` dell'utente (`approved_at` con lei), con default
`true` perché le righe esistenti e gli account creati da un amministratore non aspettano nessuno;
un solo controllo, `mayLogIn`, sostituisce i punti che oggi giudicano valido, confermato e non
bloccato. Il login con password o `email-otp` di un account in attesa riceve la risposta uniforme
di D-17; il ritorno da un provider riceve invece `ACCOUNT_PENDING_APPROVAL`, perché il provider ha
appena autenticato la persona a cui l'account appartiene e «non collegato» la manderebbe a
registrarsi di nuovo. Gli
amministratori trovano gli account in attesa con `approved=false` su `/users`, li approvano con
`POST /users/:id/approve`, e il registro degli accessi scrive `account.pending` e
`account.approved`. `GET /auth/flow/options` dice la modalità effettiva, perché il client sappia se
mostrare la registrazione e cosa dire dopo. Il piano di controllo non ha registrazione (le identità
di sistema si provvedono) e la regola non lo riguarda; senza il blocco `tenants` il livello globale
è solo quello del deployment, perché le rotte `/system/*` non sono montate. Scartati: riusare
`confirmed` (vuol dire email verificata) o `blocked` (è una sanzione con un motivo) per l'attesa;
un insieme per tenant intersecato con quello globale (due posti da guardare per capire perché una
modalità manca); la scelta del tenant scritta sulla riga di registro (un tenant che scrive nel
piano di controllo, e senza tenant la riga non esiste).

## 2. Ordine di esecuzione

Per dipendenza: senza contratti non c'è configurazione da validare; senza tabelle non c'è motore a
più passi né registro degli accessi; OIDC poggia sul motore e sul registro dei provider; le rotte
vecchie si tolgono solo quando le nuove passano le prove.

| Blocco | Voci | Sblocca |
|---|---|---|
| A. Correzione urgente | T-12.1, **chiuso** | nulla: già su `v5` |
| B. Contratti e registro | T-12.2 → T-12.4 | tutto il resto |
| C. Configurazione e validazione all'avvio | T-12.5 → T-12.7 | il motore |
| D. Persistenza | T-12.8 → T-12.12 | i flussi a più passi e il registro degli accessi |
| E. Motore e rotte sui due piani | T-12.13 → T-12.18 | i metodi |
| F. `password` e `totp` | T-12.19 → T-12.21 | la parità con oggi |
| G. `email-otp` | T-12.22 → T-12.24 | |
| H. Provider di identità | T-12.25 → T-12.27 | OIDC |
| I. OIDC | T-12.28 → T-12.30 | |
| J. Registro degli accessi | T-12.31 → T-12.33 | la tracciatura di tutti gli altri blocchi |
| K. Rimozione e gatekeeper | T-12.34 → T-12.36 | la chiusura della superficie vecchia |
| L. Prove | T-12.37 → T-12.40 | la chiusura della fase |
| M. Documentazione | T-12.41 → T-12.43 | |
| N. Consumer | T-12.44 → T-12.45 | la pubblicazione |
| O. Creazione degli account | T-12.46 → T-12.49 | |

F, G e J possono procedere in parallelo dopo E; H e I dopo E in quest'ordine; O dopo H, e prima
di I conviene perché I cabla la risoluzione di F40 che O tocca. J conviene subito
dopo E, perché ogni blocco successivo scrive i propri eventi.

---

## A. Correzione urgente

- [x] **T-12.1** Chiudere la sostituzione del fattore con il token temporaneo.
  **Cosa è stato fatto**: `mfaSetup` ed `mfaEnable` rispondono 409 `MFA_ALREADY_ENABLED` quando il
  soggetto ha già un fattore, sui due piani.
  **Evidenza**: commit `1b50994`; `lib/api/auth/controller/auth.ts:576-584` (la funzione
  `alreadyEnrolled` e il suo perché), `lib/api/system/controller/systemAuth.ts:229`, `:249`;
  quattro prove in `test/lib/mfaEnrolment.spec.ts`; `docs/API_V5.md:47-48`, `:186`.
  Restano fuori dalla correzione, e dentro la fase, le due debolezze della verifica MFA del tenant:
  non ricontrolla `isValidUser` e `blocked` dopo il primo fattore e accetta anche una sessione
  completa oltre al token temporaneo (`auth.ts:688`, `:697-716`). Spariscono con la rotta in
  T-12.34, e il motore le copre in T-12.14.

## B. Contratti e registro

- [x] **T-12.2** Tipi del motore.
  **Cosa fare**: `AuthenticatorKind` (`identifier` | `verifier`), `Authenticator` con `id`,
  `kind`, `planes`, `initiate?`, `verify`, `complete?` (l'input di un ritorno dall'esterno, GET o
  POST, già in forma di dizionario), `isEnrolled?`, `enrol?`; `AuthContext` (piano, `DataHandle`
  esplicito, tenant, soggetto se noto, politica effettiva, accesso ai manager, stato del flusso in
  sola lettura); `AuthResult` come unione discriminata `success` | `challenge` | `redirect` (con
  `binding: 'redirect' | 'post'`) | `pending` | `fail`, con `reason` sempre un codice;
  `AuthSubject` (id, `externalId`, email, ruoli, fattori iscritti, `confirmed`, `blocked`);
  `ChallengeDescriptor`; `StageDescriptor`.
  **Dove**: `types/global.d.ts`, esportazioni in `index.ts` accanto a `SessionManagement`
  (`index.ts:544-581`).
  **Criterio di chiusura**: `npm run type-check` verde, e due autenticatori finti in
  `test/lib/fixtures/` compilano contro il contratto senza cast: un identificatore con ritorno in
  POST (la forma di SAML) e un verificatore con sfida (la forma di sms).
  **Evidenza**: commit `d8b6890`; `types/global.d.ts:770` (`AuthPlane`), `:779` (`AuthSubject`),
  `:796` (`ChallengeDescriptor`), `:827` (`StageDescriptor`), `:838` (`AuthResult`), `:866`
  (`AuthContext`), `:887` (`Authenticator`); esportazioni in `index.ts:601`. I due finti in
  `test/lib/fixtures/authenticators.ts` (`postReturnIdentifier`, `challengeVerifier`), esercitati
  da due prove in `test/lib/authRegistry.spec.ts`; `npm run type-check` verde. Deriva dal piano:
  `kind` accetta anche entrambi i valori (`types/global.d.ts:890`, commit `0e2f98b`), perché
  `email-otp` identifica e verifica (F34) e un solo `kind` non lo poteva dire; `enrol` restituisce
  un `EnrolmentSetup` invece di un `AuthResult`, perché il segreto lo custodisce il motore e non il
  metodo (T-12.21).

- [x] **T-12.3** Registro degli autenticatori.
  **Cosa fare**: registro per piano con `register` (sostituzione per `id` dichiarata a log),
  `get`, `list`; built-in registrati prima di quelli del consumer; `start()` accetta
  `authenticators: Authenticator[]` accanto ai manager e non li decora come manager.
  **Dove**: `lib/auth/registry.ts` (nuovo), `index.ts:176` e `:323-335`.
  **Criterio di chiusura**: prova che un autenticatore iniettato con lo stesso `id` di un built-in
  lo sostituisce e lo dice a log, e che uno con `planes: ['tenant']` non è visibile dal piano di
  controllo.
  **Evidenza**: commit `d8b6890`; `lib/auth/registry.ts:31` (una mappa per piano, sostituzione a
  log, forma rifiutata alla registrazione), `:51`; built-in `password` e `totp` in
  `lib/auth/builtins.ts:12`, `:19`, che il motore non chiama ancora e rifiutano con un codice;
  `index.ts:188`, `:366` (il registro decorato come `authRegistry`, `authenticators` non decorato).
  Prove in `test/lib/authRegistry.spec.ts` («lets an injected authenticator with a built-in id
  replace it, and says so at log», «keeps a tenant-only authenticator out of the control plane»)
  e in `test/lib/authBoot.spec.ts` attraverso il vero `start()`.

- [x] **T-12.4** I nuovi port e i loro Null Object.
  **Cosa fare**: `AuthFlowManagement`, `ExternalIdentityManagement`,
  `IdentityProviderManagement`, `ChallengeDeliveryManagement`, `AccessLogManagement` (firme nel
  blocco D, in F43 e in F44), con le liste di metodi e i default in `lib/defaults/managers.ts`,
  costruiti dalla stessa `notImplemented` (`lib/defaults/managers.ts:26`); dichiarazione su
  `FastifyInstance` (`types/global.d.ts:918-927`).
  **Dove**: `types/global.d.ts`, `lib/defaults/managers.ts`, `index.ts:323-335`.
  **Criterio di chiusura**: `test/lib/defaultManagers.spec.ts` copre i cinque, e il server parte
  senza data layer con il flusso di default.
  **Evidenza**: commit `d8b6890`; i cinque port in `types/global.d.ts:1056`, `:1129`, `:1158`,
  `:1200`, `:1248`, con il vocabolario chiuso di F44 già qui (`:1206`) perché la firma di `record`
  lo nomina; dichiarati su `FastifyInstance` a `:1425`; default in
  `lib/defaults/managers.ts:134-148`, cablati in `index.ts:352`. `test/lib/defaultManagers.spec.ts`
  copre i cinque (più `sessionManager`, che mancava); `test/lib/authBoot.spec.ts` avvia `start()`
  senza data layer e con il flusso di default («boots, decorates the five new ports as Null
  Objects»).

## C. Configurazione e validazione all'avvio

- [x] **T-12.5** Il file `authFlows.ts` e il suo caricatore.
  **Cosa fare**: default del framework in `lib/config/authFlows.ts` (parità con oggi, F34);
  caricatore con semantica di **sostituzione per piano**; esposizione in sola lettura su
  `global.authFlows` per il manifest; blocco `limits` in camelCase (F5) con le quattro variabili
  d'ambiente che vincono.
  **Dove**: `lib/config/authFlows.ts`, `lib/loader/authFlows.ts` (nuovi), chiamata da `preload()`
  in `index.ts`.
  **Criterio di chiusura**: prova che un progetto che dichiara solo `tenant` eredita `control` dal
  framework e che uno stadio dichiarato dal progetto non si fonde con quello del framework.
  **Evidenza**: commit `0e2f98b`; `lib/config/authFlows.ts`, `lib/loader/authFlows.ts:29`
  (sostituzione per piano, limiti chiave per chiave con l'ambiente che vince, risultato congelato),
  chiamato da `preload()` (`index.ts:184`) e da `start()` quando `preload()` non è passato
  (`index.ts:192`, il caso del banco multi-tenant); `global.authFlows` a `types/global.d.ts:1476`;
  tipi della configurazione esportati da `index.ts:643`. Prova «lets a project that declares only
  `tenant` inherit `control`, and replaces the tenant block whole» in
  `test/lib/authFlowConfig.spec.ts`, sul progetto finto `test/lib/fixtures/authFlows/`. Il blocco
  `limits` porta le quattro voci con una variabile; i tetti per soggetto e le lunghezze del codice
  di F37 arrivano con `email-otp` (blocco G).

- [x] **T-12.6** Validazione che rifiuta l'avvio.
  **Cosa fare**: il processo non parte se: manca `'*'` o non è l'ultimo; un `id` non esiste nel
  registro di quel piano; `identify` contiene un verificatore, o uno stadio successivo contiene un
  identificatore; un `anyOf` è vuoto; un ruolo non esiste nel catalogo del piano (`roles.ts` per il
  tenant, `systemRoles.ts` per il controllo); `identifiers` di un flusso non è un sottoinsieme di
  `identify`; un provider di deployment manca di campi obbligatori o nomina una variabile
  d'ambiente vuota; è elencato `email-otp` senza `ChallengeDeliveryManagement`; è elencato `totp`,
  o una politica è `MANDATORY`, senza `MfaManagement` (estende `unavailableMandatory`,
  `mfaPolicy.ts:85-96`); è elencato un metodo a più passi senza `AuthFlowManagement` (F46);
  `oidc` è elencato e la libreria non si importa (F42). Un messaggio per causa, con la correzione.
  **Dove**: `lib/auth/validate.ts` (nuovo, puro e testabile come `unavailableMandatory`), chiamato
  in `index.ts` dopo la registrazione dei decoratori (`index.ts:337-352`).
  **Criterio di chiusura**: una prova per ogni causa in `test/lib/authFlowConfig.spec.ts`, ognuna
  sul testo del messaggio.
  **Evidenza**: commit `0e2f98b`; `lib/auth/validate.ts:217` (`authFlowProblems`, pura), chiamata in
  `index.ts:372-385` dopo i decoratori, dove assorbe il vecchio `unavailableMandatory`
  (`validate.ts:220`, stesso messaggio). Diciannove prove nel secondo `describe` di
  `test/lib/authFlowConfig.spec.ts`, una per causa e sul testo del messaggio, più due in `test/lib/authBoot.spec.ts` sul vero `start()` (il default passa,
  una configurazione sbagliata ferma l'avvio). Cause aggiunte al piano: `limits` non interi,
  blocchi di forma sbagliata, flusso senza ruoli, e `MANDATORY` su un piano che non ha `totp` da
  iscrivere (`validate.ts:184`). Due scelte da segnalare: `totp` rifiuta l'avvio senza
  `MfaManagement` solo in uno stadio non facoltativo (`:177`), e F46 non conta uno stadio
  facoltativo i cui metodi non hanno `initiate` (`:191`), perché il default ha uno stadio `totp`
  facoltativo e deve partire sia senza data layer sia sul data layer attuale, che fino a T-12.12 non
  porta `AuthFlowManagement`; chi ha già un fattore incontrerà il rifiuto del motore al passo
  (T-12.14). `MANDATORY` senza `AuthFlowManagement` non ferma ancora l'avvio: oggi il secondo
  passo non ha bisogno della riga, e rifiutarlo ora romperebbe i deploy `MANDATORY` prima di
  T-12.12; va aggiunto quando il motore sostituisce le rotte vecchie. `idp-mfa` non è registrato:
  arriva con T-12.30.

- [x] **T-12.7** La politica per tenant non può chiedere ciò che la build non sa dare.
  **Cosa fare**: oggi `checkTenantPolicy` valida solo la forza del valore (`mfaPolicy.ts:107-129`),
  quindi un operatore può scrivere `MANDATORY` su un tenant di una build senza MFA e bloccarne
  tutti gli utenti al primo login. La scrittura si rifiuta con un codice nuovo.
  **Dove**: `lib/api/tenants/controller/tenants.ts:183`, `:268`.
  **Criterio di chiusura**: prova del rifiuto in `test/lib/tenantProvisioning.spec.ts`.
  **Evidenza**: commit `0e2f98b`; `lib/api/tenants/controller/tenants.ts:172-181`, 503
  `MFA_POLICY_UNSUPPORTED` quando il piano tenant non ha `totp` da iscrivere
  (`lib/auth/validate.ts:65`), condiviso da creazione e aggiornamento (`:196`, `:281`); prova
  «answers 503 MFA_POLICY_UNSUPPORTED to MANDATORY when the tenant plane has nothing to enrol a
  user in» in `test/lib/tenantProvisioning.spec.ts:122`. Deriva dal piano: il caso di una build
  senza `MfaManagement` era già rifiutato, con 503 `MFA_NOT_AVAILABLE` (`tenants.ts:167-171`,
  commit `2986358`), e resta com'era; il codice nuovo copre ciò che il modello a flussi aggiunge.
  Il caso di una build senza `AuthFlowManagement` segue la stessa regola di T-12.6 e arriva con il
  motore.

## D. Persistenza

- [x] **T-12.8** Tabelle `auth_flow`, `external_identity` e `access_log` nello schema Postgres.
  **Cosa fare**: in `appTables` (`pg.ts:42-209`). `auth_flow`: `id`, `flow_id` (unico),
  `scope`, `subject_id` (nullo finché il soggetto non è provato), `candidate_subject_id` (il
  soggetto di un `email-otp` non ancora provato, per contare gli invii), `secret_hash`,
  `flow_name`, `stage_index`, `satisfied` (jsonb), `challenge_method`, `challenge_hash`,
  `challenge_expires_at`, `challenge_attempts`, `challenge_sends`, `last_sent_at`,
  `state_hash`, `external` (jsonb cifrato dal manager: provider, verificatore PKCE, `nonce`, segreto
  TOTP in iscrizione), `external_result` (jsonb: issuer, subject, email, verificata, `amr`/`acr`),
  `version`, `ip`, `user_agent`, `created_at`, `expires_at`. Indice unico parziale su
  `(subject_id, scope)` dove `subject_id` non è nullo, come `user_username_uq` (`pg.ts:79`); indici
  su `state_hash`, su `(candidate_subject_id, last_sent_at)` e su `expires_at`.
  `external_identity`: `id`, `scope`, `subject_id`, `provider`, `issuer`, `subject`,
  `email_at_link`, `created_at`, `last_used_at`, unico su `(scope, provider, issuer, subject)`,
  indice su `(subject_id, scope)`. `access_log` con le colonne di F44, senza `updated_at` né
  `deleted_at` (una riga di registro non si corregge), indici su `occurred_at` (la purga) e su
  `(subject_id, occurred_at)`. Più la colonna `auth_methods` su `session` (F45).
  **Dove**: `lib/database/schema/pg.ts`.
  **Criterio di chiusura**: `npm run check-all` verde.
  **Evidenza**: commit `9dc13c6`; `lib/database/schema/pg.ts:224` (`auth_flow`, con l'indice unico
  parziale `auth_flow_subject_uq` e gli indici su `state_hash`, `(candidate_subject_id,
  last_sent_at)` ed `expires_at`), `:263` (`external_identity`, unico `external_identity_key_uq` sulla
  quadrupla), `:284` (`access_log`, senza `updated_at` né `deleted_at`), `:199` (`session.auth_methods`);
  `npm run check-all` verde. Deriva dal piano: `external` è `text` e non `jsonb`, perché ciò che il
  manager scrive è il testo cifrato di `lib/database/crypto.ts` (`v2:salt:iv:tag:dati`), che in un
  `jsonb` sarebbe solo una stringa travestita.

- [x] **T-12.9** Le stesse tabelle nello schema SQLite, con gli stessi nomi.
  **Cosa fare**: convenzioni del dialetto già in uso (epoch in intero, JSON in testo, 0/1), indice
  parziale con la stessa clausola.
  **Dove**: `lib/database/schema/sqlite.ts`, `appTables`.
  **Criterio di chiusura**: `test/db/schema.spec.ts` vede tabelle, colonne e indici con nomi
  identici sui due dialetti.
  **Evidenza**: commit `9dc13c6`; `lib/database/schema/sqlite.ts:163` e seguenti, `:147`
  (`auth_methods` in JSON); `test/db/schema.spec.ts:47`, prova nuova che confronta nome, unicità e
  parzialità di ogni indice sui due dialetti, più le liste di tabelle aggiornate a `:27`.

- [x] **T-12.10** Tabella `identity_provider` nel registro.
  **Cosa fare**: in `registryTables` (`pg.ts:212-299`) e nella gemella SQLite: `id`, `tenant_id`,
  `key`, `type` (per ora `oidc`), `status`, `config` (jsonb, niente segreti), `secret_enc`, timbri;
  unico su `(tenant_id, key)`.
  **Dove**: i due schemi.
  **Criterio di chiusura**: la tabella esiste solo nell'insieme `control`, verificato da
  `test/db/schema.spec.ts`.
  **Evidenza**: commit `9dc13c6`; `lib/database/schema/pg.ts:399`, `lib/database/schema/sqlite.ts:334`,
  unico `identity_provider_tenant_key_uq`; `identity_provider` aggiunta a `CONTROL_ONLY` in
  `scripts/check-migration-sets.mjs:33`, e `test/db/schema.spec.ts` la tiene fuori da `appTables`.
  Deriva dal piano: timbri `created_at` e `updated_at` senza `deleted_at`, perché la rimozione è
  vera e una chiave deve tornare disponibile sotto il vincolo di unicità. Le righe di un tenant
  distrutto si tolgono con `removeAll`, prima del contenitore (chiuso il 26 settembre 2026).

- [x] **T-12.11** Le quattro migrazioni.
  **Cosa fare**: `npm run db:generate`, `db:generate:tenant`, `db:generate:sqlite`,
  `db:generate:tenant:sqlite`, SQL generato da drizzle-kit e committato come `0002_auth_flow_*`
  in `lib/database/migrations/{control,tenant}/{pg,sqlite}` accanto a `0001_sessions_*`.
  **Criterio di chiusura**: `npm run check:migration-sets` riporta tre migrazioni per insieme, e
  `npm run test:migrations` applica i quattro insiemi su un database vuoto e su uno fermo alla 0001.
  **Evidenza**: commit `9dc13c6`; `0002_auth_flow_control` e `0002_auth_flow_tenant` nei quattro
  insiemi, generate da drizzle-kit con `--name`; `npm run check:migration-sets` → «four migration
  sets: control/pg (3), control/sqlite (3), tenant/pg (3), tenant/sqlite (3)», con le tre tabelle in
  `SHARED` (`scripts/check-migration-sets.mjs:34`). `test/migrations/authFlowUpgrade.spec.ts`: su
  SQLite sempre e su Postgres con `DATABASE_URL`, contenitore vuoto e contenitore fermo alla 0001 con
  una sessione della fase 11, che arriva intatta con `auth_methods` nullo. Il controllo di versione
  all'avvio (`lib/loader/schemaVersion.ts`) legge l'atteso dal giornale e non ha nomi scritti: non
  è cambiato.

- [x] **T-12.12** I manager.
  **Cosa fare**: `AuthFlowManagement` con `openFlow` (sfratta lo slot del soggetto provato nella
  stessa istruzione), `findBySecret` (`current` | `expired` | `unknown`), `findByState`, `advance`
  (ottimistico su `version`, null se un altro passo ha vinto), `recordChallenge` (applica
  atomicamente i tetti per flusso e per soggetto di F37 e risponde `sent` o il limite toccato),
  `consumeChallenge` (`ok` | `invalid` con i tentativi rimasti | `exhausted` | `expired`, un solo
  `UPDATE` condizionato), `bindExternal`, `recordExternalResult`, `completeFlow`, `cancelFlow`,
  `purgeExpired`. `ExternalIdentityManagement` con `findLink`, `createLink`, `listOfSubject`,
  `removeLink`, `touch`. `IdentityProviderManagement` (solo `ControlHandle`) con `list`, `get`
  (configurazione decifrata), `create`, `update`, `remove`. `AccessLogManagement` di F44, con
  `record` che rifiuta un evento fuori lista e tronca l'IP secondo la configurazione. Nessuna
  istruzione di sessione su Postgres: tutto è una query qualificata, e `check:session-state` lo
  verifica.
  **Dove**: `lib/database/managers/{authFlow,externalIdentity,identityProvider,accessLog}.ts`,
  cablati in `buildManagers` (`lib/database/managers/index.ts:26-44`), esportati da `db.ts`.
  **Criterio di chiusura**: `test/db/authFlow.spec.ts` e `test/db/accessLog.spec.ts` su SQLite
  reale provano lo sfratto, il doppio invio concorrente dello stesso codice con un solo successo,
  i tetti che sopravvivono al riavvio del flusso, la cifratura dei campi esterni, il troncamento
  degli IPv4 e IPv6 e la purga per predicato.
  **Evidenza**: commit `9dc13c6`; `lib/database/managers/authFlow.ts` (`openFlow` a `:204`,
  `recordChallenge` a `:296` con il lucchetto consultivo di transazione su Postgres a `:339`,
  `consumeChallenge` a `:364`, `purgeExpired` a `:440`), `externalIdentity.ts`,
  `identityProvider.ts` (segreto cifrato con `encrypt` di `lib/database/crypto.ts`, restituito solo da
  `get`, `:67`), `accessLog.ts` (`truncateIp` a `:63`, rifiuti `ACCESS_EVENT_UNKNOWN` e
  `ACCESS_LOG_ENTRY_INVALID`); cablati in `lib/database/managers/index.ts:55-59`, quindi restituiti da
  `startDataLayer()` ed esportati da `db.ts`. `test/db/authFlow.spec.ts` (22 prove per motore) e
  `test/db/accessLog.spec.ts` (7) su SQLite migrato davvero, e su Postgres con `DATABASE_URL`:
  sfratto, flussi non provati che non sfrattano, quattro consumi concorrenti con un solo `ok`, tetti
  per soggetto attraverso flussi sfrattati e annullati, ventiquattro invii concorrenti da flussi
  diversi con esattamente tre riusciti (senza il lucchetto, su Postgres, ne passano ventuno: provato),
  cifratura di `external` e del segreto dell'IdP, IPv4 e IPv6 troncati, purga per predicato.
  Derive dal piano: lo sfratto e il completamento **non cancellano** la riga, la ritirano (segreti
  azzerati, slot liberato, soggetto conservato in `candidate_subject_id`), perché cancellarla
  azzerava il conto per soggetto e un attaccante con la password avrebbe potuto spedire codici senza
  tetto riavviando il flusso; `purgeExpired` tiene le righe finché i loro invii restano nella finestra
  più lunga (24 ore, opzione del manager). Lo sfratto è un `UPDATE` seguito dall'`INSERT`, con un
  nuovo tentativo sulla violazione dell'indice unico, e non una sola istruzione: SQLite non ha CTE
  che modificano, e sostituire la riga sul posto con un upsert perdeva gli invii. Lo sfratto avviene
  anche in `advance` quando un flusso diventa provato, che il piano non diceva. `version` si muove solo
  con `advance` e con il ritiro, non con le operazioni sul codice, altrimenti ogni invio farebbe
  perdere al motore il suo `advance`. `recordChallenge` e `consumeChallenge` vincolano anche l'hash
  del segreto del flusso, non solo il `flowId`. `findByState` risponde `null` per un flusso scaduto.
  Il blocco `accessLog` della configurazione arriva con T-12.31: oggi il manager legge
  `ACCESS_LOG_IP` a ogni scrittura o l'opzione `ip`; la lettura per piano dovrà filtrare `scope`
  sul server, perché `findQuery` non lo aggiunge da sé.

## E. Motore e rotte sui due piani

- [x] **T-12.13** Il credenziale del flusso.
  **Cosa è stato fatto**: `lib/util/flowCredential.ts` compone e legge `vf1.<routing>.<flowId>.<segreto>`
  e `st1.<routing>.<segreto>` con le regole di `parseRefreshCredential`, e sceglie il canale
  (`presentedFlow`); i cookie `auth_flow` e `control_flow`, con il loro percorso, stanno in
  `lib/util/credential.ts` accanto a quelli di sessione.
  **Evidenza**: commit `90609d7`; `lib/util/flowCredential.ts:34` (composizione), `:41` (parsing che
  risponde `null`), `:52` (`newFlowState`), `:74` (`presentedFlow`); `lib/util/credential.ts:161` (`FLOW_COOKIES`),
  `:166`, `:171` (percorso e lettura), `:216`, `:220` (scrittura e cancellazione). Quattro
  prove in `test/lib/flowCredential.spec.ts`: i dieci credenziali malformati che rispondono `null`
  invece di lanciare, lo `state` di 63 byte con un `routing` UUID (limite 80), e i due canali mai
  scambiabili, header compreso. Deriva dal piano: il segreto del flusso è lo stesso `newSessionSecret`
  (32 byte), quello di `state` è di 16 byte per stare nel limite di `RelayState`.

- [x] **T-12.14** Il motore.
  **Cosa è stato fatto**: `lib/auth/engine.ts`, un solo modulo per i due piani, che riceve un
  `FlowPlane` (contenitore, politica, flussi, come si carica un soggetto, come si apre una sessione)
  e risponde un esito; l'HTTP resta fuori.
  **Evidenza**: commit `90609d7`; `lib/auth/engine.ts:154` (`planStages`, `optional` e pavimento F35),
  `:190` (`stageOptions`, l'iscrizione offerta solo dove la politica la accetta e il soggetto non ha
  fattori), `:259` (`proceed`), `:281` (`complete`, una sola `issueSession`), `:341` (`locate`,
  routing e piano), `:421` (`step`, rivalidazione prima e dopo il fattore), `:67` (la tabella dei
  rifiuti). Quattordici prove in `test/lib/authEngine.spec.ts`: AND, OR, `optional`,
  scelta per ruolo con un soggetto multi-ruolo, identificatore non ammesso dal ruolo, pavimento
  `MANDATORY` che aggiunge l'iscrizione, soggetto bloccato fra i due passi e soggetto bloccato
  durante la verifica, tetto dei tentativi, due passi in corsa con un solo vincitore, credenziale di
  un altro routing o di un altro piano, F46 senza store, sfida di un verificatore in stile SMS,
  ritorno in POST dell'identificatore finto. Derive dal piano: gli stadi si **ricalcolano** a ogni
  passo invece di essere fissati all'apertura (la politica per tenant e i fattori del soggetto
  cambiano dentro il flusso), e il flusso scelto si conserva come indice in `flow_name`; il
  completamento ritira la riga **prima** di aprire la sessione, così un flusso vale una sessione sola.

- [x] **T-12.15** Le rotte del piano tenant.
  **Cosa fare**: `GET /auth/flow/options`, `POST /auth/flow/start`, `POST /auth/flow/step`,
  `POST /auth/flow/challenge`, `POST /auth/flow/cancel`, `GET /auth/flow/return/:method`
  (la variante POST si aggiunge con il primo metodo che la usa, §3); limiti di F44; i middleware
  `global.preAuth` e `global.postAuth` restano dichiarati su `start` e `step` come oggi su `/login`
  (`routes.ts:131-146`), perché il sample li sostituisce
  (`volcanic-backend-sample/src/middleware/postAuth.ts:7`); schemi JSON per corpi e risposte 200 e
  202 in `lib/schemas/auth.ts`, senza dimenticare che lo schema di risposta filtra i campi (il
  difetto trovato in fase 11 sul rinnovo).
  **Dove**: `lib/api/auth/routes.ts`, `lib/api/auth/controller/flow.ts` (nuovo, sottile),
  `lib/schemas/auth.ts`.
  **Evidenza**: commit `90609d7`; `lib/api/auth/routes.ts:286-377` (le sei rotte con i limiti di F44,
  `preAuth` e `postAuth` su `start` e `step`), `lib/api/auth/controller/flow.ts` (tre righe: nomina il
  piano), `lib/auth/http.ts:170` (`flowHandlers`), `lib/schemas/auth.ts:209-296` (corpi e risposte 200
  e 202; `enrol` e `action` restano aperti perché hanno più forme). Dodici prove in bearer e una in
  cookie in `test/lib/authFlowRoutes.spec.ts`, che montano le rotte dai file veri con i loro schemi e
  il gancio vero. Deriva dal piano: la variante POST del ritorno non esiste ancora (nessun metodo la
  usa, §3), e `/auth/flow/challenge` esiste già ma sarà `email-otp` a esercitarla (blocco G).

- [x] **T-12.16** Le rotte del piano di controllo.
  **Cosa fare**: le gemelle sotto `/system/auth/flow/*` con `scope: 'control'`, stesso
  controller parametrizzato per piano, sessione nel piano di controllo con `routing` `ctl`
  (`systemAuth.ts:50-60`). Il login fallito della piattaforma diventa 401
  `AUTH_INVALID_CREDENTIALS`, allineando il codice a `docs/API_V5.md:182`.
  **Dove**: `lib/api/system/routes.ts`, `lib/api/system/controller/systemFlow.ts` o lo stesso
  controller.
  **Evidenza**: commit `90609d7`; `lib/api/system/routes.ts:61-133` (le gemelle sotto
  `/system/auth/flow/*`, `scope: 'control'` dal blocco del file), `lib/api/system/controller/systemFlow.ts`,
  `lib/auth/http.ts:54-95` (il piano di controllo: contenitore `req.control`, sessione con routing
  `ctl`, 503 `SYSTEM_USERS_NOT_AVAILABLE`). Il login fallito della piattaforma ora è 401
  `AUTH_INVALID_CREDENTIALS` (`lib/auth/authenticators/password.ts:41-45`), allineato a `docs/API_V5.md:182`.
  Cinque prove nel terzo `describe` di `test/lib/authFlowRoutes.spec.ts`: il 401 uniforme, la sessione
  di controllo senza `tid`, un utente di tenant che non completa nulla sul piano di controllo, il
  credenziale di un piano presentato sull'altro (403 `TENANT_MISMATCH` in un verso, rifiuto nell'altro)
  e l'iscrizione forzata di un operatore.

- [x] **T-12.17** Risoluzione del tenant sui passi e sui ritorni.
  **Cosa fare**: su `start` il tenant arriva dal resolver come oggi (`tenant.ts:134-137`); su
  `step`, `challenge` e `cancel` il `routing` del credenziale è confrontato con il tenant risolto,
  `TENANT_MISMATCH` se diverge, come il rinnovo (T-11.11). Per i ritorni un flag di rotta
  riservato al framework, `tenantFrom: 'flow-state'`, fa sì che `tenant.ts` legga il `routing` da
  `state`, applichi le stesse verifiche di stato e di schema (`tenant.ts:142-161`) e confronti un
  eventuale tenant dichiarato; il router rifiuta l'avvio se un consumer lo dichiara, come fa con
  `tenantContext` (`lib/loader/router.ts:261-275`). Il flag legge il parametro dal nome che il
  metodo dichiara, così `RelayState` non richiederà una seconda regola.
  **Dove**: `lib/loader/tenant.ts:89-162`, `lib/loader/router.ts:434-470`.
  **Evidenza**: commit `90609d7`; `lib/auth/engine.ts:346` (il `routing` confrontato con il contenitore
  risolto, `TENANT_MISMATCH`), `lib/loader/tenant.ts:121-132` (il ramo `tenantFrom: 'flow-state'`) e
  `:211` (`stateRouting`, che legge il parametro dal nome dichiarato dal metodo),
  `lib/loader/router.ts:282-284` (il flag rifiutato sulla rotta di un consumer), `:355` e `:482`.
  Sei prove nuove in `test/lib/tenantResolution.spec.ts` (ritorno senza token né header, nome del
  parametro, `state` assente o malformato, routing sconosciuto e tenant sospeso entrambi 404, header
  o token discordi 403, stessa cosa con il resolver a sottodominio) e una in `test/lib/router.spec.ts`
  sul flag riservato. Il banco multi-tenant resta a T-12.39 come dice il piano.

- [x] **T-12.18** Pulizia dei flussi morti.
  **Cosa è stato fatto**: purga opportunistica su un `start` su cinquanta e comando
  `npx volcanic auth-flows --purge [--tenants]`, con la stessa paginazione della flotta di `sessions`.
  **Evidenza**: commit `90609d7`; `lib/auth/engine.ts:248` (`maybePurge`, attesa e dentro un `try`,
  come quella delle sessioni), `bin/volcanic.mjs:33` (uso), `:63-67` e `:86-113` (un solo ramo per i
  due comandi, il manager scelto dal nome). La prova del predicato è quella di T-12.12,
  `test/db/authFlow.spec.ts:274` («purges dead flows by predicate, keeping those whose sends still
  count»), su SQLite e su Postgres. Deriva dal piano: il comando non ha un test proprio, perché la CLI
  richiede il pacchetto compilato e non ne ha uno neppure `sessions`.

## F. `password` e `totp`

- [x] **T-12.19** `password` come identificatore.
  **Cosa è stato fatto**: `lib/auth/authenticators/password.ts`, un autenticatore con i due rami di
  piano: la risposta uniforme di D-17, la causa vera solo nel log, `PASSWORD_TO_BE_CHANGED` dopo la
  verifica e solo per chi si identifica con la password.
  **Evidenza**: commit `90609d7`; `lib/auth/authenticators/password.ts:19` (`refused`, la causa a log),
  `:24` (piano tenant, l'ordine dei controlli di `auth.ts:358-391`), `:41` (piano di controllo, che
  adesso risponde come il tenant), `lib/auth/subjects.ts:15` (`toSubject`). La prova «gives every
  failure before a verified password the one uniform refusal (D-17, T-12.19)» in
  `test/lib/authFlowRoutes.spec.ts` ripete sulle rotte nuove il contenuto di
  `test/lib/authMessages.spec.ts`, che resta verde sulle rotte vecchie. Deriva dal piano: un indirizzo
  malformato risponde 400 `AUTH_INPUT_INVALID` invece del 400 senza codice di `auth.ts:347`, perché il
  motore porta un codice a ogni rifiuto.

- [x] **T-12.20** `totp` come verificatore.
  **Cosa è stato fatto**: `lib/auth/authenticators/totp.ts`, con il contatore scritto secondo il piano
  e il replay indistinguibile da un codice sbagliato.
  **Evidenza**: commit `90609d7`; `lib/auth/authenticators/totp.ts:19` (i due archivi per piano), `:59`
  (`verify`: `absoluteStep` atteso, `isReplay`, contatore), `:52` (`isEnrolled` dai fattori del
  soggetto). Il tentativo si prenota **prima** della verifica (`lib/auth/engine.ts:455-461`,
  `authFlowManager.recordAttempt`), quindi una raffica di codici in parallelo incontra il tetto invece
  di superarlo: prova su database reale in `test/db/authFlow.spec.ts` («reserves verifications under
  the ceiling, a burst of them included»). Prove HTTP in `test/lib/authFlowRoutes.spec.ts`: codice
  sbagliato con i tentativi rimasti, replay rifiutato come un codice sbagliato, cinque errori che
  chiudono il flusso. Deriva dal piano: `recordAttempt` è un metodo **nuovo** del port
  `AuthFlowManagement` (`types/global.d.ts:1117`), perché il contatore dei tentativi esisteva solo per
  i codici che la riga custodisce; un tentativo è una verifica, giusta o sbagliata che sia.

- [x] **T-12.21** Iscrizione dentro il flusso.
  **Cosa è stato fatto**: lo stadio espone `enrol: true`, un `step` con `action: 'enrol'` genera il
  segreto lato server e lo lascia cifrato nella riga, il `step` successivo con il codice lo conferma e
  prosegue; rifiutata sotto `OFF` e per chi ha già un fattore.
  **Evidenza**: commit `90609d7`; `lib/auth/engine.ts:442-451` (il ramo `enrol`, il segreto legato alla
  riga con `bindExternal`), `:190-203` (l'opzione offerta solo se `allowsEnrolment(policy)` e il
  soggetto non ha fattori), `lib/auth/authenticators/totp.ts:54` (`enrol` con `generateSetup`) e
  `:75-76` (il codice che sposta il segreto sull'utente). Prove sui due
  piani in `test/lib/authFlowRoutes.spec.ts` («enrols a subject with no factor inside the flow under
  MANDATORY, the secret shown once», «enrols an operator with no factor inside the flow under a
  MANDATORY platform policy», «refuses to enrol a second factor inside the flow for a subject who has
  one»): il segreto compare nella sola risposta di iscrizione, non nelle successive, e la riga ritirata
  non lo contiene più. Chiuso qui anche il rinvio del blocco C: `MANDATORY` senza `AuthFlowManagement`
  rifiuta l'avvio (`lib/auth/validate.ts:200-202`) e la scrittura sul tenant (503
  `AUTH_FLOW_NOT_AVAILABLE`, `lib/api/tenants/controller/tenants.ts:172-177`), con una prova per
  ciascuno in `test/lib/authFlowConfig.spec.ts` e `test/lib/tenantProvisioning.spec.ts`.

## G. `email-otp`

- [x] **T-12.22** L'autenticatore, nei due ruoli.
  **Cosa fare**: come verificatore, destinazione l'email del soggetto, applicabile solo se
  `confirmed`; come identificatore, risposta uniforme di F43 e riga non provata con
  `candidate_subject_id`. Codice dal CSPRNG, lunghezza di F37, conservato come HMAC con il segreto
  del flusso, confronto nel manager con consumo atomico.
  **Dove**: `lib/auth/authenticators/emailOtp.ts`.
  **Criterio di chiusura**: prove di codice scaduto, sbagliato, riusato, e di risposta identica
  per indirizzo esistente e inesistente, corpo e stato.
  **Evidenza**: commit `5221dce`. `lib/auth/authenticators/emailOtp.ts` (`initiate` a `:163`,
  `verify` a `:185`), registrato fra i built-in in `lib/auth/builtins.ts`. Il codice non passa mai
  per le mani dell'autenticatore insieme al segreto del flusso: `FlowChallenges`
  (`types/global.d.ts:901`) sono le tre operazioni che il motore lega al credenziale della richiesta
  (`lib/auth/engine.ts:129`). Prove su SQLite e su Postgres in `test/db/emailOtp.spec.ts`: otto cifre
  all'indirizzo in archivio e login con quelle sole, indirizzo inesistente con la stessa risposta,
  lo stesso conto dei tentativi e nessuna consegna, codice sbagliato che lascia vivo il flusso e
  quinto errore che lo chiude, codice scaduto (`FLOW_CODE_EXPIRED`, flusso vivo) e nuovo codice che
  poi passa, codice consumato che lo store non riprende, verificatore a sei cifre verso l'indirizzo
  in archivio e mai verso quello del corpo.
  Derive dal piano: il contratto cresce di due campi. `AuthContext` porta `limits` e `challenges`;
  il fallimento di `AuthResult` porta `recoverable`, `remaining` e `retryAt`, perché prima un codice
  sbagliato prima della prova del soggetto chiudeva il flusso al primo errore
  (`lib/auth/engine.ts:456`). Il pavimento MFA ora offre solo i verificatori che la configurazione
  del piano nomina, più `totp` (`:169`): un `email-otp` registrato ma non elencato non ha un port
  dietro, e il boot controlla solo ciò che è elencato. Il primo invio come verificatore è chiesto
  dal client con `/flow/challenge`, come il rinvio: il motore non spedisce un codice a chi sceglierà
  l'app.

- [x] **T-12.23** Consegna e rinvio.
  **Cosa fare**: `initiate` chiama `ChallengeDeliveryManagement.deliver` dopo la decisione della
  risposta; `POST /auth/flow/challenge` rinvia nei tetti di F37 e risponde il prossimo istante
  utile; `FLOW_SEND_LIMIT` quando un tetto è toccato.
  **Criterio di chiusura**: prova che ricominciare il flusso non azzera il conto per soggetto, e
  che un errore del port finisce a log senza cambiare la risposta.
  **Evidenza**: commit `5221dce`. Consegna dopo la risposta e mai attesa (`emailOtp.ts:83`), tetti
  per soggetto in `SUBJECT_SEND_WINDOWS`, rifiuti `FLOW_SEND_LIMIT` (429, con `retryAt`) e
  `FLOW_CODE_EXPIRED` in `lib/auth/engine.ts:76-77`, evento `challenge.sent`. Prove in
  `test/db/emailOtp.spec.ts`: tre invii per flusso con `resendAt` nullo sull'ultimo e il quarto
  rifiutato, sette avvii per lo stesso indirizzo con cinque consegne e sette risposte identiche,
  lo stesso soggetto come verificatore rifiutato con `retryAt` futuro, un port che lancia finisce a
  log e la risposta è identica.
  Deriva dal piano: come identificatore il tetto per soggetto non si dice, si risponde come un invio
  riuscito e non si spedisce nulla, altrimenti il sesto avvio in un quarto d'ora direbbe che
  l'indirizzo è di qualcuno. Il tetto per flusso resta detto, perché vale uguale per ogni indirizzo.

- [x] **T-12.24** Un flusso non provato non sfratta.
  **Cosa fare**: il caso di negazione del servizio: chi conosce solo l'indirizzo non deve poter
  chiudere il flusso in corso della vittima avviandone di nuovi.
  **Criterio di chiusura**: prova con un flusso `password → totp` a metà e dieci `start` di
  `email-otp` sullo stesso indirizzo: il primo flusso si completa.
  **Evidenza**: commit `5221dce`, `test/db/emailOtp.spec.ts`, sullo store vero su SQLite e Postgres.

## H. Provider di identità

- [x] **T-12.25** Provider di deployment.
  **Cosa fare**: lettura dei `providers` di `authFlows.ts` per piano, segreti letti da
  `clientSecretEnv` all'avvio e mai scritti a log; `redirectUri` esplicito e obbligatorio, mai
  ricavato dall'header `Host`.
  **Criterio di chiusura**: prova che una variabile vuota rifiuta l'avvio (T-12.6).
  **Evidenza**: commit `4f66889`. `lib/auth/providers.ts`: `providerShapeProblems` (`:58`), applicata
  ai provider di deployment in `lib/auth/validate.ts`; `captureDeploymentSecrets` (`:122`) chiamata
  all'avvio in `index.ts:388`, dopo la validazione; `resolveProvider` (`:139`). Prove in
  `test/lib/identityProviders.spec.ts`: variabile vuota e issuer `http` rifiutano l'avvio senza mai
  stampare il valore, il segreto non compare nei flussi congelati, il provider del tenant attivo vince
  su quello di deployment e uno disattivato nasconde la chiave.
  Deriva dal piano: a parità di chiave vince il provider del tenant, e uno disattivato nasconde quello
  di deployment; il piano non diceva la precedenza.

- [x] **T-12.26** Provider per tenant e rotte di controllo.
  **Cosa fare**: `GET`, `POST`, `PUT`, `DELETE` su `/tenants/:id/identity-providers[/:key]` con
  capability `tenants`, il segreto accettato in scrittura e mai restituito; validazione della
  forma alla scrittura (issuer `https`, `redirectUri` assoluto, `type` noto), senza chiamate di
  rete.
  **Dove**: `lib/api/tenants/routes.ts`, controller nuovo, schemi in `lib/schemas/tenant.ts`.
  **Criterio di chiusura**: prova che nessuna risposta, lista compresa, contiene `secret`, e che un
  operatore senza `tenants` riceve 403.
  **Evidenza**: commit `4f66889`. `lib/api/tenants/routes.ts:202` e seguenti,
  `lib/api/tenants/controller/identityProviders.ts`, schemi in `lib/schemas/tenant.ts`
  (`hasClientSecret` al posto del segreto). Prove in `test/lib/identityProviders.spec.ts` con un
  manager che restituisce apposta il segreto in ogni risposta: nessuna risposta lo contiene, né
  `clientSecret` né `secretEnc`; `system:auditor` riceve 403 su tutte e cinque le rotte; forma
  sbagliata o segreto dentro `config` è `IDP_CONFIG_INVALID`, chiave doppia `IDP_KEY_TAKEN`, build
  senza manager `IDENTITY_PROVIDERS_NOT_AVAILABLE`.
  Deriva dal piano: `config` è un insieme chiuso di chiavi, perché è salvato in chiaro e un segreto
  messo lì per errore uscirebbe alla prima lista.

- [x] **T-12.27** Collegamenti e JIT.
  **Cosa fare**: la risoluzione di F40 nel motore dopo un ritorno riuscito: collegamento esistente,
  poi collegamento per email se il provider lo consente con le tre condizioni, poi JIT se acceso,
  altrimenti `IDP_IDENTITY_NOT_LINKED`; `GET /auth/identities` e `DELETE /auth/identities/:id`
  per l'utente (vedere e togliere, non aggiungere: F48), creazione e rimozione da amministratore
  sotto `/users/:id/identities`.
  **Criterio di chiusura**: prove per email non verificata, dominio fuori lista, JIT spento, JIT
  che tenta il ruolo admin, stesso `sub` da due issuer diversi.
  **Evidenza**: commit `4f66889`. `resolveExternal` in `lib/auth/external.ts:59`, pronta per
  l'autenticatore OIDC del blocco I, che la chiamerà e scriverà l'evento che restituisce. Rotte
  `lib/api/auth/routes.ts:380` e `lib/api/users/routes.ts:264`, `:277`. Prove su SQLite e Postgres
  in `test/db/externalIdentity.spec.ts` (i cinque casi del criterio, più l'account bloccato che resta
  fuori anche con il collegamento e il JIT sul piano di controllo) e via HTTP in
  `test/lib/externalIdentities.spec.ts` (il collegamento di un altro è 404, `IDP_LINK_TAKEN`,
  `IDP_UNKNOWN_PROVIDER`, eventi `idp.linked` e `idp.unlinked`).
  Derive dal piano: la risoluzione non è ancora cablata nel motore, perché nessun metodo produce un
  ritorno prima del blocco I. Le rotte dei collegamenti esistono solo sul piano tenant: per gli
  operatori il piano non le chiedeva. Il JIT con indirizzo non verificato, che il piano faceva
  nascere non confermato e quindi a occupare l'indirizzo, è stato poi rifiutato del tutto: nessun
  account senza l'email verificata dal provider.

## I. OIDC

- [x] **T-12.28** Caricamento pigro e client.
  **Cosa fare**: `await import('openid-client')` alla prima necessità e alla validazione di avvio;
  discovery con cache per provider e scadenza; `client_secret_basic` o `client_secret_post`;
  `private_key_jwt` rinviato.
  **Dove**: `lib/auth/authenticators/oidc.ts`; regola nuova in `.dependency-cruiser.cjs`;
  `package.json`, `peerDependencies` e `peerDependenciesMeta`.
  **Criterio di chiusura**: `npm run depcruise` rifiuta un import statico di prova; `attw` e
  `publint` verdi; l'avvio senza la libreria e con `oidc` in un flusso fallisce con il comando
  `npm i openid-client@^6`.
  **Evidenza**: `lib/auth/authenticators/oidc.ts` (`load` con `await import`, discovery in cache
  un'ora per issuer, client e hash del segreto, timeout 10 s, una discovery fallita non resta in
  cache; `client_secret_basic` di default, `client_secret_post`, e client pubblico con `None()` e
  PKCE dove il provider del tenant non ha segreto); registrato fra i metodi integrati su entrambi i
  piani (`lib/auth/builtins.ts`). Regola `federation-libraries-lazy-only` in
  `.dependency-cruiser.cjs`: un file di prova con `import { discovery } from 'openid-client'` dà
  `error federation-libraries-lazy-only`, e l'import di `oidc.ts` risulta `dynamic-import`.
  `openid-client@^6.8.8` peer facoltativa e dipendenza di sviluppo; `publint` «All good», `attw
  --profile esm-only` senza problemi nuovi. Il messaggio di avvio c'era già da T-12.6
  (`test/lib/authFlowConfig.spec.ts`). Deriva: `useOidcFetch` sostituisce il `fetch` del client,
  per le prove e per un deployment dietro proxy; non è esportato da `index.ts`.

- [x] **T-12.29** Andata e ritorno.
  **Cosa fare**: `initiate` crea o aggiorna la riga con `state_hash`, verificatore PKCE e `nonce`
  cifrati, `acr_values` se F41 lo chiede, e risponde `action: redirect`; `complete` chiama
  `authorizationCodeGrant` con `expectedState`, verificatore e `expectedNonce`, legge i claim,
  registra l'esito e la rotta risponde 303 verso `returnUrl` più un `returnTo` solo di percorso; il
  successivo `step { method: 'oidc' }` riscuote.
  **Criterio di chiusura**: prove per `state` sconosciuto, `nonce` sbagliato, codice riusato,
  ritorno riscosso da un credenziale di flusso diverso, `returnTo` assoluto rifiutato.
  **Evidenza**: `initiate`, `complete` e `verify` in `oidc.ts`; nel motore
  (`lib/auth/engine.ts`) il contesto dà all'autenticatore `provider` (la risoluzione di F38),
  `roundTrip.begin` (il motore costruisce lo `state` con il proprio routing e lega verificatore,
  `nonce` e `returnTo` cifrati nella riga) e `record` (l'evento di F40 scritto dall'autenticatore);
  `returnFrom` riporta il `returnTo` e `lib/auth/http.ts` lo aggiunge come parametro al `returnUrl`
  del 303. `GET /auth/flow/options` elenca sotto `oidc` le chiavi dei provider del piano e del
  tenant (un provider disattivato del tenant nasconde quello del deployment con la stessa chiave).
  Codici nuovi con il loro stato: `IDP_UNKNOWN_PROVIDER` 400, `IDP_UNAVAILABLE` 502,
  `IDP_RETURN_PENDING` 409 (il passo arrivato prima del browser, il flusso resta),
  `IDP_RETURN_INVALID` 401, `IDP_DENIED` 401, `IDP_IDENTITY_NOT_LINKED` e
  `ACCOUNT_PENDING_APPROVAL` 403. Prove: `test/db/oidc.spec.ts` con lo store vero su SQLite e
  Postgres (i cinque casi del criterio, più diniego al provider, provider irraggiungibile,
  provider sconosciuto), `test/lib/oidcRoutes.spec.ts` via HTTP (303 con `returnTo`, nessun cookie
  né token sul ritorno, sessione al passo successivo, provider disattivato dal tenant). L'IdP finto
  senza rete di T-12.40 è anticipato in `test/lib/fixtures/fakeIdp.ts`: chiavi RS256 vere, PKCE
  verificato allo scambio, codice speso una volta.

- [x] **T-12.30** `amr` e `acr`.
  **Cosa fare**: F41, con `idp-mfa` segnato solo quando il provider dichiara la fiducia e il claim
  la porta.
  **Criterio di chiusura**: prova che lo stesso `amr` con `trust` assente lascia il secondo
  stadio da fare.
  **Evidenza**: `idpSecondFactor` in `oidc.ts`, `acr_values` nella richiesta quando la fiducia è su
  `acr`; `idp-mfa` entra in `satisfied` e conta per il pavimento di F35 senza modifiche al motore.
  La validazione di avvio accetta `idp-mfa` in uno stadio solo dove `identify` elenca `oidc`
  (`lib/auth/validate.ts`). Prove in `test/db/oidc.spec.ts` (fiducia `amr` soddisfatta, stesso
  `amr` senza fiducia e valore non elencato che lasciano lo stadio, `acr`) e
  `test/lib/authFlowConfig.spec.ts`.

## J. Registro degli accessi

- [x] **T-12.31** Il vocabolario e lo scrittore.
  **Cosa fare**: il tipo chiuso degli eventi di F44 in `types/global.d.ts`; un solo scrittore nel
  core, `recordAccess(req, entry)`, che sceglie il contenitore con `dataContext` o il piano di
  controllo secondo il piano, chiede `isImplemented()`, attende l'`insert` dentro un `try` e scrive
  sempre anche la riga di log; le chiamate nel motore, in `logout`, `invalidateTokens`, nelle rotte
  MFA di gestione, nella revoca delle sessioni e nel rilevamento del riuso
  (`renewal.ts:103-106`), sui due piani. Il blocco `accessLog` della configurazione con le tre
  variabili d'ambiente.
  **Dove**: `lib/util/accessLog.ts` (nuovo), `lib/config/general.ts`, i controller citati.
  **Criterio di chiusura**: prova che un manager che lancia a ogni `record` lascia il login
  riuscito identico nel corpo e nello stato, e prova per ogni evento della lista che il campo
  segreto dell'input (password, codice, token) non compare nella riga.
  **Evidenza**: commit `01e84e9`. Blocco `accessLog` in `lib/config/general.ts:71` e in
  `types/global.d.ts` (`GeneralConfig.options.accessLog`), letto dal manager con l'ambiente che
  vince (`lib/database/managers/accessLog.ts:115`) e passato da `buildManagers(provider, options)`
  (`db.ts`). Scrittori `recordTenantAccess` e `recordControlAccess` in `lib/util/accessLog.ts`;
  chiamate in `lib/api/auth/controller/auth.ts:452` (`logout`), `:513` (`tokens.invalidated`),
  `:578` (`session.revoked`), `:648` (`mfa.enrolled`), `:765` (`mfa.disabled`),
  `lib/api/users/controller/user.ts:257` (reset dell'admin), `lib/api/system/controller/systemAuth.ts:160`,
  `:173`, `:273`, `systemUser.ts:56`, `lib/util/renewal.ts:105` (`session.reuse_detected`, con lo
  scope della riga). `test/lib/accessLogWrites.spec.ts`: ogni evento sul suo contenitore e con il suo
  soggetto sui due piani, nessuna riga che contenga password, codice, segreto TOTP, token d'accesso
  o credenziale di rinnovo, e un manager che lancia a ogni `record` lascia identici stato e corpo di
  sette rotte (provato che la prova fallisce se lo scrittore rilancia). La parità del login riuscito
  era già in `test/lib/authFlowRoutes.spec.ts:337`.
  Derive dal piano: `subject_id` è l'`externalId`, che ruota con `invalidate-tokens` e con
  `reset_external_id_on_login`, quindi le righe di prima restano sull'identificativo ritirato;
  `tokens.invalidated` si scrive con quello, perché è quello che portano le righe precedenti. Un
  `logout` senza sessione non scrive nulla, altrimenti chiunque riempirebbe la tabella. Le rotte
  vecchie (`/auth/login`, `/auth/mfa/verify` e le gemelle di sistema) non scrivono: spariscono in K.

- [x] **T-12.32** La lettura, sui due piani.
  **Cosa fare**: `GET /access-log` e `/access-log/count` per il ruolo `admin` del tenant,
  `GET /system/access-log` e `/count` con la capability nuova `access-log`, aggiunta al catalogo
  chiuso (`types/global.d.ts:67-75`) e concessa a `system:auditor`; Magic Query sui soli campi di
  F44; schemi di risposta senza campi in più.
  **Dove**: `lib/api/accessLog/` e `lib/api/system/routes.ts`, `lib/config/systemRoles.ts`,
  `lib/schemas/`.
  **Criterio di chiusura**: prova che un utente senza `admin` riceve 403, che un filtro su un campo
  fuori elenco è un rifiuto, e che il manifest di ciascun piano annuncia la sua rotta.
  **Evidenza**: commit `01e84e9`. `lib/api/access-log/` (rotte e controller), `lib/api/system/routes.ts:205`,
  `:219` con `systemAccessLog.ts`, `lib/schemas/accessLog.ts`, capability `access-log` in
  `types/global.d.ts`, `lib/loader/roles.ts:26` e concessa a `system:auditor` in
  `lib/config/systemRoles.ts:38`. Lo scope passa al manager come `extraWhere`, messo in AND dopo
  tutto ciò che chiede l'URL. Prove: `test/lib/accessLogWrites.spec.ts` (403 a un utente senza
  `admin`, 401 anonimo, 403 a `system:operator` e a un token di tenant sulla rotta di sistema, campi
  in più tolti dallo schema di risposta), `test/db/accessLog.spec.ts` (una query che chiede
  `scope: 'control'` sul piano tenant trova zero righe, `userAgent` è `QUERY_UNKNOWN_FIELD`),
  `test/lib/manifestRealRoutes.spec.ts` (risorsa `systemAccessLog` a `system/access-log` per
  l'auditor e non per l'operatore, risorsa `accessLog` a `/access-log` per `admin`, assente dal
  manifest di piattaforma). `docs/API_V5.md` e `docs/AUTHORIZATION_V5.md` aggiornati.
  Derive dal piano: la cartella è `lib/api/access-log/` e non `accessLog/`, perché il router ricava
  il segmento dell'URL dal nome della cartella. Il contratto cambia: `findQuery`, `countQuery` e
  `purgeBefore` prendono uno `scope` opzionale.

- [x] **T-12.33** Conservazione e purga.
  **Cosa fare**: purga opportunistica per predicato e comando
  `npx volcanic access-log --purge [--tenants]` accanto a `sessions`, con le due soglie per piano.
  **Dove**: `bin/volcanic.mjs`, `lib/util/accessLog.ts`.
  **Criterio di chiusura**: prova che una riga oltre la soglia sparisce e una dentro resta, sui
  due piani con le due soglie distinte; `npx volcanic access-log --purge --tenants` pagina oltre i
  primi mille tenant come fa `sessions`.
  **Evidenza**: commit `01e84e9`. `purgeExpired` in `lib/database/managers/accessLog.ts:179`, le due
  soglie in una sola istruzione; purga opportunistica in `lib/util/accessLog.ts:35`; comando in
  `bin/volcanic.mjs:70`. Il ciclo sulla flotta è uscito dalla CLI in `lib/database/purge.ts`
  (`purgeContainers`, esportato da `db.ts`) ed è condiviso da `sessions`, `auth-flows` e
  `access-log`. Prove: `test/db/accessLog.spec.ts`, su SQLite e su Postgres, 90 e 180 giorni nel
  contenitore del tenant e in quello di controllo, configurazione e ambiente che vince, un valore
  non positivo che ricade sul default; `test/db/purge.spec.ts`, 1050 tenant visitati tutti, fermata
  corretta su un confine esatto di pagina. `docs/CONFIGURATION_V5.md` e `README.md` aggiornati.

## K. Rimozione e gatekeeper

- [x] **T-12.34** Via le rotte vecchie.
  **Cosa fare**: tolte `POST /auth/login` e `POST /auth/mfa/verify` (`routes.ts:131-146`,
  `:251-268`), `POST /system/auth/login` e `/system/auth/mfa/verify`
  (`lib/api/system/routes.ts:48-59`, `:157-162`), `issuePreAuth` (`credential.ts:285-292`),
  `authMfaChallengeSchema` (`lib/schemas/auth.ts:60`); `unregister` smette di prendere
  `authLoginBodySchema` in prestito (`routes.ts:46`).
  **Criterio di chiusura**: `grep -rn "pre-auth-mfa\|issuePreAuth" lib index.ts` vuoto.
  **Evidenza**: commit `be23feb`; il grep del criterio non trova nulla. Tolti anche
  `authMfaVerifyBodySchema` e i controller `login` e `mfaVerify` dei due piani; `/auth/unregister`
  prende `authUnregisterBodySchema` (`lib/schemas/auth.ts:2`, `lib/api/auth/routes.ts:50`). Le spec
  che aprivano una sessione con le rotte vecchie passano da `/auth/flow/start`
  (`test/lib/fixtures/flowLogin.ts`), il banco multi-tenant compreso (`test/e2e-mt-pg/harness.ts`);
  i casi D-17 di `test/lib/authMessages.spec.ts` girano ora sull'identificatore `password` del
  flusso, compreso l'account bloccato con la password scaduta. `test/lib/mfaEnrolment.spec.ts`
  verifica che nessuna delle quattro rotte resti nei file di rotta.

- [x] **T-12.35** Il gancio di autenticazione.
  **Cosa fare**: cancellata `MFA_SETUP_WHITELIST` e il ramo che la applica (`onRequest.ts:12-23`,
  `:134-145`); ogni JWT con claim `role` rifiutato con `UNAUTHORIZED` prima di ogni altra cosa
  (F36); `MFA_REQUIRED` esce dal sorgente e `check:refusals` lo registra.
  **Criterio di chiusura**: prova che un token `pre-auth-mfa` firmato con il segreto corrente è
  401 su una rotta autenticata, su `/auth/mfa/setup` e su `/auth/sessions`.
  **Evidenza**: commit `be23feb`; `lib/hooks/onRequest.ts:94` rifiuta qualunque `role` prima del
  controllo sul refresh token. `MFA_REQUIRED` è nel nuovo elenco `RETIRED` di
  `scripts/check-refusals.mjs:73`: se torna a essere emesso, il check fallisce
  («93 refusals, each named by at least one test; 1 retired, none emitted»). Prove in
  `test/lib/mfaEnrolment.spec.ts:128`: 401 `UNAUTHORIZED` su `/orders`, `/auth/mfa/setup` e
  `/auth/sessions`, e sulle gemelle di sistema, sia in cookie sia nell'header in bearer; un claim
  `role` qualunque è rifiutato allo stesso modo. `test/lib/authRefusals.spec.ts`: su una rotta
  pubblica lo stesso token vale come nessun token.

- [x] **T-12.36** Le rotte MFA di gestione.
  **Cosa fare**: F45: sessione completa obbligatoria, `enable` senza emissione di sessione
  (`auth.ts:645-664`); il 409 di T-12.1 resta com'è.
  **Criterio di chiusura**: prove sui due piani, accanto a quelle di `test/lib/mfaEnrolment.spec.ts`;
  il manifest non annuncia più `mfaVerify` (`lib/manifest/generator.ts:104-120`) e annuncia le
  rotte del flusso per piano.
  **Evidenza**: commit `be23feb`; `mfaEnable` del piano tenant risponde `{ ok: true }` senza
  emettere sessione (`lib/api/auth/controller/auth.ts:535`), con `defaultResponse` come schema,
  come già faceva il piano di controllo; la sessione completa la garantisce il gancio, perché
  nessun token temporaneo arriva più alle rotte. `enable` di sistema ha ora lo stesso limite di
  10 al minuto del tenant (`lib/api/system/routes.ts:292`). Prove in
  `test/lib/mfaEnrolment.spec.ts:188` e `:239` sui due piani: 401 all'anonimo, 409
  `MFA_ALREADY_ENABLED` con una sessione completa, `{ ok: true }` senza cookie né token. Manifest:
  `flowOptions`, `flowStart`, `flowStep`, `flowChallenge` e `flowCancel` per piano
  (`lib/manifest/generator.ts:101-137`), niente più `login` né `mfaVerify`. Il tipo degli endpoint
  chiede ora `flowOptions`, `flowStart` e `flowStep` al posto di `login`: è la rottura che
  `volcanic-admin` assorbe in T-12.45. `npm test` 896 prove con `DATABASE_URL`, banco
  multi-tenant 17 su 17, copertura 87,3% di righe.

## L. Prove

- [x] **T-12.37** Unità e memoria.
  **Cosa fare**: `test/lib/` per credenziali, validazione, motore con gli autenticatori finti (che
  dimostrano il contratto per sms, social e per un ritorno in POST), rotte in bearer e cookie,
  registro degli accessi, rifiuti nuovi.
  **Criterio di chiusura**: `npm test` verde, `npm run check:refusals` con un test per ogni codice
  nuovo: `FLOW_REQUIRED`, `FLOW_EXPIRED`, `FLOW_METHOD_NOT_ALLOWED`, `FLOW_CODE_INVALID`,
  `FLOW_ATTEMPTS_EXHAUSTED`, `FLOW_SEND_LIMIT`, `FLOW_ENROLMENT_REFUSED`,
  `AUTH_FLOW_NOT_AVAILABLE`, `IDP_UNKNOWN_PROVIDER`, `IDP_RETURN_INVALID`, `IDP_IDENTITY_NOT_LINKED`,
  più quello di T-12.7.
  **Evidenza**: commit `523d9ae`; `npm test` verde, 897 prove con `DATABASE_URL`; `check:refusals`
  «93 refusals, each named by at least one test». Ogni codice dell'elenco ha la sua prova
  (`test/lib/authEngine.spec.ts`, `authFlowRoutes.spec.ts`, `test/db/emailOtp.spec.ts`,
  `externalIdentity.spec.ts`, `tenantProvisioning.spec.ts` per `AUTH_FLOW_NOT_AVAILABLE` di
  T-12.7). I due codici dei provider sono provati in `test/db/oidc.spec.ts`,
  `test/lib/oidcRoutes.spec.ts` e `test/lib/externalIdentities.spec.ts`; il criterio li chiamava
  `IDP_NOT_FOUND` e `IDP_RESPONSE_INVALID`, nomi mai usati altrove, ed è stato allineato a quelli
  del codice, decisi in T-12.25 e T-12.29. Agli autenticatori finti di forma SAML (ritorno in POST) e SMS si
  aggiunge quello di forma social, OAuth 2 senza OpenID Connect: uscita con redirect, ritorno in GET
  sullo `state` costruito dal motore con `roundTrip.begin`, rifiuto del provider che chiude il flusso
  (`test/lib/fixtures/authenticators.ts`, prova in `authEngine.spec.ts`). Le altre voci erano già
  coperte: credenziali (`flowCredential.spec.ts`), validazione (`authFlowConfig.spec.ts`), rotte in
  bearer e cookie (`authFlowRoutes.spec.ts`, `authChannels.spec.ts`), registro
  (`accessLogWrites.spec.ts`).

- [x] **T-12.38** Data layer.
  **Cosa fare**: `test/db/` per i quattro manager sui due dialetti, `test/migrations/` per la 0002.
  **Criterio di chiusura**: `npm run test:db` e `npm run test:migrations` verdi.
  **Evidenza**: con `DATABASE_URL`, `test:db` 283 prove e `test:migrations` 41, una saltata
  ciascuna per ragioni estranee alla fase. I quattro manager su SQLite e su Postgres in
  `test/db/authFlow.spec.ts` (flussi, identità esterne, provider del tenant) e
  `test/db/accessLog.spec.ts`; la 0002 su un contenitore vuoto e su uno fermo alla 0001 in
  `test/migrations/authFlowUpgrade.spec.ts`. Nessuna prova nuova: erano state scritte con i blocchi D,
  H e J.

- [x] **T-12.39** Banco multi-tenant su Postgres reale.
  **Cosa fare**: `test/e2e-mt-pg/authFlow.e2e.spec.ts`: la riga del flusso e quella del registro
  degli accessi stanno nel contenitore del loro tenant e in nessun altro; il credenziale di flusso
  di A presentato come B è `TENANT_MISMATCH`; il ritorno OIDC con `state` di A e sottodominio di B è
  rifiutato; due tenant con due IdP diversi e lo stesso `sub` restano due identità; il flusso e gli
  accessi di piattaforma vivono solo nel piano di controllo.
  **Criterio di chiusura**: `npm run test:e2e:mt:pg` verde con `DATABASE_URL` impostata (senza,
  le suite saltano e il verde non dice nulla).
  **Evidenza**: commit `523d9ae`; `test/e2e-mt-pg/authFlow.e2e.spec.ts`, cinque prove, banco a 22 su
  22. Ogni tenant ha il suo provider scritto da `/tenants/:id/identity-providers` e un issuer in
  processo; l'app del banco elenca `oidc` sul piano tenant
  (`test/e2e-mt-pg/fixtures/app/src/config/authFlows.ts`). Osservato da una connessione `pg` esterna:
  la riga di `auth_flow` nasce nello schema di acme all'avvio del giro OIDC e in nessun altro, così
  il `login.failed`; il credenziale di acme con l'header di globex è 403 `TENANT_MISMATCH` e il
  flusso resta vivo per acme fino alla sessione; lo stesso `sub` presso i due provider dà un
  `external_identity` in ciascuno schema, con il proprio issuer, e nessuno nel piano di controllo;
  login e rifiuto della piattaforma scrivono solo in `public`. Deriva: il ritorno con lo `state` di A
  è provato con l'header di B e non con il sottodominio, perché il banco risolve per header; è lo
  stesso ramo `declared` di `lib/loader/tenant.ts:129`. Il rifiuto arriva prima dello scambio del
  codice, che resta non speso.

- [x] **T-12.40** Un IdP OIDC finto, senza rete.
  **Cosa fare**: un issuer in processo servito attraverso `customFetch` di `openid-client`, con
  chiavi generate a ogni esecuzione e ID token firmati con `jose`, che diventa `devDependency`
  esplicita.
  **Criterio di chiusura**: le prove di I girano con la rete disattivata.
  **Evidenza**: commit `523d9ae`; l'issuer c'era già da T-12.29 (`test/lib/fixtures/fakeIdp.ts`,
  servito da `useOidcFetch`). `scripts/no-network.mjs` rifiuta ogni connessione fuori dalla macchina
  e ogni risoluzione di nome, lasciando aperti loopback e socket Unix per il database;
  `npm run test:oidc:offline` esegue sotto di esso `test/lib/oidcRoutes.spec.ts` e
  `test/db/oidc.spec.ts`, 23 prove verdi con Postgres, ed è un passo del job `test-pg` della CI. Una
  prova usa e getta con `fetch('https://example.com')` sotto lo stesso caricamento è rifiutata con
  «no network in this run». Deriva: niente `jose` come dipendenza di sviluppo, perché gli ID token
  sono firmati RS256 con `crypto` di Node e la verifica la fa `openid-client` come in produzione; una
  dipendenza in più non aggiungerebbe nulla alla prova.

## M. Documentazione

- [x] **T-12.41** `docs/AUTH_FLOW_V5.md` al posto di `docs/AUTH_COMPOSABLE_EVOLUTION.md`.
  **Cosa fare**: in inglese: contratto, forma della configurazione, ciclo di vita del flusso,
  credenziali, provider, collegamenti, registro degli accessi, rifiuti, e una sezione su ciò che è
  rinviato (SAML, collegamento self-service). Il documento v4 si cancella o porta un cartello di
  sostituzione, e `EVO_FRAMEWORK.md:50` si aggiorna.
  **Criterio di chiusura**: nessun documento v5 rimanda al documento v4 come guida.
  **Evidenza**: commit `b7a5eae`. `docs/AUTH_FLOW_V5.md` scritto sul codice (`lib/auth/*`,
  `types/global.d.ts`), dodici sezioni fino ai rinvii (§12); il documento v4 è **cancellato** e non
  cartellato, e `docs/AUTHORIZATION_MODEL.md:5`, `EVO_FRAMEWORK.md:50` e `CLAUDE.md` puntano al nuovo.
  `grep -rn AUTH_COMPOSABLE docs README.md llms.txt CLAUDE.md` trova solo la riga di sostituzione in
  testa al documento nuovo.

- [x] **T-12.42** Specifiche esistenti.
  **Cosa fare**: `docs/API_V5.md` §2 e §5 (rotte nuove, rotte tolte, limiti, codici, registro
  degli accessi), `docs/MANAGERS_V5.md` (cinque port nuovi), `docs/SCHEMA_V5.md` (quattro tabelle
  e la colonna), `docs/AUTHORIZATION_V5.md` (secondo fattore, SSO, capability `access-log`),
  `docs/CONFIGURATION_V5.md` (`authFlows.ts`, `limits`, `accessLog`, variabili),
  `docs/SECURITY_MFA.md` (oggi descrive il token temporaneo e la lista bianca,
  `docs/SECURITY_MFA.md:46-50`), `docs/MIGRATION_V4_V5.md` §28 (cosa rompe: login, verifica MFA,
  forma del 202, `enable` che non emette più sessione, 401 sul login di piattaforma).
  **Criterio di chiusura**: `grep -rn "pre-auth-mfa\|/auth/login\|mfa/verify" docs llms.txt README.md`
  trova solo la guida di migrazione.
  **Evidenza**: commit `b7a5eae`: `docs/API_V5.md` §2, §2.1, §2.2, §2.6 (nuova, il flusso per il
  client), §3, §5, §6, §7; `docs/MANAGERS_V5.md` §13 → §17; `docs/SCHEMA_V5.md` §2.5
  (`auth_methods`), §2.7 → §2.9, §3.5; `docs/AUTHORIZATION_V5.md` §3 (`access-log` di
  `system:auditor`, mancava), §5, §10 (nuova); `docs/CONFIGURATION_V5.md` (blocco `accessLog`,
  quattro variabili `AUTH_*`, `MFA_APP_NAME`, `clientSecretEnv`, `openid-client`);
  `docs/SECURITY_MFA.md` riscritto; `docs/MIGRATION_V4_V5.md` §29. Il grep trova, oltre alla guida,
  due righe **storiche** lasciate apposta: `docs/AUDIT_TASKS_TODO.md:92` (audit del 17 giugno 2026) e
  la voce 3.1.0 del changelog in `README.md`, che descrivono versioni in cui quelle rotte esistevano.
  Derive dal piano: la rottura sta in §29 e non in §28, che F49 aveva già occupato; toccati anche
  `docs/MAGIC_QUERY_V5.md` e `docs/SCHEMA_OVERRIDING.md`, fuori elenco, che nominavano la rotta tolta.

- [x] **T-12.43** `README.md`, `llms.txt`, `CLAUDE.md`.
  **Cosa fare**: la sezione di autenticazione (`llms.txt:1969` descrive ancora il token
  temporaneo), la riga «MFA pendente» di `CLAUDE.md`, aggiornata a fase chiusa e non durante.
  **Criterio di chiusura**: come T-12.42.
  **Evidenza**: commit `b7a5eae`: `README.md` (matrice, changelog 5.0.0-alpha, modalità cookie e
  bearer, variabili, sezione «Login flows and multi-factor authentication»), `llms.txt` §6.2 riscritta,
  §11.1 e le chiavi dei decoratori (mancavano `sessionManager` e i sette della fase 12), `CLAUDE.md`
  (riga «Auth» e mappa dei documenti). Stesso grep di T-12.42. `CLAUDE.md` aggiornato ora e non a fase
  chiusa: la riga descriveva un token che dal blocco K non esiste più.

## N. Consumer

- [x] **T-12.44** `volcanic-backend-sample`.
  **Cosa fare**: l'helper di login dei test passa a `/auth/flow/start` (`test/common/api.ts:9`);
  il bootstrap inietta `mfaManager` da `@volcanicminds/tools/mfa` e un
  `challengeDeliveryManager` su `@volcanicminds/tools/mailer`, con un ripiego a log in sviluppo
  (oggi `startServer(layer)` non inietta alcun MFA, `index.ts:33`, quindi il sample non ha secondo
  fattore); un `src/config/authFlows.ts` d'esempio con `email-otp`.
  **Criterio di chiusura**: la suite del sample verde contro il backend locale.
  **Evidenza**: `volcanic-backend-sample@8c9648b`: `test/common/api.ts` (login su
  `/auth/flow/start`), `src/services/auth.ts` (`mfaManager` su `tools/mfa`, `challengeDeliveryManager`
  su `tools/mailer` con `SMTP_HOST`, casella in memoria e log in sviluppo, nessuna consegna in
  produzione), iniettati in `index.ts` e `test/common/bootstrap.ts`; `src/config/authFlows.ts` con
  `email-otp` come identificatore e l'`admin` solo con password; `test/e2e/login.ts`, sei prove
  (password, rifiuto uniforme, codice via email con tentativo errato contato, indirizzo sconosciuto
  come uno noto, admin rifiutato senza password, stadio TOTP). Suite del sample 13 su 13 contro il
  backend locale e Postgres 14; avvio reale con `.env` provato su `/auth/flow/options` e
  `/auth/flow/start`. Derive: il sample abilita `allow_admin_create_confirmed_users`, perché un codice
  parte solo verso un indirizzo confermato; il porting ha trovato un difetto del framework, corretto
  in `ae73f14`: `StartOptions` non accettava i manager in un oggetto letterale, e un manager
  `undefined` sostituiva il Null Object.

- [x] **T-12.45** `volcanic-admin`.
  **Cosa fare**: il client di autenticazione diventa un client di flusso: `endpoints.ts:13-32`,
  `client.ts:18-36` e `:178-183`, `providers/auth.ts:78-83`, `tokenStore.ts` (il posto del token
  temporaneo diventa quello del credenziale di flusso in bearer); `LoginView.tsx` disegna le
  opzioni per `id` di metodo con le etichette nelle proprie traduzioni, il descrittore di sfida
  dell'email, l'iscrizione TOTP e il redirect con la ripresa al ritorno (`LoginView.tsx:3-4`,
  `:87-90`); `VolcanicAdmin.tsx:742-745`; i mock (`mockAuthClient.ts:61-62`, `mock/manifest.ts:17`,
  `mock/controlManifest.ts:25-31`) e la lettura degli endpoint dal manifest; una vista in sola
  lettura del registro degli accessi sui due piani, come quella delle sessioni
  (`src/ui/views/AccountView.tsx:158`).
  **Criterio di chiusura**: login `password`, `password → totp`, iscrizione forzata ed
  `email-otp` verificati con Playwright contro il backend locale, sui due piani; OIDC verificato
  contro l'issuer finto del blocco L.
  **Evidenza**: `volcanic-admin@80e981c`: `LoginView.tsx` riscritta sul flusso (opzioni, stadi 202,
  iscrizione TOTP con QR, redirect e ripresa, reinvio, annullamento, codici di rifiuto su chiavi
  `login.*`, codice a 8 cifre per `email-otp` identificatore e a 6 come verificatore), client,
  endpoint, `tokenStore` (credenziale `vf1.` in bearer), mock e `controlManifest` rigenerato da
  `/system/manifest`. Playwright contro il backend locale e Postgres usa e getta, in bearer e in
  cookie: tenant password, password errata, `password → totp` (codice errato con tentativi
  residui, annullamento), `email-otp` identificatore con reinvio, iscrizione forzata con
  `mfa_policy MANDATORY` (il pavimento offre `email-otp` come verificatore); piano di controllo con
  iscrizione TOTP forzata e secondo login TOTP; OIDC contro l'issuer finto, registro
  `flow.started → idp.linked → stage.passed → login.succeeded`. In cookie nessun token né flusso
  nello storage, `auth_token` e `control_token` impostati. Il registro degli accessi si legge dalle
  risorse del manifest sui due piani (8 e 20 righe). Console senza errori JS.

## O. Creazione degli account

- [x] **T-12.46** Impostazioni e attesa.
  **Cosa fare**: tabella `setting` (chiave, valore JSON, autore, data) in `appTables` sui due
  dialetti con `SettingManagement` (`get`, `set`) e il suo Null Object; colonne `approved` e
  `approved_at` su `user`; migrazioni `tenant` e `control` generate con drizzle-kit;
  `mayLogIn` al posto dei controlli sparsi.
  **Criterio di chiusura**: le righe esistenti risultano approvate dopo la migrazione; un utente
  in attesa non entra con password, `email-otp`, refresh né collegamento esterno.
  **Evidenza**: tabella in `lib/database/schema/pg.ts` e `sqlite.ts`, esportata dai quattro file di
  `schema/entry/`; migrazioni `0003_account_creation_{control,tenant}` per i due dialetti;
  `lib/database/managers/setting.ts` (`set` è un solo upsert); `approveUserById` in
  `lib/database/managers/user.ts`; `tenantRefusal` e `mayLogIn` in `lib/auth/subjects.ts`, usati da
  `password.ts`, `emailOtp.ts`, `external.ts`, `http.ts` e dal login e dal rinnovo di
  `lib/api/auth/controller/auth.ts`. Prove: `test/migrations/accountCreationUpgrade.spec.ts` (riga
  scritta a 0002, approvata dopo 0003, su SQLite e Postgres), `test/db/accountCreation.spec.ts`
  (impostazioni per contenitore, approvazione una volta sola, password ed `email-otp` rifiutati,
  collegamento in attesa rifiutato). Il rinnovo passa da `mayLogIn` e non ha una prova sua.

- [x] **T-12.47** La regola a due livelli.
  **Cosa fare**: F49, lettura e validazione dell'insieme (deployment, controllo, tenant) e della
  scelta; `GET` e `PUT /system/account-creation`, `config.account_creation` su creazione e modifica
  del tenant, `GET` e `PUT /settings/account-creation` per l'`admin` del tenant.
  **Criterio di chiusura**: prove per la scelta fuori insieme rifiutata, l'insieme ristretto dopo
  la scelta che ricade sulla più chiusa, l'override del tenant che sostituisce il globale, un
  valore non valido rifiutato alla scrittura e all'avvio.
  **Evidenza**: `lib/auth/accountCreation.ts` (validazione, livelli, modalità effettiva);
  `accountCreation` in `lib/config/general.ts` con `ACCOUNT_CREATION_ALLOWED` e `_DEFAULT`,
  `assertAccountCreation` all'avvio in `index.ts`; rotte `/system/account-creation` (GET, PUT,
  DELETE) in `lib/api/system/routes.ts`, `config.account_creation` validato in
  `lib/api/tenants/controller/tenants.ts`, `/settings/account-creation` in `lib/api/settings/`.
  Prove in `test/lib/accountCreation.spec.ts` e, via HTTP su Postgres con due tenant,
  `test/e2e-mt-pg/accountCreation.e2e.spec.ts`. Derive dal piano: il livello globale ha anche
  `DELETE`, per tornare alla regola del deployment; un valore salvato che non è più una regola si
  legge come assente e si scrive nel log, invece di chiudere tutti i tenant.

- [x] **T-12.48** Le due porte.
  **Cosa fare**: `register` e il JIT di `resolveExternal` secondo la modalità effettiva; eventi
  `account.pending` e `account.approved`; `POST /users/:id/approve`; `accountCreation` in
  `GET /auth/flow/options`.
  **Criterio di chiusura**: prove per `invite` (403 su register, JIT solo con `emailDomains`),
  `approval` (account in attesa che non entra finché non è approvato, poi entra), `open`.
  **Evidenza**: `register` in `lib/api/auth/controller/auth.ts` (la modalità decide prima di leggere
  la richiesta; sotto `approval` anche l'indirizzo già preso scrive una riga, così i due percorsi
  toccano il database lo stesso numero di volte); passo 3 di `resolveExternal` in
  `lib/auth/external.ts`, con la modalità letta da `AuthContext.accountCreation` (assente vale
  `invite`); `POST /users/:id/approve`; `accountCreation` in `GET /auth/flow/options`. Prove nei tre
  file sopra. Da segnalare, fuori da F49: nessuna rotta scrive `confirmation_token`, quindi un
  account nato da `register` non può confermare l'indirizzo da sé, e `/auth/confirm-email` non ha
  mai un codice da ricevere; sotto `open` e `approval` resta non confermato finché un amministratore
  non interviene. Il banco lo conferma a mano con SQL. Risolto dopo la chiusura: `createUser` in
  `lib/database/managers/user.ts` scrive il token per ogni account non confermato e `register` lo
  passa al middleware `global.postAuth` (`req.confirmationToken`), prova in `test/db/managers.spec.ts`.

- [x] **T-12.49** Documentazione.
  **Cosa fare**: `docs/API_V5.md`, `docs/CONFIGURATION_V5.md`, `docs/MANAGERS_V5.md`,
  `docs/MIGRATION_V4_V5.md` (la registrazione è chiusa di fabbrica), `llms.txt`.
  **Evidenza**: `docs/API_V5.md` §2.5 e le righe di §2, §2.1, §3, §5, §6.1;
  `docs/CONFIGURATION_V5.md` (blocco `accountCreation` e le due variabili); `docs/MANAGERS_V5.md`
  §12 e `approveUserById`; `docs/MIGRATION_V4_V5.md` §28; `docs/SCHEMA_V5.md` (`approved`,
  `approved_at`, §2.6 `setting`); `llms.txt` §11.1.

---

## 3. Rinviato a una fase successiva

**SAML.** Il contratto di questa fase lo ospita già: il risultato `redirect` con
`binding: 'post'` e l'azione `{ type: 'post', url, fields }` (F47), il gancio `complete` (T-12.2),
lo `state` dimensionato sugli 80 byte di `RelayState` (F39), la rotta di ritorno generica e il flag
`tenantFrom` che legge il parametro dal nome dichiarato dal metodo (T-12.17), la colonna `type` di
`identity_provider` (T-12.10), la regola di `dependency-cruiser` (F42). Quello che SAML porterà con
sé, e che oggi non serve a nessuno:

- **la libreria, scelta ancora aperta.** `@node-saml/node-saml` 5.1.0, del 21 luglio 2025: il
  motore dietro `passport-saml`, CommonJS importabile da ESM, firma di risposta e di asserzione
  obbligatorie, `validateInResponseTo: 'always'` con un `CacheProvider` a tre metodi
  (`saveAsync`, `getAsync`, `removeAsync`) che si implementerebbe sopra la riga del flusso; dipende
  da `xml-crypto` `^6.1.2`, cioè da una versione successiva agli avvisi di marzo 2025 sul wrapping
  delle firme; il rischio è il ritmo, un rilascio in quattordici mesi. `samlify` 2.13.1, del 18
  maggio 2026: rilasci più frequenti (cinque fra novembre 2025 e maggio 2026), ma lascia al
  consumer la scelta del validatore di schema XML e dipende da `node-rsa`. Scartati fin d'ora
  `saml2-js` (fermo) e `passport-saml` (un involucro di `node-saml` per Express). Qualunque delle
  due, come peer facoltativa caricata pigramente e con rifiuto all'avvio, come `openid-client`;
- **il corpo `application/x-www-form-urlencoded`.** Il POST binding lo usa, e oggi nessuno lo
  interpreta: `index.ts:385` registra solo il parser del trasferimento. Un parser limitato alla sola
  rotta di ritorno, senza dipendenze nuove;
- **i metadati del service provider.** Da consegnare all'IdP del cliente, prodotti da una rotta di
  controllo per i provider dei tenant, perché con il resolver `header` una rotta pubblica non
  saprebbe di quale tenant parlare;
- **il collegamento per email senza claim di verifica.** SAML non ha `email_verified`: servirà un
  `trustEmail: true` esplicito per provider, sempre insieme a `emailDomains`;
- **il secondo fattore dell'IdP.** `RequestedAuthnContext` nella richiesta e
  `AuthnContextClassRef` letto dall'asserzione validata, con la stessa regola di F41;
- **le risposte non sollecitate** (IdP-initiated, senza `InResponseTo`) rifiutate, perché sono la
  forma SAML del login CSRF che F39 chiude per OIDC;
- **le prove**: un IdP finto che firma con `xml-crypto` e una coppia di chiave e certificato di sola
  prova in `test/fixtures/`, con i casi di firma assente, wrapping, audience sbagliata,
  `InResponseTo` estraneo, risposta rigiocata.

**Il collegamento avviato dall'utente** (F48, chiusa con (b)): insieme a uno step-up che
chieda una riautenticazione fresca.

---

## Evidenze

| Voce | Evidenza |
|---|---|
| T-12.1 | commit `1b50994`: `lib/api/auth/controller/auth.ts:576-584`, `lib/api/system/controller/systemAuth.ts:229`, `:249`, quattro prove in `test/lib/mfaEnrolment.spec.ts`, `docs/API_V5.md:47-48`, `:186` |
| T-12.2 → T-12.4 | commit `d8b6890`: `types/global.d.ts:770-1431`, `lib/auth/registry.ts`, `lib/auth/builtins.ts`, `lib/defaults/managers.ts:134-148`, `test/lib/authRegistry.spec.ts`, `test/lib/authBoot.spec.ts`, `test/lib/defaultManagers.spec.ts` |
| T-12.5 → T-12.7 | commit `0e2f98b`: `lib/config/authFlows.ts`, `lib/loader/authFlows.ts`, `lib/auth/validate.ts`, `index.ts:366-385`, `lib/api/tenants/controller/tenants.ts:172-181`, `test/lib/authFlowConfig.spec.ts`, `test/lib/tenantProvisioning.spec.ts:122`; `npm test` 616 prove, 30 saltate senza `DATABASE_URL` |
| T-12.8 → T-12.12 | commit `9dc13c6`: `lib/database/schema/pg.ts:199-306`, `:399`, `lib/database/schema/sqlite.ts:147-246`, `:334`, migrazioni `0002_auth_flow_control` e `0002_auth_flow_tenant` nei quattro insiemi, `lib/database/managers/{authFlow,externalIdentity,identityProvider,accessLog}.ts`, `lib/database/managers/index.ts:55-59`, `test/db/authFlow.spec.ts`, `test/db/accessLog.spec.ts`, `test/migrations/authFlowUpgrade.spec.ts`; `npm test` 649 prove e 31 saltate senza `DATABASE_URL`, 706 e 2 saltate su un Postgres 14 usa e getta; banco multi-tenant 14 verdi |
| T-12.13 → T-12.21 | commit `90609d7`: `lib/util/flowCredential.ts`, `lib/auth/engine.ts`, `lib/auth/http.ts`, `lib/auth/authenticators/{password,totp}.ts`, `lib/auth/subjects.ts`, `lib/util/accessLog.ts`, `lib/api/auth/routes.ts`, `lib/api/system/routes.ts`, i due controller sottili, `lib/schemas/auth.ts`, `lib/loader/tenant.ts`, `lib/loader/router.ts`, `lib/database/managers/authFlow.ts` (`recordAttempt`), `bin/volcanic.mjs`; `test/lib/{flowCredential,authEngine,authFlowRoutes}.spec.ts` più le aggiunte a `tenantResolution`, `router`, `authFlowConfig`, `tenantProvisioning` e `test/db/authFlow.spec.ts`; `npm test` 696 prove e 31 saltate senza `DATABASE_URL`, 754 e 2 saltate su un Postgres 14 usa e getta; banco multi-tenant 14 verdi; copertura 86,4% di righe |
| T-12.31 → T-12.33 | commit `01e84e9`: `lib/util/accessLog.ts`, `lib/database/managers/accessLog.ts`, `lib/database/purge.ts`, `lib/api/access-log/`, `lib/api/system/controller/systemAccessLog.ts`, `lib/schemas/accessLog.ts`, `test/lib/accessLogWrites.spec.ts`, `test/db/accessLog.spec.ts`, `test/db/purge.spec.ts`; `npm test` 721 prove (783 con `DATABASE_URL`), banco multi-tenant 14, copertura 86,6% di righe |
| T-12.22 → T-12.24 | commit `5221dce`: `lib/auth/authenticators/emailOtp.ts`, `lib/auth/engine.ts`, `types/global.d.ts` (`FlowChallenges`), `test/db/emailOtp.spec.ts` |
| T-12.25 → T-12.27 | commit `4f66889`: `lib/auth/providers.ts`, `lib/auth/external.ts`, `lib/api/tenants/controller/identityProviders.ts`, `lib/api/auth/controller/identities.ts`, `lib/api/users/controller/identities.ts`, `test/lib/identityProviders.spec.ts`, `test/lib/externalIdentities.spec.ts`, `test/db/externalIdentity.spec.ts`; `npm test` 754 prove (832 con `DATABASE_URL`), banco multi-tenant 14, copertura 86,5% di righe |
| T-12.34 → T-12.36 | commit `be23feb`: `lib/hooks/onRequest.ts:94`, `lib/api/auth/controller/auth.ts:535`, `lib/manifest/generator.ts:101-137`, `scripts/check-refusals.mjs:73`, `test/lib/mfaEnrolment.spec.ts`, `test/lib/fixtures/flowLogin.ts`; `npm test` 896 prove con `DATABASE_URL`, banco multi-tenant 17 |
| T-12.37 → T-12.40 | commit `523d9ae`: `test/e2e-mt-pg/authFlow.e2e.spec.ts`, `test/e2e-mt-pg/fixtures/app/src/config/authFlows.ts`, `test/lib/fixtures/authenticators.ts`, `test/lib/authEngine.spec.ts`, `scripts/no-network.mjs`, `package.json` (`test:oidc:offline`), `.github/workflows/ci.yml`; `npm test` 897 prove con `DATABASE_URL`, banco multi-tenant 22, copertura 87,9% di righe |
| T-12.41 → T-12.43 | commit `b7a5eae`: `docs/AUTH_FLOW_V5.md` nuovo, `docs/AUTH_COMPOSABLE_EVOLUTION.md` rimosso, `docs/{API,MANAGERS,SCHEMA,AUTHORIZATION,CONFIGURATION}_V5.md`, `docs/SECURITY_MFA.md`, `docs/MIGRATION_V4_V5.md` §29, `README.md`, `llms.txt`, `CLAUDE.md`; `npm run check-all` verde |
| T-12.44 | `volcanic-backend-sample@8c9648b`, framework `ae73f14` (`StartOptions`); correzioni a margine `2975bfe` (ritorno dall'IdP fallito risposto dal passo successivo, reset MFA d'emergenza sull'identità di piattaforma); sample 13 su 13, backend 902 prove con `DATABASE_URL`, banco multi-tenant 22 |
