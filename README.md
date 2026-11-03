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
 Qobuz ufficiale   relay                     Internet Archive
 token/login/pool  Aurix   → Tidal (DASH)     advancedsearch + metadata
   │               arcod   → Qobuz            title:(…) AND format:(FLAC)
 /track/search     instable→ Qobuz            /download/<item>/<file>.flac
 /track/getFileUrl /search, /stream/<id>       (controllo nome + peso)
 (firma MD5)       (file intero o manifest)
   └────────────────┴──────────────────────────┘
                    ▼
   Myspoti: audio-source (riproduzione) · download-source (file .flac)
```

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
| **Tre strade** | Qobuz (token, login, pool), relay (Eljohnzc, Aurix, arcod, instable), Internet Archive |
| **Stato prudente** | `status` non spegne l'estensione se la sonda non conclude |
| **Cache** | abbinamenti 14 giorni, metadati dell'Archivio 14 giorni, token senza abbonamento 6 ore, token morti 20 minuti, indirizzi del relay 8 minuti |

## Installazione

Serve Myspoti **2.0.0 o successiva** (per Aurix, una versione che dichiari `audio.manifest`).

**1. Dal file.** Scarica [`extension.zip`](extension.zip) (o `app.eljohnzc.lossless-4.6.1.zip`, è lo
stesso file), copialo sul telefono e installalo da *Impostazioni ▸ Estensioni ▸ Installa da un file*.
Sopra la 4.5.0 Myspoti mostra **"Update needs your OK"** con le differenze (stesso `id`): si accetta
una volta e le impostazioni restano.

**2. Da un indirizzo.** Metti `extension.zip` in un repository pubblico e incolla l'indirizzo del file
in *Installa da un indirizzo*.

**3. Dal negozio.** Pubblica questo repository su GitHub con il topic **`myspoti-extension`** e una
release con `extension.zip` allegato (`git tag v4.6.1 && git push origin v4.6.1`; il workflow in
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
| **Usa i relay (Eljohnzc, Aurix, arcod, instable)** | attivo | spento: nessun servizio esterno, resta solo Internet Archive |
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
- **Aurix ha bisogno di `audio.manifest`.** Se la tua Myspoti è più vecchia, l'addon viene saltato e
  restano arcod, instable e l'Archivio. Il manifest contiene indirizzi su `*.audio.tidal.com`: sono
  dichiarati fra gli host dell'estensione, quindi non serve altro.
- **I relay sono servizi di terzi.** `arcod.xyz`, `instable.arcod.xyz` e l'addon Aurix non sono
  Qobuz e non sono Myspoti: possono cambiare indirizzo, rispondere `429` o chiudere. Il CDN dei file
  di arcod (`api.arcod.xyz`) risponde `429 Too many simultaneous streams` quando ha già un flusso
  aperto per lo stesso token: misurato il 3/11/2026, e per questo prima di consegnare un indirizzo
  l'estensione lo prova e, se non si apre, passa a un'altra fonte.
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
