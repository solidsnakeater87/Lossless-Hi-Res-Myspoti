# Qobuz Hi-Res — estensione per Myspoti

Porta in **Myspoti** lo streaming e i download **FLAC 16 e 24-bit** del catalogo **Qobuz**, usando un
**pool di token condivisi** 

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



## Licenza

Codice dell'estensione: MIT (vedi [`LICENSE`](LICENSE)). L'icona è disegnata da `scripts/make_icon.py`.
Myspoti è un progetto separato (GPL-3.0), di cui questa estensione usa solo l'API pubblica.
