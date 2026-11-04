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

**1. Dal file.** Scarica [`extension.zip`](extension.zip) (o `app.eljohnzc.lossless-4.9.0.zip`, è lo
stesso file), copialo sul telefono e installalo da *Impostazioni ▸ Estensioni ▸ Installa da un file*.
Sopra la 4.5.0 Myspoti mostra **"Update needs your OK"** con le differenze (stesso `id`): si accetta
una volta e le impostazioni restano.

**2. Da un indirizzo.** Metti `extension.zip` in un repository pubblico e incolla l'indirizzo del file
in *Installa da un indirizzo*.

**3. Dal negozio.** Pubblica questo repository su GitHub con il topic **`myspoti-extension`** e una
release con `extension.zip` allegato (`git tag v4.9.0 && git push origin v4.9.0`; il workflow in
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
