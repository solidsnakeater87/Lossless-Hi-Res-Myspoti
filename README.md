# Qobuz Hi-Res — estensione per Myspoti

Porta in **Myspoti** lo streaming e i download **FLAC** del catalogo **Qobuz** (16/44.1 e 24-bit): prima
con l'API ufficiale, poi con i **relay Qobuz-DL** (più d'uno, in ordine), e in ultima istanza con il
**FLAC di Internet Archive**. Tutto interrogato direttamente, senza dipendere da un solo servizio.

Stesso `id` di sempre (`app.eljohnzc.lossless`): in Myspoti si installa sopra la versione precedente e
tiene le impostazioni.

```
brano Spotify ──▶ abbinamento (titolo, artista, album, durata, ISRC)
                    │
   ┌────────────────┼─────────────────────────┐
   ▼                ▼                         ▼
 Qobuz ufficiale   relay (4 servizi)      Internet Archive
 token/login/pool  arcod · instable       advancedsearch + metadata
   │               qobuz-dl · monochrome  title:(…) AND format:(FLAC)
 /track/search     /api/search            /download/<item>/<file>.flac
 /track/getFileUrl /api/player/stream     (controllo nome + peso)
 (firma MD5)       (file intero)
   └────────────────┴─────────────────────────┘
                    ▼
   Myspoti: audio-source (riproduzione) · download-source (file .flac)
```

## Cosa è cambiato nella 4.3.0

- **Più fonti, non una.** I relay sono quattro e si provano in ordine: `arcod.xyz`,
  `instable.arcod.xyz`, `qobuz-dll.foreyou.workers.dev` (la forma Qobuz-DL cara a Echo) e
  `tracks.monochrome.st` (che dà il file direttamente su `/track/<id>`). Sono gli stessi servizi
  elencati nell'estensione **EchoMusicApp/lossless-extension**: quelli che rispondono sono rimasti qui.
  Un servizio che tace finisce in fondo per dieci minuti, un `429` si rispetta per il tempo che chiede.
- **Niente più estensione «spenta» per colpa di una sonda.** Myspoti, quando `status` risponde
  `live:false`, **spegne** l'estensione: ogni brano torna su Spotify finché una sonda non torna a
  dire sì. Prima bastava che il relay fosse lento o limitato (o che la sonda finisse il tempo) e
  l'estensione andava in pausa — il sintomo era esattamente «non funziona più». Adesso la sonda fa
  **una richiesta sola**, parte da una fonte che ha già servito un file negli ultimi dieci minuti, e
  se il tempo finisce **resta attiva**: l'ultima parola è del brano, non di una sonda andata male.
- **Pulsante «Prova le fonti».** Una richiesta per fonte e un riassunto a schermo, per esempio
  `Qobuz: solo anteprime · Archivio: file ok · arcod: ok · instable: ok · qobuz-dl: HTTP 429 ·
  monochrome: non risponde`. Serve a capire dal telefono che cosa risponde, senza leggere i log.
- **Tetto alle richieste.** Myspoti concede 120 richieste al minuto a tutta l'estensione: ogni
  chiamata al relay ora ne usa al massimo 4 per le ricerche e 6 per il file, così un servizio morto
  non brucia il minuto intero.
- **`mono:` davanti a un indirizzo.** Se metti in *Indirizzo del relay* `mono:https://…`, quel
  servizio viene interrogato nella forma monochrome (`/search/tracks` e il file su `/track/<id>`).
- **Archivio più paziente.** Più candidati per ricerca e seconda ricerca (titolo + artista) se i primi
  non passano le regole: «Clair de lune» torna a essere trovato in modo stabile.

## Cosa era cambiato nella 4.2.0

- **Il catalogo Qobuz torna a suonare** passando al relay quando i conti del pool servono solo
  anteprime (`"sample": true`, 30 s): il relay restituisce il **FLAC completo**, non un estratto.
- Qualità **dichiarata dal catalogo**, mai inventata; ricerca del relay contata (14 al minuto) e
  ricordata; l'Archivio non pesca più le tracce separate (`Drums.flac`).

## Come funziona

1. **Ricerca.** Si cerca su Qobuz con il titolo ripulito (`Bohemian Rhapsody - Remastered 2011` →
   `Bohemian Rhapsody`) e con l'artista. Se Qobuz non trova nulla si prova il primo relay che
   risponde; solo se nessuno ha il brano si chiede a Internet Archive lo stesso titolo, filtrando gli
   item che contengono davvero FLAC.
2. **Abbinamento.** Ogni candidato passa le regole, dalla più sicura: **ISRC identico**; titolo +
   artista buoni e durata nella tolleranza; titolo molto buono con artista localizzato; album identico;
   titolo quasi identico senza metadati. Per Internet Archive la **stessa opera** va bene anche con
   una durata diversa (*Accetta altre esecuzioni*, accesa di default).
3. **Il file.** Qobuz ufficiale per primo (`getFileUrl`, firma MD5, hi-res e poi 16-bit); se il token
   risponde con un'anteprima si passa al token successivo e, esauriti i token, ai relay nell'ordine
   di salute; se nessun relay risponde, all'Archivio.
4. **Guardie sui file dell'Archivio.** Il nome del file deve somigliare al titolo, non deve essere una
   traccia separata dell'item, e il peso deve essere plausibile per la durata.
5. **Ripiego.** Se nessuna fonte ha un file suonabile, il brano resta su Spotify.

## Cosa fa

| Funzione | Come |
|---|---|
| **Streaming in FLAC** | hook `audio-source`: URL del file Qobuz, di un relay o dell'Archivio |
| **Download in FLAC** | hook `download-source`: `.flac` vero, con la dimensione per la barra di Myspoti |
| **Hi-res quando c'è** | chiede il formato Hi-Res e ripiega da solo sul formato dell'album |
| **Niente anteprime** | i token con `sample: true` vengono messi da parte, non serviti |
| **Cinque strade** | Qobuz (token, login, pool), quattro relay, Internet Archive |
| **Stato prudente** | `status` non spegne l'estensione se la sonda non conclude |
| **Cache** | abbinamenti 14 giorni, metadati dell'Archivio 14 giorni, token senza abbonamento 6 ore, token morti 20 minuti, indirizzi del relay 8 minuti |

## Installazione

Serve Myspoti **2.0.0 o successiva**.

**1. Dal file.** Scarica [`extension.zip`](extension.zip) (o `app.eljohnzc.lossless-4.3.0.zip`, è lo
stesso file), copialo sul telefono e installalo da *Impostazioni ▸ Estensioni ▸ Installa da un file*.
Sopra la 4.2.0 Myspoti mostra **"Update needs your OK"** con le differenze (un pulsante nuovo, stesso
`id`): si accetta una volta e le impostazioni restano.

**2. Da un indirizzo.** Metti `extension.zip` in un repository pubblico e incolla l'indirizzo del file
in *Installa da un indirizzo*.

**3. Dal negozio.** Pubblica questo repository su GitHub con il topic **`myspoti-extension`** e una
release con `extension.zip` allegato (`git tag v4.3.0 && git push origin v4.3.0`; il workflow in
`.github/workflows/release.yml` controlla, compila e allega il pacchetto).

Poi: **Impostazioni ▸ Estensioni ▸ Qobuz Hi-Res** e una playlist in play. Nel player, sotto il
dispositivo di uscita, compare la qualità del file servito (es. `24-BIT · 88.2 kHz`).

## Impostazioni

| Impostazione | Default | Cosa fa |
|---|---|---|
| **Token Qobuz personale** | vuoto | il tuo `user_auth_token`; più token separati da virgola, provati per primi |
| **Email dell'account Qobuz** | vuoto | con la password ottiene da sé un token, rinnovato ogni 12 ore |
| **Password Qobuz** | vuoto | resta sul telefono; in rete viaggia solo l'MD5. Serve un abbonamento attivo |
| **Indirizzo del pool di token** (avanzato) | vuoto | URL che restituisce `[{token, app_id, app_secret}]`, riletto ogni 6 ore |
| **Usa Qobuz (token e login)** | attivo | spento: si salta l'API ufficiale e si va ai relay |
| **Usa i relay Qobuz** | attivo | spento: nessun servizio esterno, resta solo Internet Archive |
| **Indirizzo del relay** (avanzato) | vuoto = i quattro predefiniti | la tua lista separata da virgola, provata in ordine; `mono:` davanti a un indirizzo = forma monochrome |
| **Accetta altre esecuzioni dall'Archivio** | attivo | accetta la stessa opera anche con durata diversa |
| **API Internet Archive** (avanzato) | vuoto = `archive.org` | serve per uno specchio o per le prove in locale |
| **Usa l'estensione anche in streaming** | attivo | spento: l'estensione serve solo ai download |
| **Preferisci l'hi-res** | attivo | prova prima il 24-bit, poi il 16-bit |
| **Tolleranza sulla durata** | ±6 s | quanto può differire la durata del file (±3 / ±6 / ±15) |
| **Prova le fonti** | — | una richiesta per fonte e un riassunto: chi risponde, cosa serve, cosa no |
| **Svuota cache e token** | — | dimentica abbinamenti, token rifiutati o da anteprima, indirizzi del relay |
| **API Qobuz** (avanzato) | vuoto = ufficiale | per uno specchio dell'API o per le prove in locale |

## Note e limiti (leggere prima di usarla)

- **L'API ufficiale serve solo con un abbonamento.** Senza, risponde con 30 secondi di anteprima e il
  brano passa ai relay. Il pool condiviso scritto nell'estensione oggi è **tutto in anteprima**
  (verificato il 3/11/2026): con un **tuo** token Studio i relay non vengono nemmeno interrogati.
- **I relay sono servizi di terzi.** `arcod.xyz` e gli altri non sono Qobuz e non sono Myspoti:
  possono cambiare indirizzo, rispondere `429` o chiudere — è successo alle fonti dell'estensione Echo
  (`qbdlx.launchpd.cloud` non esiste più, `citegptapi.f5.si` non risponde). Per questo la lista è
  modificabile, spegnibile, e l'Archivio resta come ultima strada.
- **Un ascolto alla volta.** Il servizio dei file rifiuta più flussi contemporanei con
  `429 Too many simultaneous streams` (`retry-after: 5`): succede solo saltando molti brani in pochi
  secondi, e passa da sé — se il player si ferma, riprova dopo qualche secondo.
- **L'indirizzo del file scade.** Il relay firma un URL valido circa un quarto d'ora (verificato: 206 a
  9 minuti, scaduto a 15): l'estensione lo tiene in cache **8 minuti** e poi lo richiede.
- **L'Archivio non è Spotify.** Contiene soprattutto registrazioni storiche, classica, jazz e pubblico
  dominio. Serve quando né l'API né i relay hanno il brano.
- **Le durate non coincidono.** Un 78 giri degli anni '30 dura spesso meno del brano rimasterizzato:
  per questo esiste *Accetta altre esecuzioni*.
- **Non è un servizio ufficiale**: Myspoti non è affiliato a Qobuz, ai relay né a Internet Archive e
  non ospita nulla. Usa l'estensione per i tuoi ascolti personali.
- **Peso dei file**: un brano in 24/96 pesa 100-200 MB; in 16/44.1 circa 35-60 MB; un FLAC
  dell'Archivio intorno ai 30-45 MB.

## Sviluppo

Non serve Android: Python 3 (solo Pillow) e Node.

```bash
python3 scripts/check.py          # regole di manifest e script (come myspoti-ext check)
node scripts/test-qobuz.js        # token, firma MD5, anteprime, rotazione, login (23 controlli)
node scripts/test-relay.js        # relay: ricerca, file, ripiego, 429, forme, monochrome (30 controlli)
node scripts/test-node.js         # Internet Archive: abbinamento, scelta del file, guardie (11 controlli)
node scripts/test-settings.js     # impostazioni, regole, cache, stato, manifest (47 controlli)
node scripts/test-node.js --live  # guarda cosa fanno oggi i servizi veri, senza far fallire nulla

node scripts/mock-server.js 18080                      # finto servizio: Qobuz + Internet Archive
node scripts/mock-server.js 18080 --tokens=a,b         # accetta solo quei token (prova la rotazione)
node scripts/mock-server.js 18080 --relay              # aggiunge il relay (FLAC veri, 24 e 16 bit)
node scripts/mock-server.js 18080 --relay --relay-shape=kenny   # relay nella forma «Kenny»
node scripts/mock-server.js 18080 --relay --relay-limit         # ricerca che risponde 429
node scripts/mock-server.js 18080 --mono               # relay nella forma «monochrome»
node scripts/mock-server.js 18080 --slow-qobuz=9000    # Qobuz che non risponde (prova il ripiego)

python3 scripts/make_icon.py      # ridisegna icon.png
python3 scripts/pack.py           # extension.zip deterministico + sha256
```

Il finto servizio (in un processo a parte: `execFileSync` blocca Node) riproduce **quattro** protocolli:
l'API Qobuz (firma MD5 verificata come fa Qobuz, `user/login`, token che rispondono `sample: true`), il
relay `arcod` (`/api/search`, `/api/player/stream/<id>`), il relay `Qobuz-DL` (`/api/get-music`,
`/api/download-music`) e il relay `monochrome` (`/search/tracks`, `/track/<id>`), con FLAC veri serviti
a pezzi e degradazione 24→16 sugli album CD.

Ultimo giro (3/11/2026): `check.py` pulito; **23/23** Qobuz, **30/30** relay, **11/11** Internet
Archive, **47/47** impostazioni. Contro i servizi veri: Get Lucky → 24/88.2 dal relay, Bohemian
Rhapsody → 24/96, One More Time → 16/44.1, Take On Me → 24/192, Clair de lune e Moonlight Sonata →
FLAC dell'Archivio, `Prova le fonti` → `Qobuz: solo anteprime · Archivio: file ok · arcod: ok ·
instable: ok · qobuz-dl: HTTP 429 · monochrome: non risponde`. Gli sha256 sono in [`SHA256SUMS`](SHA256SUMS).

## Licenza

Codice dell'estensione: MIT (vedi [`LICENSE`](LICENSE)). L'icona è disegnata da `scripts/make_icon.py`.
Myspoti è un progetto separato (GPL-3.0), di cui questa estensione usa solo l'API pubblica.
