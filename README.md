# Lossless Hi-Res — estensione per Myspoti

Porta in **Myspoti** lo streaming e i download **FLAC** di **Qobuz** (16/44.1 e 24-bit) e di
**Tidal** (via l'addon Aurix), e in ultima istanza il **FLAC di Internet Archive**. Tutto
interrogato direttamente, senza dipendere da un solo servizio.

Stesso `id` di sempre (`app.eljohnzc.lossless`): in Myspoti si installa sopra la versione precedente e
tiene le impostazioni.

```
brano Spotify ──▶ abbinamento (titolo, artista, album, durata, ISRC)
                    │
   ┌────────────────┼──────────────────────────┐
   ▼                ▼                          ▼
 Qobuz ufficiale   Tidal (token)  addon       Internet Archive
 token/login/pool  /v1/search     Bitchord→ Qobuz (FLAC)   advancedsearch + metadata
   │               ISRC, 0,2-0,5 s Eljohnzc→ Tidal (DASH)   title:(…) AND format:(FLAC)
 /track/search                    Aurix   → Tidal (DASH)   /download/<item>/<file>.flac
 /track/getFileUrl
 /track/getFileUrl /search, /stream/<id>       (controllo nome + peso)
 (firma MD5)       (file intero o manifest)
   └────────────────┴──────────────────────────┘
                    ▼
   Myspoti: audio-source (riproduzione) · download-source (file .flac)
```

## Cosa è cambiato nella 4.13.0

**Il 24-bit è tornato.** Degli account arrivati il 6 novembre, uno su tre Qobuz funziona davvero, e
basta: `getFileUrl` restituisce il **file intero** (24/88,2 — 133.376.529 byte — e fino a 24/192), non i
30 secondi. È dentro l'estensione come account del pool.

- **I brani mainstream tornano da Qobuz in 0,45-0,95 s**, in 24-bit (Get Lucky 24/88, Bohemian 24/96,
  Take On Me 24/192, Blu celeste 24/96…). Il 16/44 dell'addon Deezer resta per i brani che Qobuz non ha.
- **La ricerca negli addon parte solo se serve.** Prima si cercava sempre anche negli addon, e quella
  ricerca costava 1-5 s a ogni brano anche quando gli id Qobuz bastavano: era lei a mangiare il tempo
  (i 9-10 s del registro, con il brano perso per un soffio). Ora, se il catalogo ha già un id che una
  fonte viva sa suonare, si va dritti al file; la ricerca negli addon resta come seconda passata,
  quando il primo giro non ha prodotto niente.
- **Più token Tidal nello stesso campo**, separati da virgola. Tidal sospende parecchi account
  (`abuse_detected`): quelli vengono saltati da soli e si usa il successivo, senza toccare niente.
- Il tetto per brano resta 8 s: con un account buono non serve più arrivarci.

Misurato sui dodici brani di prova: **11 su 12**, mainstream in **0,45-0,95 s**, i due classici dal
ripiego (Deezer 16/44) in 3,4-3,8 s.

### Sugli account arrivati il 6 novembre

| Account | Esito |
|---|---|
| Qobuz NZ `15710135` | **funziona**: file intero 24/88,2 (il credential dice uid 4801845) |
| Qobuz NZ `15695365` | `user/get` → 401 |
| Qobuz GB `15226142` | `user/get` → 401 |
| Tidal FR `209673809` | **funziona**: rinnova, Premium fino al 2027-01-04, ricerca con ISRC |
| Tidal GB `209674012` | sospeso (`abuse_detected`) |
| Tidal CA `209674302` | sospeso |
| Tidal NL `209674730` | sospeso |
| Tidal NZ `209673940` | sospeso |

Il vecchio token Tidal (HR) rinnova ancora: nella casella dei token Tidal ce ne sono due, e si passa
al secondo da solo se il primo smette.

## Cosa è cambiato nella 4.12.0

Le fonti su cui l'estensione si appoggiava si sono spente tutte, nello stesso giorno:

| Fonte | Stato il 6 novembre |
|---|---|
| Addon Qobuz (Bitchord) | `404 not available in this addon` su **ogni** id |
| Aurix (Tidal) | `302` verso una pagina Google: la chiave pubblica è scaduta |
| Eljohnzc (Tidal) | `503` su ogni percorso |
| **Deezer (rickyaddons)** | **vivo**: ricerca ~0,6 s, FLAC 16/44 vero |
| Archivio Internet | vivo, per i brani che ha |

Quindi il problema del telefono non erano i permessi (quelli sono a posto dalla 4.11.1) né il telefono:
erano gli addon. Quello che ho cambiato:

- **Si cerca anche negli addon, sempre.** Prima la ricerca degli addon partiva solo se il catalogo
  Qobuz non aveva dato niente. Ma «avere un id» non vuol dire «poterlo suonare»: un id Qobuz con
  l'addon Qobuz spento è solo un numero, e il brano restava senza voce. Ora si cercano entrambi e si
  sceglie l'id che una fonte **viva** sa servire.
- **Un tentativo per catalogo, a brano.** Se l'addon Qobuz non risponde, gli altri dieci id Qobuz
  darebbero la stessa risposta: si passa avanti.
- **Tetto a 8 s** (era 14) e ricerche più corte: sul telefono i secondi sono contati, e la misura del
  registro («took longer than 5000 ms») diceva che l'app ne spendeva nove prima di arrendersi.
- **Due colpi e la fonte va in fondo** per mezzo minuto (prima serviva un rifiuto *immediato*, quindi
  un addon che si impuntava 4 s veniva richiamato a ogni brano).
- **Registro più utile**: `tempi: ricerca 620 ms, 7380 ms rimasti`, e per ogni fonte che tace
  `relay qz …: bitchord non ha risposto in 3002 ms`.

Misurato sui dodici brani di prova, con gli addon di oggi: **11 su 12**, da **0,7 a 3,2 s** (tutti da
Deezer 16/44). `Homemade` degli Eugenio in Via Di Gioia non è in nessun catalogo raggiungibile.

### Sul servizio `losslessbridge`

Il link indicato non è un addon pronto: la radice e `/manifest.json` rispondono
`{"error":"not found","enroll":"…"}`, cioè serve un'iscrizione che genera un link personale. Il suo
`/health` dice anche com'è messo: `qobuz` e `hifi` **disattivati**, `monochrome`/`gdstudio`/`archive`
degradati, l'unica fonte accesa è **Netease**. Non l'ho aggiunto: non c'è niente da aggiungere finché
non c'è il link personale, e anche con quello non darebbe Qobuz né Tidal.

## Cosa è cambiato nella 4.11.1

- **Bitchord non era fra gli host dichiarati.** L'azione `network` del manifest elencava Aurix, Eljohnzc,
  Qobuz, Tidal e l'Archivio, ma non l'addon Qobuz: sul telefono l'app rifiutava ogni sua richiesta con
  «`bitchord-hires-addon.de.deplexo.com` is not in this extension's network hosts» e il brano restava
  senza fonte. Dal computer funzionava, perché lì nessuno controlla i permessi: è il tipo di guasto che
  i test in sandbox non vedono.
- **Ora sono dichiarati** l'addon Qobuz, quello Deezer e gli host dei file che passiamo al player
  (`*.akamaized.net`, `*.dzcdn.net`). Al primo avvio dopo l'aggiornamento l'app chiede di confermare i
  nuovi host: va accettato, altrimenti restano bloccati.
- **Il test che doveva accorgersene guardava la lista sbagliata:** confrontava gli indirizzi con
  `media.hosts` (quella per i file) invece che con gli host dell'azione `network` (quella per le
  richieste). Adesso controlla quella giusta, e controlla anche che i file che diamo al player stiano
  fra i media host.

## Cosa è cambiato nella 4.11.0

- **Un addon Deezer fra le fonti** (forma «stream»): quando Qobuz e gli addon Tidal non hanno il brano,
  si prova anche lui. Serve **FLAC 16/44 vero** — verificato: file da **43 MB** per un brano da 6 minuti,
  `206 Partial Content`, `audio/flac`; ricerca in ~1 s, file in ~0,6 s.
- **Gli id si tengono separati per catalogo.** Un id Deezer è un numero secco (`67238735`), che prima
  sarebbe stato dato anche agli addon Qobuz/Tidal (e viceversa): era una richiesta buttata via a ogni
  brano. Ora ogni addon riceve solo gli id del suo catalogo.
- L'addon Deezer sta **in fondo alla lista** e ha un tetto di 4 s: si fa vivo solo quando serve, non
  allunga i brani che già arrivano da Qobuz. Nei dodici brani di prova ha recuperato un classico che
  prima restava scoperto.
- Ricorda che questo addon dà il **16/44** (il meglio di Deezer): non è hi-res, è una rete di sicurezza
  in più.
- **Aurix passa prima di Eljohnzc.** Eljohnzc, che risponde `503` a ogni percorso da giorni, costava
  due-tre secondi a ogni brano che solo Aurix sa servire: i classici arrivavano a filo del tempo (e a
  volte non arrivavano). Un `5xx` adesso chiude subito il giro dei tentativi invece di ripetere le
  altre forme di ricerca.
- **L'addon Qobuz ha un tetto di 4 s** (erano 2,5) e finisce "in castigo" solo se rifiuta *subito*: un
  timeout lungo è lentezza, non guasto, e prima bastavano due lentezze di fila per perdere per mezzo
  minuto l'unica fonte che serve il file intero.

Dodici brani di prova, dopo queste correzioni: **11 su 12**, i mainstream in **0,5-1,4 s**, i due
classici dal DASH Tidal in 4-4,5 s.

## Cosa è cambiato nella 4.10.0

- **Addon nella forma di BitChord/Stremio.** Un link che finisce con `/manifest.json` viene riconosciuto
  da solo: ricerca su `/search?q=`, file su `/stream/<id>`. Si incolla in **Servizi di ricambio**
  (`relayApi`) e funziona senza altre impostazioni; in alternativa si può scrivere `stream:<indirizzo>`.
- **`predefiniti` nella stessa casella.** Di suo, un indirizzo scritto a mano *sostituisce* gli addon di
  serie. Scrivendo `predefiniti, <link>` si tengono tutti: Bitchord resta la prima scelta e il nuovo
  addon fa da riserva. (Nel dubbio, è la forma consigliata.)
- **Gli id Qobuz dell'addon passano da Bitchord.** La ricerca di questi addon restituisce id tipo
  `q_9140031`: quel file Bitchord lo dà in un secondo, l'addon in tre. La ricerca resta dell'addon (a
  volte è l'unica che trova il brano), il file lo chiede la fonte più veloce.
- **Gli id Tidal (`t_…`) tornano come manifest DASH** e vengono riprodotti come quelli degli altri
  addon Tidal: si legge il manifest, si passa il base64 al player. L'addon decide da sé se servire il
  brano da Qobuz (URL diretto) o da Tidal (DASH): vanno bene entrambi.
- Un addon lento non è un addon rotto: qualche secondo in più per il manifest è concesso, ma solo se
  resta tempo per il resto del brano.

Misurato con un addon vero di questo tipo, in catena con Bitchord: *Get Lucky* 16/44 in **1,4 s**,
*Blu celeste* 24/96 in **0,7 s**, *Shape of You* 24/44 in **2,3 s**.

## Cosa è cambiato nella 4.9.2

- **Il catalogo Qobuz si consulta anche senza un account buono.** `track/search` risponde anche a chi
  non manda nessun token: l'abbonamento serve al *file*, non alla ricerca. Quando il pool è vuoto o
  tutti i token vengono rifiutati (`401`), la ricerca si fa lo stesso — pochi millisecondi — e l'id
  trovato lo suona l'addon. Prima, con il pool a secco, si restava appesi alla ricerca dell'addon
  (3-5 s per brano) o non si trovava niente.
- La ricerca dell'addon ora parte **solo** se il catalogo non ha dato nessun abbinamento: una
  richiesta in meno per ogni brano mainstream.
- Verificato con **zero token Qobuz validi** in pool: **11 brani su 12**, la maggior parte in
  **0,6-1,1 s**.

## Cosa è cambiato nella 4.9.1

Il problema non era il token Qobuz appena messo: erano le fonti attorno a lui che si erano spente, e
un paio di scelte dell'estensione che, in quella situazione, la facevano sembrare rotta. In una
sandbox pulita (nessuna cache, nessun token Tidal) il risultato era **3 brani su 12**, con l'audio
che arrivava solo dall'Archivio; adesso sono **11 su 12**, quasi tutti da Qobuz in **0,5-2,6 s**.

- **Un id Qobuz non si butta più via per un'anteprima.** Quando l'account del pool risponde con i 30
  secondi, l'estensione segnava quell'id come «fonte senza audio»: il brano corrente lo salvava
  Bitchord, ma dal brano dopo ogni id Qobuz veniva scartato — cioè spariva l'unico addon che ha il
  catalogo Qobuz, e restavano quelli Tidal (uno oggi risponde 503). Ora la risposta «anteprima»
  significa soltanto «questa API non mi dà il file», e il file lo chiede l'addon.
- **La ricerca Qobuz si fa anche senza abbonamento.** L'abbonamento conta al momento del *file*, non
  del catalogo: cercare con un token che serve solo assaggi è comunque la via più corta per trovare
  l'id che Bitchord sa suonare. Prima, se nessun account aveva l'abbonamento, la ricerca Qobuz
  veniva saltata del tutto.
- **La sonda di stato non mette più l'addon «in castigo».** La prova delle fonti dura quattro secondi:
  se l'addon Qobuz non faceva in tempo, la risposta «niente tempo» veniva letta come guasto e
  Bitchord restava spento **per un minuto** — subito dopo l'installazione, cioè proprio quando si
  prova l'estensione. Ora «niente tempo» non è un guasto, e un timeout isolato non basta: serve un
  secondo colpo di fila, e il castigo è di mezzo minuto.
- **Eljohnzc costa una richiesta ogni tre minuti.** Oggi risponde `503` a ogni percorso: prima veniva
  richiamato quattro volte per brano, ora tre minuti di pausa dopo il primo `503` e si passa avanti.
- **Anteprima = un altro account, non un altro formato.** Con un token che dà solo assaggi si prova
  il token successivo del pool (uno può essere scaduto, un altro no) invece di bruciare 2-4 secondi
  sulle varianti `app_id` dello stesso token. Se nessun account del pool ha l'abbonamento, il brano va
  all'addon senza altre richieste.

Restano veri i limiti di ieri: *Homemade* degli Eugenio in Via Di Gioia non è nel catalogo Qobuz che
questi token vedono (la ricerca restituisce altri brani dello stesso album) e l'Archivio non ce l'ha;
i due brani classici arrivano dal DASH Tidal, più lento (3-9 s).

## Cosa è cambiato nella 4.9.0

- **Il tuo token Qobuz è dentro e funziona davvero.** L'account è **Studio (US)** e `getFileUrl`
  restituisce il **file intero**, non i 30 secondi: verificato a mano con `Range` + `STREAMINFO`,
  *Get Lucky* 24-bit / 88,2 kHz, **133.376.529 byte**, 369,6 s.
  Risultato sui dieci brani di prova: il mainstream ora arriva **dritto da Qobuz in 0,47-0,98 s**
  (prima passava da Bitchord in 0,6-1,5 s), il download è lo stesso file da 127 MB.
- **La firma dipende dall'app.** I token «nuova versione» vanno firmati con `312369995` e la sua
  secret: con la coppia del player web Qobuz risponde `Invalid Request Signature`, e il token sembra
  morto quando invece è buono. Adesso ogni token personale si prova con **tre coppie** (player,
  `312369995`, `712109809`) e si ricorda quella che ha funzionato, così i brani dopo non pagano
  tentativi in più.
- **Un `401` non uccide più il token.** Prima il primo rifiuto lo segnava «morto» per sei ore, anche
  se era solo la coppia app sbagliata. Ora si prova l'altra coppia e lo si dichiara morto solo se
  nessuna lo accetta.
- **Il pool non perdeva le varianti:** la deduplica era per token, quindi le tre coppie si
  sovrascrivevano e restava solo la prima (quella sbagliata). La chiave ora è token + app + secret.
- **Un tetto per chiamata, non per tentativo.** Con tre coppie in pool, un Qobuz lento costava tre
  timeout da 6 s e l'Archivio restava senza tempo (era ricomparso un `null` su *Clair de lune*):
  ora 6 s in tutto, e un timeout non si riprova con altre coppie.
- **`Prova le fonti` dice il piano dell'account**: `Qobuz: studio fino al 2026-10-31 (disdetto) ·
  Qobuz file: ok · Tidal: ok · HI_RES fino al 2027-01-03 · Archivio: file ok · …` (6,6 s).

## Cosa è cambiato nella 4.8.0

- **Il tuo token Tidal è dentro.** L'account è **Premium attivo** (fino al 3 gennaio 2027, hi-res
  sì): il token si scambia da solo con un access token e serve alla **ricerca Tidal di prima mano** —
  `api.tidal.com/v1/search`, **0,2-0,5 s** contro i 3-5 s degli addon, e i risultati arrivano con
  l'**ISRC**, che è ciò che fa azzeccare il brano giusto. Sulla prova di dieci brani: **0 su 10
  senza fonte** (prima 1-2), e i tempi mainstream quasi dimezzati.
- **La riproduzione resta agli addon**, e non per pigrizia: chiedendo il *file* con questo token Tidal
  risponde `401 · Asset is not ready for playback` (subStatus 4005) — succede ai token rinnovati da
  un'app diversa da quella che li ha emessi, anche con l'abbonamento attivo. Gli id però sono gli
  stessi (catalogo Tidal), quindi ricerca di prima mano + file dall'addon funziona benissimo.
  Se l'abbonamento scade o il token viene revocato, la ricerca torna agli addon da sola.
- **Via le fonti morte.** `arcod.xyz` e `instable.arcod.xyz` sono uscite: la prima rispondeva `400`
  dopo 11 s, la seconda non rispondeva affatto. Erano un timeout a ogni brano. Se un giorno tornano,
  si rimettono in *Indirizzo del relay*.
- **Via le anteprime da 30 secondi come fonte.** I token del pool pubblico (`sample: true`) non
  vengono più interrogati per il file: né per l'audio, né per "provare e vedere". Restano solo per la
  *ricerca* Qobuz, che è l'unica cosa che sanno fare — ed è quella che dà gli id a Bitchord. Se hai un
  token tuo o email/password, quello passa davanti e serve il file intero.
- **`Prova le fonti` è più corta**: 11 s invece di 21, e mostra anche `Tidal (token): ok · HI_RES fino
  al …`.

## Cosa è cambiato nella 4.7.1

- **`audio-source: not-found` era troppo frequente.** Su dodici brani ne restavano senza fonte
  cinque; ora uno — e quello è un brano che il catalogo davvero non ha. Tre le cause, tutte corrette:
  1. **La durata dichiarata faceva perdere l'edizione giusta.** Per *Blu celeste* titolo, artista e
     album erano identici, ma Tidal dichiarava 206 s contro i 190 s di Spotify: 16 s di scarto, oltre
     la tolleranza di 6 s, e il brano finiva «non trovato». Ora, quando titolo e artista sono quelli,
     la differenza dichiarata non conta (fino al 18% o 45 s, quello che viene prima). Restano fuori
     le versioni che si annunciano nel titolo (`remix`, `live`, `acoustic`, `extended`, …) e i mix
     sproporzionati: un *Get Lucky* da 632 s viene ancora scartato.
  2. **Un refuso nel catalogo bastava per perdere il brano** («Ragamuffin» per «Raggamuffin»). Il
     titolo si confronta anche lettera per lettera.
  3. **L'addon Qobuz poteva mangiarsi il tempo della ricerca Tidal**: due tentativi da 2,5 s e poi il
     ripiego non partiva più (servivano 8,5 s liberi su 14). Adesso ogni tappa riceve un tetto
     proporzionato al tempo che resta e il ripiego ha sempre il suo spazio.
- **`bitchord-hires-addon.de.deplexo.com` non era dichiarato fra gli host del manifest**: Myspoti
  può rifiutare le richieste a un host non dichiarato, e su un telefono vero l'addon sarebbe stato
  irraggiungibile anche se dal computer funzionava. Aggiunto in `media.hosts`.

## Cosa è cambiato nella 4.7.0

- **Fonte Qobuz nuova: l'addon Bitchord** (`bitchord-hires-addon.de.deplexo.com`). Dietro c'è un
  account Qobuz con abbonamento, e risponde `/stream/<id Qobuz>` con l'**URL di un FLAC intero**
  (`fmt=7`, anche 24/192): verificato a mano, il file è `fLaC` con la sua durata vera (228 s,
  165 MB per *Take On Me*), non i 30 secondi che danno i nostri token.
  Nella prova dal vivo: **Get Lucky 24/88.2**, **Bohemian Rhapsody 24/96**,
  **Take On Me 24/192**, tutti in **0,5–1,3 s** — prima arrivavano da Tidal in 16-bit.
- **Non si usa la sua ricerca.** Ci mette 11 s. Gli id Qobuz li conosce già la nostra ricerca
  (`/track/search` con i token del pool, che funziona anche quando servono solo anteprime): all'addon
  si chiede solo il file di un id che abbiamo in mano. Zero richieste sprecate.
- **Se l'addon tace si perde poco**: 2,5 s di tetto e un secondo tentativo immediato (ogni tanto si
  impunta su una richiesta e risponde a quella dopo in 0,3 s); dopo, il brano passa agli addon Tidal.
  Un minuto di castigo se non risponde, non tre: quando c'è, è la fonte migliore.
- **Le proprietà delle fonti non si perdono più.** `relaySources()` copiava solo `key`/`base`/`shape`:
  tetto di tempo, nomi della qualità, `plain` e `catalog` sparivano prima di arrivare a chi li usa —
  è il motivo per cui gli addon si comportavano in modo incoerente fra un brano e l'altro.
- **Il formato dichiarato dall'addon vince sul catalogo**: la qualità mostrata è quella del file
  (`24-bit / 192 kHz`), non una stima dal titolo.

## Cosa è cambiato nella 4.6.1

- **Il nome**: da **Qobuz Hi-Res** a **Lossless Hi-Res**. L'estensione serve Qobuz, Tidal (addon
  Aurix ed Eljohnzc) e Internet Archive, quindi il vecchio nome raccontava solo una parte. L'`id`
  resta `app.eljohnzc.lossless`: Myspoti la vede come **aggiornamento** e le impostazioni restano.
  Nel player la sorgente mostrata diventa `Lossless Hi-Res`.
- **Il tetto di tempo degli addon vale anche per il file**, non solo per la ricerca: prima un relay
  che DASH non lo parla affatto poteva costare un timeout intero da 8 s su un id `tidal:…`, e il
  brano restava senza audio. Adesso si sonda in 2,5 s e si passa avanti.

## Cosa è cambiato nella 4.6.0

- **Seconda fonte Tidal: l'addon Eljohnzc** (`eljohnzc-addon.de.deplexo.com/59efe06a96`, versione
  5.5.5 del manifest). È il progenitore di questa estensione, e serve **lo stesso catalogo di Aurix**
  ma con due differenze utili: vuole l'id nudo (`534050211`, non `tidal:534050211`) e restituisce già
  `bitDepth`/`sampleRate` del file, quindi la qualità mostrata è quella vera del manifest.
  Nella prova dal vivo ha dato **24-bit / 88.2 kHz su Get Lucky**, dove Aurix ripiegava sul 16-bit.
- **Un id `tidal:…` vale per tutti e due gli addon.** Se uno dei due tace, è lento o risponde 429,
  lo stesso brano si chiede all'altro: si prova l'id com'è e poi senza prefisso. Un id nudo invece
  si usa **solo** con l'addon che l'ha dato, così non si rischia di suonare il brano sbagliato
  (i due cataloghi usano numeri che si somigliano).
- **I due addon si interrogano insieme.** La ricerca non aspetta il primo per chiedere al secondo:
  una sola raffica di richieste in parallelo, vince la prima lista non vuota, e la seconda fonte
  resta già «spedita» (prima un brano a freddo costava la somma dei due tempi: anche 10 s).
- **Tetti di tempo diversi**: Eljohnzc per primo perché di solito risponde in meno di un secondo, ma
  a freddo può incagliarsi per venti — la sua richiesta si abbandona dopo **4 s** (e in ricerca dopo
  **4 s** comunque), Aurix dopo **5 s**. Il manifest DASH si riprova una volta se non arriva: un
  secondo tentativo corto costa meno di un brano perso. Budget del brano portato a **14 s**.
- **Niente file che non sono quel brano.** I nomi con «karaoke», «tribute», «cover», «remix», «dj»,
  «instrumental», «acapella» si scartano — a meno che il titolo di Spotify non lo dica già. Serviva:
  per *Blinding Lights* l'Archivio restituiva una `radio-edit-dj-…`.
- **I token del pool condiviso non si interrogano più brano per brano.** Sono tutti `sample: true`
  (solo 30 secondi): si sa già, quindi si va dritti ai relay invece di spendere 6-9 s a chiedere un
  file che sarà un'anteprima. Con un token tuo o il login email/password restano in gioco come prima.
- **Quando un addon Tidal è in salute**, il ripiego sui relay Qobuz per id si salta: il loro CDN
  risponde 429 e il catalogo Tidal ha già lo stesso brano. Se un addon tace, resta in castigo tre
  minuti e il brano dopo non lo aspetta (primo brano a freddo: da ~13 s a ~3,4 s, e ora anche il
  primo della sessione arriva).

## Cosa è cambiato nella 4.5.0

- **Il lato Qobuz come lo fa `qobuz-dl`.** Qobuz cambia l'`app_id` e l'`app_secret` del player web a
  ogni versione: prima erano scritti nel codice e, quando cambiavano, `getFileUrl` rispondeva
  `400 Invalid app secret` e Qobuz moriva in silenzio. Adesso, solo quando serve, l'estensione
  rilegge la coppia dal bundle del player (`play.qobuz.com/login` → `bundle.js`, **prima fetta da
  2 MB** con `Range`, non i 9 MB interi) e riprova lo stesso token. Al massimo una lettura al giorno.
- **Il login parla come `qobuz-dl`.** Se l'app storica `712109809` viene rifiutata al login, si
  riprova con l'app del player. E dopo il login si legge `user.credential.parameters`: se è vuoto
  l'account **non ha un abbonamento** e Qobuz serve solo 30 secondi — l'estensione lo dice
  («solo anteprime da 30 s») invece di far credere che il brano sia rotto.
- **Nuova impostazione avanzata `Player Qobuz`**, per puntare a uno specchio o alle prove in locale.

## Cosa è cambiato nella 4.4.0

- **Via le fonti morte.** `qobuz-dll.foreyou.workers.dev` (Cloudflare `429` a ogni richiesta) e
  `tracks.monochrome.st` (nessuna risposta) erano accese di default: costavano un timeout a ogni
  brano e non servivano mai un file. Sono uscite dall'elenco predefinito — se un giorno tornano si
  possono rimettere a mano in *Indirizzo del relay*.
- **Dentro Aurix** (`addon-2.aurix.dpdns.org`): cerca su **Tidal** e restituisce un **manifest DASH**
  in FLAC, anche 24-bit. Myspoti lo suona come un file (`audio.manifest`); il download esce come
  `dash-flac`. È la fonte più completa per i brani mainstream, e non passa dal CDN dei relay Qobuz.
- **Il relay arriva prima.** Due ricerche Qobuz invece di quattro, e se il pool serve solo anteprime
  si salta subito al relay: la strada fino al file passa da ~7 s a ~3 s, e i brani che prima
  finivano su Spotify ora arrivano.
- **Un relay è «buono» solo se il file si apre.** Prima bastava che rispondesse con un indirizzo: un
  `429 Too many simultaneous streams` veniva consegnato al player, che si fermava. Adesso c'è una
  prova (`HEAD`, 2,5 s) e se il file non si apre si prova **un'altra fonte per lo stesso brano**
  invece di lasciarlo a Spotify.
- **Ordine di merito.** Gli addon che danno un manifest (Aurix) vengono interrogati per primi quando
  Myspoti sa suonarli; i servizi che hanno appena fallito finiscono in fondo per dieci minuti.

## Cosa era cambiato nella 4.3.0

Più fonti invece di una (arcod, instable, qobuz-dl, monochrome), `status` che non spegne più
l'estensione quando una sonda non conclude, pulsante **Prova le fonti**, tetto alle richieste
(4 per le ricerche, 6 per il file), prefisso `mono:` per gli indirizzi in forma monochrome.

## Come funziona

1. **Ricerca.** Si cerca su Qobuz con il titolo ripulito (`Bohemian Rhapsody - Remastered 2011` →
   `Bohemian Rhapsody`). Se il token serve solo anteprime, o Qobuz non ha il brano, si cerca nei
   relay (Aurix → Tidal, arcod e instable → Qobuz); solo se nessuno ha il brano si chiede a Internet
   Archive lo stesso titolo, filtrando gli item che contengono davvero FLAC.
2. **Abbinamento.** Ogni candidato passa le regole, dalla più sicura: **ISRC identico**; titolo +
   artista buoni e durata nella tolleranza; titolo molto buono con artista localizzato; album
   identico; titolo quasi identico senza metadati. Per Internet Archive la **stessa opera** va bene
   anche con una durata diversa (*Accetta altre esecuzioni*, accesa di default).
3. **Il file.** Qobuz ufficiale per primo (`getFileUrl`, firma MD5, hi-res e poi 16-bit); se il token
   risponde con un'anteprima si passa al token successivo e, esauriti i token, ai relay nell'ordine
   di salute; se nessun relay risponde, all'Archivio.
4. **Guardie sui file dell'Archivio.** Il nome del file deve somigliare al titolo, non deve essere una
   traccia separata dell'item, e il peso deve essere plausibile per la durata.
5. **Ripiego.** Se nessuna fonte ha un file suonabile, il brano resta su Spotify.

## Cosa fa

| Funzione | Come |
|---|---|
| **Streaming in FLAC** | hook `audio-source`: URL Qobuz, URL del relay o manifest DASH di Tidal |
| **Download in FLAC** | hook `download-source`: `.flac` vero (o `dash-flac`), con la dimensione per la barra |
| **Hi-res quando c'è** | chiede il formato Hi-Res e ripiega da solo sul formato dell'album |
| **Niente anteprime** | i token con `sample: true` vengono messi da parte, non serviti |
| **Tre strade** | Qobuz (token, login, pool, Bitchord), Tidal (token di ricerca, Eljohnzc, Aurix), Internet Archive |
| **Stato prudente** | `status` non spegne l'estensione se la sonda non conclude |
| **Cache** | abbinamenti 14 giorni, metadati dell'Archivio 14 giorni, token senza abbonamento 6 ore, token morti 20 minuti, indirizzi del relay 8 minuti |

## Installazione

Serve Myspoti **2.0.0 o successiva** (per Aurix, una versione che dichiari `audio.manifest`).

**1. Dal file.** Scarica [`extension.zip`](extension.zip) (o `app.eljohnzc.lossless-4.13.0.zip`, è lo
stesso file), copialo sul telefono e installalo da *Impostazioni ▸ Estensioni ▸ Installa da un file*.
Sopra la 4.5.0 Myspoti mostra **"Update needs your OK"** con le differenze (stesso `id`): si accetta
una volta e le impostazioni restano.

**2. Da un indirizzo.** Metti `extension.zip` in un repository pubblico e incolla l'indirizzo del file
in *Installa da un indirizzo*.

**3. Dal negozio.** Pubblica questo repository su GitHub con il topic **`myspoti-extension`** e una
release con `extension.zip` allegato (`git tag v4.13.0 && git push origin v4.13.0`; il workflow in
`.github/workflows/release.yml` controlla, compila e allega il pacchetto).

Poi: **Impostazioni ▸ Estensioni ▸ Lossless Hi-Res** e una playlist in play. Nel player, sotto il
dispositivo di uscita, compare la qualità del file servito (es. `24-BIT · 96 kHz`).

## Impostazioni

| Impostazione | Default | Cosa fa |
|---|---|---|
| **Token Qobuz personale** | vuoto | il tuo `user_auth_token`; più token separati da virgola, provati per primi |
| **Email dell'account Qobuz** | vuoto | con la password ottiene da sé un token, rinnovato ogni 12 ore |
| **Password Qobuz** | vuoto | resta sul telefono; in rete viaggia solo l'MD5. Serve un abbonamento attivo |
| **Indirizzo del pool di token** (avanzato) | vuoto | URL che restituisce `[{token, app_id, app_secret}]`, riletto ogni 6 ore |
| **Usa Qobuz (token e login)** | attivo | spento: si salta l'API ufficiale e si va ai relay |
| **Usa i relay (Eljohnzc, Aurix, Bitchord)** | attivo | spento: nessun servizio esterno, resta Internet Archive |
| **Token Tidal (account personale)** | il tuo | ricerca Tidal di prima mano (0,2-0,5 s, ISRC compresi) e controllo dell'abbonamento |
| **Indirizzo del relay** (avanzato) | vuoto = i quattro predefiniti | la tua lista separata da virgola, provata in ordine; `mono:` = forma monochrome, `dash:` = addon con manifest |
| **Accetta altre esecuzioni dall'Archivio** | attivo | accetta la stessa opera anche con durata diversa |
| **API Internet Archive** (avanzato) | vuoto = `archive.org` | serve per uno specchio o per le prove in locale |
| **Usa l'estensione anche in streaming** | attivo | spento: l'estensione serve solo ai download |
| **Preferisci l'hi-res** | attivo | prova prima il 24-bit, poi il 16-bit |
| **Tolleranza sulla durata** | ±6 s | quanto può differire la durata del file (±3 / ±6 / ±15) |
| **Prova le fonti** | — | una richiesta per fonte e un riassunto: chi risponde, cosa serve, cosa no |
| **Svuota cache e token** | — | dimentica abbinamenti, token rifiutati o da anteprima, relay segnati come muti |
| **API Qobuz** (avanzato) | vuoto = ufficiale | per uno specchio dell'API o per le prove in locale |
| **Player Qobuz** (avanzato) | vuoto = `play.qobuz.com` | da qui si rileggono `app_id` e `app_secret` quando Qobuz li cambia; per uno specchio o per le prove |

## Note e limiti (leggere prima di usarla)

- **L'API ufficiale serve solo con un abbonamento.** Senza, `getFileUrl` risponde `sample: true` e
  30 secondi; è una decisione del server, non un limite dell'estensione — `qobuz-dl` fa la stessa
  cosa e per un account gratuito si ferma con «Free accounts are not eligible to download tracks»,
  perché `user.credential.parameters` è vuoto. Il pool condiviso scritto qui è **tutto in anteprima**
  (verificato il 3/11/2026): per Qobuz a piena qualità serve un **tuo** account Studio (anche in
  prova) o un tuo `user_auth_token` — con quello i relay non vengono nemmeno interrogati.
- **Gli addon Tidal hanno bisogno di `audio.manifest`.** Se la tua Myspoti è più vecchia, vengono
  saltati e restano Bitchord, la ricerca Tidal con il token e l'Archivio. Il manifest contiene
  indirizzi su `*.audio.tidal.com`: sono dichiarati fra gli host dell'estensione, quindi non serve
  altro.
- **Gli addon sono servizi di terzi.** `eljohnzc-addon.de.deplexo.com`,
  `bitchord-hires-addon.de.deplexo.com` e `addon-2.aurix.dpdns.org` non sono Qobuz né Myspoti:
  possono cambiare indirizzo, rispondere `429` o chiudere, e ogni tanto non rispondono per qualche
  secondo (l'estensione riprova una volta e poi passa avanti). Il CDN dei loro file risponde
  `429 Too many simultaneous streams` quando ha già un flusso aperto: per questo, prima di consegnare
  un indirizzo, l'estensione lo prova e se non si apre passa a un'altra fonte.
- **Un ascolto alla volta.** Se il player si ferma su un brano e riparte con il successivo, aspetta
  qualche secondo: l'indirizzo appena chiesto potrebbe essere ancora «occupato» lato CDN.
- **L'indirizzo del file scade.** Il relay firma un URL valido circa un quarto d'ora (verificato: 206 a
  9 minuti): l'estensione lo tiene in cache **8 minuti** e poi lo richiede. I manifest DASH durano
  mezz'ora.
- **L'Archivio non è Spotify.** Contiene soprattutto registrazioni storiche, classica, jazz e pubblico
  dominio. Serve quando né l'API né i relay hanno il brano.
- **Le durate non coincidono.** Un 78 giri degli anni '30 dura spesso meno del brano rimasterizzato:
  per questo esiste *Accetta altre esecuzioni*.
- **Non è un servizio ufficiale**: Myspoti non è affiliato a Qobuz, a Tidal, ai relay né a Internet
  Archive e non ospita nulla. Usa l'estensione per i tuoi ascolti personali.
- **Peso dei file**: un brano in 24/96 pesa 100-200 MB; in 16/44.1 circa 35-60 MB; un FLAC
  dell'Archivio intorno ai 30-45 MB.

## Sviluppo

Non serve Android: Python 3 (solo Pillow) e Node.

```bash
python3 scripts/check.py          # regole di manifest e script (come myspoti-ext check)
node scripts/test-qobuz.js        # token, firma MD5, anteprime, rotazione, login, bundle (30 controlli)
node scripts/test-relay.js        # relay: ricerca, file, ripiego, 429, forme, DASH (41 controlli)
node scripts/test-node.js         # Internet Archive: abbinamento, scelta del file, guardie (11 controlli)
node scripts/test-settings.js     # impostazioni, regole, cache, stato, manifest (47 controlli)
node scripts/test-node.js --live  # guarda cosa fanno oggi i servizi veri, senza far fallire nulla

node scripts/mock-server.js 18080                      # finto servizio: Qobuz + Internet Archive
node scripts/mock-server.js 18080 --tokens=a,b         # accetta solo quei token (prova la rotazione)
node scripts/mock-server.js 18080 --relay              # aggiunge il relay (FLAC veri, 24 e 16 bit)
node scripts/mock-server.js 18080 --relay --relay-shape=kenny   # relay nella forma «Kenny»
node scripts/mock-server.js 18080 --relay --relay-limit         # ricerca che risponde 429
node scripts/mock-server.js 18080 --relay --media-limit         # file che risponde 429 (troppi flussi)
node scripts/mock-server.js 18080 --old-secret         # la secret scritta nell'estensione non vale più
node scripts/mock-server.js 18080 --free-login         # login su un account senza abbonamento
node scripts/mock-server.js 18080 --aurix              # addon DASH: /search, /stream/<id>, MPD
node scripts/mock-server.js 18080 --eljohnzc           # l'altro addon Tidal: id nudi, qualità «hires»
node scripts/mock-server.js 18080 --mono               # relay nella forma «monochrome»
node scripts/mock-server.js 18080 --slow-qobuz=9000    # Qobuz che non risponde (prova il ripiego)

python3 scripts/make_icon.py      # ridisegna icon.png
python3 scripts/pack.py           # extension.zip deterministico + sha256
```

Il finto servizio (in un processo a parte: `execFileSync` blocca Node) riproduce **cinque** protocolli:
l'API Qobuz (firma MD5 verificata come fa Qobuz, `user/login`, token che rispondono `sample: true`), il
relay `arcod` (`/api/search`, `/api/player/stream/<id>`), il relay `Qobuz-DL` (`/api/get-music`,
`/api/download-music`), il relay `monochrome` (`/search/tracks`, `/track/<id>`) e l'addon DASH
(`/search`, `/stream/<id>`, MPD con `SegmentTemplate`), con FLAC veri serviti a pezzi e degradazione
24→16 sugli album CD.

Ultimo giro (3/11/2026): `check.py` pulito; **30/30** Qobuz, **41/41** relay, **11/11** Internet
Archive, **47/47** impostazioni. Contro i servizi veri: Get Lucky, Bohemian Rhapsody, One More Time,
Take On Me e Clair de lune → **FLAC DASH da Tidal** (Bohemian 24-bit), Moonlight Sonata → FLAC
dell'Archivio, `status` → `{"live":true}`. Con il solo addon Eljohnzc: Get Lucky, Bohemian Rhapsody e
Blinding Lights → **24-bit** (88.2 / 96 / 44.1 kHz) in 2–4,7 s, segmenti `moof` scaricati dal CDN Tidal. Gli sha256 sono in [`SHA256SUMS`](SHA256SUMS).

## Licenza

Codice dell'estensione: MIT (vedi [`LICENSE`](LICENSE)). L'icona è disegnata da `scripts/make_icon.py`.
Myspoti è un progetto separato (GPL-3.0), di cui questa estensione usa solo l'API pubblica.
