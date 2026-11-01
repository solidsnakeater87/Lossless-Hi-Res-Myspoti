# Qobuz Hi-Res — estensione per Myspoti

Porta in **Myspoti** lo streaming e i download **FLAC 16 e 24-bit** del catalogo **Qobuz**, usando un
**pool di token condivisi** (lo stesso meccanismo dell'estensione Eclipse
[`echo-qobuz-extension`](https://github.com/TheWinner02/echo-qobuz-extension) 1.0.1), più l'addon
**BitChord Hi-Res** per Internet Archive come seconda fonte.

Stesso `id` di sempre (`app.eljohnzc.lossless`): in Myspoti si installa sopra la versione precedente e
tiene le impostazioni.

```
brano Spotify ──▶ abbinamento (titolo, artista, album, durata, ISRC)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  Qobuz (API ufficiale)     addon BitChord
  pool di token a rotazione  dz: / ia:
        │                        │
  /track/search            /search
  /track/getFileUrl        /stream/<id>
  (firma MD5)              (FLAC da archive.org)
        └───────────┬────────────┘
                    ▼
   Myspoti: audio-source (riproduzione) · download-source (file .flac)
```

## Come funziona il pool di token

Qobuz non permette di scaricare FLAC senza un **account pagante** e senza la firma `request_sig`
(MD5) calcolata con la `app_secret` dell'app. L'estensione Eclipse di riferimento aggira il problema
con un **pool di token di altri account**, messo lì dal suo autore; qui il meccanismo è lo stesso:

1. **Pool condiviso scritto dentro l'estensione**: tre token con `app_id 312369995` e la sua
   `app_secret`. *Al 27/10/2026 solo il primo è ancora valido* (account con abbonamento Studio).
2. **Rotazione**: ogni chiamata usa un token; un `401/403` fa passare al successivo e il token
   rifiutato viene **ricordato per 20 minuti** (nessun tentativo sprecato).
3. **Token personali** (campo *Token Qobuz personale*, più d'uno separati da virgola): hanno la
   precedenza. Sono l'unica cosa che non dipende da nessun altro: con un tuo `user_auth_token` di un
   account Studio l'estensione funziona sempre.
4. **Pool da un indirizzo** (campo *Indirizzo del pool*): se un giorno tornasse un endpoint tipo
   `…/shared` che restituisce `[{token, app_id, app_secret}]`, incollalo lì e l'estensione lo rilegge
   ogni 6 ore. **L'indirizzo storico `citegptapi.f5.si/webhook/qbdlx/shared` oggi non esiste più**
   (il TLS rifiuta il nome, verificato), e anche `qbdlx.launchpd.cloud` non risolve: per questo il
   campo è vuoto di default e il pool scritto dentro è l'unica fonte.
5. **Firma dei file**: `getFileUrl` richiede `request_ts` e `request_sig` =
   `md5("trackgetFileUrl" + "format_id<N>" + "intentstream" + "track_id<ID>" + ts + app_secret)`.
   L'estensione calcola l'MD5 in JavaScript puro (nel sandbox di Myspoti non ci sono le librerie Java)
   e lo ricalcola con la secret dell'app del token che sta rispondendo.

## Cosa fa

| Funzione | Come |
|---|---|
| **Streaming in FLAC** | hook `audio-source`: l'URL del file Qobuz (16/44.1 o 24-bit fino a 192 kHz) |
| **Download in FLAC** | hook `download-source`: `.flac` vero; con *qualità CD* preferisce il 16-bit (file più leggero) |
| **Hi-res quando c'è** | chiede il formato 27 (Hi-Res) e, se il brano non ce l'ha, Qobuz restituisce il 16-bit |
| **Abbinamento sicuro** | ISRC identico quando c'è (Qobuz lo fornisce), altrimenti titolo + artista + album + durata |
| **Niente anteprime** | se l'account del token è senza abbonamento, Qobuz risponde con 30 s (`sample: true`): rifiutati |
| **Due fonti** | se Qobuz non ha il brano, si prova l'addon BitChord (Internet Archive: classica, pubblico dominio, live) |
| **Token personali** | campo nelle impostazioni, più token separati da virgola |
| **Pool remoto** | campo per un indirizzo che restituisce la lista dei token (rilettura ogni 6 ore) |
| **Stato** | hook `status`: sonda una ricerca Qobuz; se nessun token vale, lo dice invece di far aspettare |
| **Cache** | abbinamenti 14 giorni, token morti 20 minuti, un bottone per dimenticare tutto |

## Installazione

Serve Myspoti **2.0.0 o successiva**.

**1. Dal file.** Scarica [`extension.zip`](extension.zip) (o `app.eljohnzc.lossless-4.0.0.zip`, è lo
stesso file), copialo sul telefono e installalo da *Impostazioni ▸ Estensioni ▸ Installa da un file*.
Sulla versione precedente Myspoti mostra **"Update needs your OK"** con le differenze (nuovo host di
rete `www.qobuz.com`, impostazioni nuove): si accetta una volta e l'estensione si aggiorna, tenendo le
impostazioni.

**2. Da un indirizzo.** Metti `extension.zip` in un repository pubblico e incolla l'indirizzo del file
in *Installa da un indirizzo*.

**3. Dal negozio.** Pubblica questo repository su GitHub con il topic **`myspoti-extension`** e una
release con `extension.zip` allegato (`git tag v4.0.0 && git push origin v4.0.0`; il workflow in
`.github/workflows/release.yml` controlla, compila e allega il pacchetto).

Poi: **Impostazioni ▸ Estensioni ▸ Qobuz Hi-Res** e una playlist in play. Nel player, sotto il
dispositivo di uscita, compare la qualità del file servito (es. `24-BIT · 88.2 kHz`).

## Impostazioni

| Impostazione | Default | Cosa fa |
|---|---|---|
| **Token Qobuz personale** | vuoto | il tuo `user_auth_token`; più token separati da virgola formano un pool personale, provato per primo |
| **Indirizzo del pool di token** (avanzato) | vuoto | URL che restituisce `[{token, app_id, app_secret}]` (o `{tokens: […]}`); riletto ogni 6 ore |
| **Usa Qobuz (pool di token)** | attivo | spento: resta solo l'addon BitChord (Internet Archive) |
| **Usa l'estensione anche in streaming** | attivo | spento: l'estensione serve solo ai download, la riproduzione resta su Spotify |
| **Preferisci l'hi-res** | attivo | chiede prima la versione 24-bit; se non c'è ripiega sul 16-bit |
| **Tolleranza sulla durata** | ±6 s | quanto può differire la durata del file da quella del brano Spotify (±3 / ±6 / ±15) |
| **Svuota cache e token** | — | dimentica abbinamenti, token rifiutati e pool letto da un indirizzo |
| **API Qobuz** (avanzato) | vuoto = ufficiale | serve per uno specchio dell'API o per le prove in locale |

## Come funziona l'abbinamento

1. Si cerca su Qobuz con il **titolo ripulito** (`Bohemian Rhapsody - Remastered 2011` → `Bohemian
   Rhapsody`) e con l'artista, poi con altre varianti; in parallelo si cerca sull'addon BitChord.
2. Ogni candidato passa queste regole, dalla più sicura: **ISRC identico**; titolo + artista buoni e
   durata nella tolleranza; titolo molto buono con artista localizzato; album identico con titolo o
   artista localizzati; titolo quasi identico senza metadati (Internet Archive).
3. Punteggio: titolo fino a 60, artista fino a 30, durata −30…22, album 0/8/12, hi-res +6, ISRC +100.
4. Ordine dei tentativi: prima le fonti già viste funzionare, poi l'alta risoluzione, poi il punteggio.
5. Prima di consegnare un file di Internet Archive si controllano il **nome del file** e la
   **dimensione** rispetto alla durata (un concerto da 547 MB per un brano da 3 minuti non passa).
6. Per i **download** si accettano solo edizioni con durata nella finestra che Myspoti controlla
   (−5 s / +15 s): meglio nessun file che uno scaricato e poi rifiutato.

## Note e limiti (leggere prima di usarla)

- **I token non sono tuoi.** Il pool condiviso è di account altrui: può smettere di funzionare in
  qualsiasi momento, essere svuotato, o essere bloccato da Qobuz. Oggi (27/10/2026) **1 token su 3**
  della lista condivisa funziona, con abbonamento Studio valido fino a novembre 2026.
- **Se i token finiscono**, i brani restano su Spotify e `status` dice perché. L'unica soluzione
  stabile è un **tuo** `user_auth_token` nel primo campo.
- **Abbonamento**: senza un account Studio i file arrivano come anteprime da 30 secondi (rifiutate)
  o non arrivano affatto.
- **Non è un servizio ufficiale**: Myspoti non è affiliato a Qobuz e non ospita nulla. Usa l'estensione
  per i tuoi ascolti personali, rispetta i termini dei servizi coinvolti e non rivendere l'accesso.
  Un uso intenso con token altrui può farli bloccare: non è un problema che questa estensione possa
  risolvere.
- **Peso dei file**: un brano in 24/96 pesa 100-200 MB; in 16/44.1 circa 35-60 MB.
- **BitChord resta limitato**: serve solo materiale di Internet Archive (classica, pubblico dominio,
  live) e a volte mappa il file sbagliato dentro l'item; le guardie lo scartano.

## Sviluppo

Non serve Android: Python 3 (solo Pillow) e Node.

```bash
python3 scripts/check.py          # regole di manifest e script (come myspoti-ext check)
node scripts/test-qobuz.js        # pool di token: ricerca, firma MD5, rotazione, anteprime, pool remoto (22 controlli)
node scripts/test-node.js         # l'addon BitChord: abbinamento e guardie sui file (13 controlli)
node scripts/test-settings.js     # impostazioni, regole di abbinamento, cache, stato (39 controlli)
node scripts/test-node.js --live  # guarda cosa fanno oggi i servizi veri, senza far fallire nulla

node scripts/mock-server.js 18080                 # finto servizio (Qobuz + addon) per prove a mano
node scripts/mock-server.js 18080 --tokens=a,b    # accetta solo quei token (prova la rotazione)
node scripts/mock-server.js 18080 --preview       # l'addon serve solo anteprime
node scripts/mock-server.js 18080 --no-addon      # solo l'API Qobuz finta

python3 scripts/make_icon.py      # ridisegna icon.png
python3 scripts/pack.py           # extension.zip deterministico + sha256
```

Il finto servizio (in un processo a parte: `execFileSync` blocca Node) riproduce **entrambi** i
protocolli: l'API Qobuz (`/qobuz/api.json/0.2/track/search` e `/track/getFileUrl`, con la **firma MD5
verificata come fa Qobuz**) e l'addon BitChord (id `dz:`/`ia:`, item con il file sbagliato, concerto
da 547 MB, `/health`). I file FLAC finti sono validi in testa: i test leggono davvero durata, bit depth
e sample rate in byte.

Ultimo giro (27/10/2026): `check.py` pulito; **22/22** controlli sul pool Qobuz, 13/13 sull'addon,
38/38 sulle impostazioni. Contro il **servizio vero**, con il pool condiviso: **9 brani su 10** di
prova (Daft Punk, Queen, Mahmood, Beatles, Cohen, Billie Eilish, Ed Sheeran, Debussy) sono arrivati in
FLAC — `Get Lucky` 24/88.2, `Bohemian Rhapsody` 24/96, `One More Time` 16/44.1 — con durata identica a
Spotify e download da 133 MB (hi-res) e 36 MB (CD). Gli sha256 sono in [`SHA256SUMS`](SHA256SUMS).

## Licenza

Codice dell'estensione: MIT (vedi [`LICENSE`](LICENSE)). L'icona è disegnata da `scripts/make_icon.py`.
Myspoti è un progetto separato (GPL-3.0), di cui questa estensione usa solo l'API pubblica. Il pool di
token viene dal progetto `echo-qobuz-extension` di TheWinner02: i token appartengono ai loro account.
