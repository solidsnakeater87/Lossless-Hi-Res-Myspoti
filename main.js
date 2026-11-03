/*
 * BitChord Hi-Res — estensione per Myspoti (API 1)
 * Aggiornamento 3.0 dell'estensione "Eljohnzc Lossless": stesso id, nuovo
 * servizio. Punta all'addon BitChord Hi-Res (id dev.akira.bitchord-hires,
 * "juanjob hi res", https://bitchord-hires-addon.vercel.app).
 * ---------------------------------------------------------------------------
 * Il servizio espone:
 *   GET /search?q=<testo>  -> { tracks: [ { id, title, artist, album,
 *                                        artworkURL, format, audioQuality,
 *                                        source, duration (solo Deezer) } ] }
 *                             Gli id hanno la fonte davanti: dz:<id> (Deezer,
 *                             metadati), ia:<item> (Internet Archive), e in
 *                             generale <sigla>:<id> per le altre fonti.
 *   GET /stream/<id>       -> { url: "https://…/file.flac", codec: "flac",
 *                               bitDepth, sampleRate, provider, quality }
 *                             oppure 404 {"error":"not available in this addon"}
 *   GET /health            -> { providers: [ { provider, reachable, ms } ] }
 *   GET <url>              -> il file FLAC (Range e HEAD supportati)
 *
 * Com'è fatto l'addon, e come lo gestisce l'estensione:
 *  - Deezer è solo un catalogo: per i suoi id /stream risponde sempre 404.
 *    L'estensione impara quali fonti sanno servire audio (cache 6 h) e salta
 *    le altre, così un brano commerciale torna subito su Spotify;
 *  - Internet Archive serve FLAC veri (16/24-bit) ma non dichiara artista,
 *    album né durata: l'abbinamento si regge sul titolo (anche nel formato
 *    "Artista - Titolo") e il nome del file fa da secondo controllo;
 *  - l'item di Internet Archive a volte mappa un altro brano e a volte è un
 *    concerto intero: il nome del file e la dimensione rispetto alla durata
 *    di Spotify scartano i casi sbagliati;
 *  - la ricerca non dà ISRC: l'abbinamento sta su titolo, artista, album,
 *    durata (l'ISRC si usa se prima o poi comparirà).
 *
 * Myspoti non conosce gli addon: conosce gli hook. Questa estensione fa ponte:
 *   audio-source     -> l'URL del FLAC da riprodurre
 *   download-source  -> l'URL del FLAC da scaricare
 *   status           -> dice se il servizio risponde, così Myspoti può saltarlo
 *
 * Tutto è sincrono (Rhino, niente promise): i callback restituiscono il valore.
 */

var PROVIDER = 'Qobuz Hi-Res';

/* --- Internet Archive, interrogato direttamente (niente addon di terzi) --- */
var IA = 'https://archive.org';
var IA_PREFIX = 'ia:';
var IA_META_KEY = 'ia_meta';
var IA_META_TTL_MS = 14 * 24 * 60 * 60 * 1000;
var IA_ITEMS = 8;      // item guardati per ricerca (un metadata per item)
var IA_FILES = 0.55;   // quanto il nome del file deve somigliare al titolo

/* --- Qobuz, via API ufficiale con pool di token condivisi --------------- */
var QOBUZ_API = 'https://www.qobuz.com/api.json/0.2/';
var QOBUZ_PREFIX = 'qz:';
var TOKENS_KEY = 'qobuz_tokens';
var TOKEN_DEAD_MS = 20 * 60 * 1000;   // un token che risponde 401 si riprova dopo
var TOKEN_PREVIEW_MS = 6 * 60 * 60 * 1000; // account senza abbonamento: solo anteprime
var POOL_TTL_MS = 6 * 60 * 60 * 1000; // un pool remoto si rilegge ogni 6 ore
var POOL_TIMEOUT = 3500;

/*
 * Il pool condiviso: stesso elenco (token + app_id + app_secret) che usa
 * l'estensione Eclipse "echo-qobuz-extension" nella sua versione 1.0.1.
 * Sono token di account altrui, messi lì dal suo autore: possono smettere di
 * funzionare da un giorno all'altro, per questo si ruota e si accetta anche
 * un token personale dalle impostazioni.
 */
var SHARED_TOKENS = [
  { token: 'LXcX98uaBz8NPoRZsigyB6TfCemNotzeG7oVwy5XZHPKXNeLMXJUPyEGAM6c5qUpBWnkqmRaRUbJGup9oSsh_w', appId: '312369995', appSecret: 'e79f8b9be485692b0e5f9dd895826368' },
  { token: '7W1P_bimeouwcLTVKjV1UGr_MJp4psetcljd1awOU9QksKi9AmHKvf6MtIdvzP0HuLLENvmM2pJErjSuE_3N3g', appId: '312369995', appSecret: 'e79f8b9be485692b0e5f9dd895826368' },
  { token: 'O97vZDyvXmYhLPfbn07D8Y4SFN02DyRrYb3Pe3rQXWnw1HosDl9vfQTGRQEo2zkkcwP9ADc3L20nYNaI0l7E4g', appId: '312369995', appSecret: 'e79f8b9be485692b0e5f9dd895826368' }
];
var QOBUZ_APP = { appId: '798273057', appSecret: 'abb21364945c0583309667d13ca3d93a' };
var QOBUZ_LOGIN_APP = '712109809'; // l'unica app che accetta user/login con email e password

/*
 * Il relay Qobuz: un servizio pubblico che parla con Qobuz per noi e restituisce
 * l'indirizzo di un FLAC intero. L'estensione di Echo lo usa come ripiego quando
 * i token del pool non bastano ("fallback stream resolvers") e per la ricerca
 * usa lo stesso JSON del catalogo Qobuz (id, titolo, artista, album, ISRC,
 * durata, profondità). Quello che indicava Echo (citegptapi.f5.si,
 * qbdlx.launchpd.cloud) oggi non esiste più: questo risponde.
 */
var RELAY = 'https://arcod.xyz';
var RELAY_PREFIX = 'rl:';
var RELAY_TTL_MS = 8 * 60 * 1000;  // un indirizzo del relay vale pochi minuti
var PROBE_KEY = 'probe';
var PROVIDERS_KEY = 'providers';
var CACHE_KEY = 'matches_qobuz';

var TTL_MATCH_MS = 14 * 24 * 60 * 60 * 1000; // l'elenco dei candidati vale 14 giorni
var KEEP_ANSWER_MS = 9 * 60 * 1000;           // quanto una risposta resta buona (Myspoti ne tiene 10)
var MIN_LEFT_MS = 60 * 1000;                  // sotto questo margine il token sta per scadere
var RETRY_MS = 5000;                          // richiesta identica entro questo tempo = un nuovo tentativo
var MAX_CACHE = 600;                          // brani ricordati al massimo
var MAX_TRIES = 5;                            // id provati per un brano: alcune edizioni rispondono 502
var MAX_CANDIDATES = 8;                       // candidati tenuti per brano
var TIMEOUT = 6000;                           // ms per richiesta
var MAX_QUERIES = 4;                          // ricerche provate per brano
var PROVIDER_TTL_MS = 6 * 60 * 60 * 1000;     // quanto si ricorda che una fonte non serve audio
var MAX_MB_PER_SECOND = 1.6;                  // tetto di dimensione di un FLAC (24/192 ≈ 1,2 MB/s)
var FORMAT_HI = 27;                           // FLAC 24-bit (Qobuz riporta al 16-bit se non c'è)
var FORMAT_CD = 6;                            // FLAC 16-bit / 44.1 kHz
var MAX_TOKEN_TRIES = 6;                      // token provati per una chiamata

/* Risposte tenute in memoria per la durata dell'app: id Spotify -> risposta. */
var answers = {};

/*
 * Tempo massimo di una chiamata di hook (Myspoti la abbandona a 15 s per
 * audio-source, 30 s per download-source): ogni richiesta HTTP usa quello che
 * resta, così l'estensione risponde sempre "non ce l'ho" in tempo.
 */
var deadline = 0;
var budgetTotal = 0; // quanto tempo è stato concesso all'azione in corso

function now() {
  return new Date().getTime();
}

function startBudget(seconds) {
  budgetTotal = seconds * 1000;
  deadline = now() + budgetTotal;
}

/**
 * Vero quando conviene smettere di cercare: le soglie sono fisse per lo
 * streaming (15 s), ma `status` ha solo 4 s, quindi diventano proporzionali al
 * tempo concesso invece di scattare subito.
 */
function nearDeadline(wantedMs, share) {
  var limit = Math.min(wantedMs, Math.max(700, Math.floor(budgetTotal * share)));
  return leftMs() < limit;
}

function leftMs() {
  return deadline ? deadline - now() : TIMEOUT * 2;
}

/** Il timeout da passare a http: il minore fra il desiderato e quello che resta. */
function timeoutFor(ms) {
  return Math.max(1200, Math.min(ms || TIMEOUT, leftMs()));
}

/**
 * Ogni candidato porta la fonte davanti: `qz:<trackId>` (Qobuz),
 * `ia:<item>/<file>` (Internet Archive). La fonte si impara dalle risposte e si
 * ricorda per qualche ora.
 */
function providerOf(id) {
  var m = /^([a-z]{1,8}):/.exec(String(id || ''));
  return m ? m[1] : '';
}

function providers() {
  var all = myspoti.storage.get(PROVIDERS_KEY);
  return (all && typeof all === 'object') ? all : {};
}

/** Le fonti che possono servire audio: Qobuz diretto, relay Qobuz, Archivio. */
function isAudioProvider(id) {
  var name = providerOf(id);
  return name === 'qz' || name === 'rl' || name === 'ia';
}

/** False quando questa fonte ha già risposto "non ho audio" da poco. */
function providerUsable(id) {
  var name = providerOf(id);
  if (!name) return true; // id senza prefisso: si prova
  var e = providers()[name];
  if (!e || e.ok) return true;
  return (now() - (e.at || 0)) > PROVIDER_TTL_MS;
}

function markProvider(id, ok) {
  var name = providerOf(id);
  if (!name) return;
  var all = providers();
  var before = all[name];
  if (before && !!before.ok === !!ok && (now() - (before.at || 0)) < 60000) return;
  all[name] = { ok: !!ok, at: now() };
  try {
    myspoti.storage.set(PROVIDERS_KEY, all);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

/* ------------------------------------------------------------------ */
/* Piccole utilità                                                     */
/* ------------------------------------------------------------------ */

function trim(s) {
  return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function indexOf(arr, value) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === value) return i;
  }
  return -1;
}

/** GET che non lancia: il corpo in testo, o null (stato non 2xx, rete assente). */
function httpText(url, timeoutMs) {
  try {
    var r = myspoti.http.get(url, { timeout: timeoutFor(timeoutMs) });
    if (!r || !r.ok) return null;
    return r.body;
  } catch (e) {
    myspoti.log('http: ' + e);
    return null;
  }
}

/** La risposta intera (anche 4xx), o null se la richiesta non parte. */
function httpRaw(url, timeoutMs) {
  try {
    var r = myspoti.http.get(url, { timeout: timeoutFor(timeoutMs) });
    return r || null;
  } catch (e) {
    myspoti.log('http: ' + e);
    return null;
  }
}

/** Un POST di modulo (serve solo al login Qobuz). null se non parte. */
function httpPostForm(url, fields, timeoutMs) {
  var body = '';
  for (var k in fields) {
    if (!fields.hasOwnProperty(k)) continue;
    if (body) body += '&';
    body += encodeURIComponent(k) + '=' + encodeURIComponent(String(fields[k]));
  }
  var headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };
  var r = null;
  try {
    r = myspoti.http.request({
      url: url, method: 'POST', headers: headers, body: body,
      timeout: timeoutFor(timeoutMs || 6000)
    });
  } catch (e) {
    myspoti.log('post: ' + e);
    r = null;
  }
  if (r && (r.status || r.body)) {
    var parsed = null;
    try {
      parsed = JSON.parse(r.body || '');
    } catch (e2) {
      parsed = null;
    }
    return { status: r.status || 0, body: parsed };
  }
  // Qualche versione di Myspoti offre solo http.post.
  try {
    if (myspoti.http.post) {
      var p = myspoti.http.post(url, body, { headers: headers, timeout: timeoutFor(timeoutMs || 6000) });
      var body2 = p && (p.body !== undefined ? p.body : p);
      var parsed2 = null;
      if (typeof body2 === 'string') {
        try {
          parsed2 = JSON.parse(body2);
        } catch (e3) {
          parsed2 = null;
        }
      } else if (body2 && typeof body2 === 'object') {
        parsed2 = body2;
      }
      return { status: (p && p.status) || (parsed2 ? 200 : 0), body: parsed2 };
    }
  } catch (e4) {
    myspoti.log('post: ' + e4);
  }
  return null;
}

/** GET JSON che non lancia: l'oggetto, o null. */
function httpJson(url, timeoutMs) {
  var body = httpText(url, timeoutMs);
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

/** Dimensione in byte da una HEAD, 0 se non si sa (solo per la barra dei download). */
function sizeOf(url) {
  try {
    var r = myspoti.http.request({ url: url, method: 'HEAD', timeout: timeoutFor(4000) });
    if (!r || !r.ok) return 0;
    var h = r.headers || {};
    var raw = h['content-length'];
    var n = raw ? parseInt(String(raw).split(',')[0], 10) : 0;
    return n > 0 ? n : 0;
  } catch (e) {
    myspoti.log('HEAD: ' + e);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Normalizzazione dei testi (titoli, artisti, album)                  */
/* ------------------------------------------------------------------ */

/* Rhino non ha String.prototype.normalize: le lettere accentate si piegano qui. */
var FOLD = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
  'ç': 'c', 'ć': 'c', 'č': 'c', 'ĉ': 'c', 'ċ': 'c',
  'ď': 'd', 'đ': 'd',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ĕ': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
  'ĝ': 'g', 'ğ': 'g', 'ġ': 'g', 'ģ': 'g', 'ĥ': 'h', 'ħ': 'h',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ĩ': 'i', 'ī': 'i', 'ĭ': 'i', 'į': 'i', 'ı': 'i',
  'ĵ': 'j', 'ķ': 'k', 'ĺ': 'l', 'ļ': 'l', 'ľ': 'l', 'ŀ': 'l', 'ł': 'l',
  'ñ': 'n', 'ń': 'n', 'ņ': 'n', 'ň': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'ō': 'o', 'ő': 'o',
  'ŕ': 'r', 'ŗ': 'r', 'ř': 'r',
  'ś': 's', 'ŝ': 's', 'ş': 's', 'š': 's', 'ß': 'ss',
  'ţ': 't', 'ť': 't', 'ŧ': 't',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ũ': 'u', 'ū': 'u', 'ŭ': 'u', 'ů': 'u', 'ű': 'u', 'ų': 'u',
  'ŵ': 'w', 'ý': 'y', 'ÿ': 'y', 'ŷ': 'y', 'ź': 'z', 'ż': 'z', 'ž': 'z',
  'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th'
};

function fold(s) {
  var s2 = String(s == null ? '' : s).toLowerCase();
  var out = '';
  for (var i = 0; i < s2.length; i++) {
    var c = s2.charAt(i);
    out += FOLD[c] ? FOLD[c] : c;
  }
  return out;
}

/** True quando il testo ha almeno una lettera latina (a-z, anche accentata). */
function hasLatin(s) {
  var t = String(s == null ? '' : s).toLowerCase();
  for (var i = 0; i < t.length; i++) {
    var c = t.charAt(i);
    if ((c >= 'a' && c <= 'z') || FOLD[c]) return true;
  }
  return false;
}

/**
 * Vero quando il testo è scritto in un'altra scrittura (giapponese, cirillico,
 * greco, arabo, coreano…): il servizio localizza i nomi, per cui un titolo o un
 * artista "straniero" non è un errore ma una traduzione.
 */
function isForeign(s) {
  var t = trim(s);
  if (!t) return false;
  return !hasLatin(t);
}

/**
 * Forma confrontabile: minuscolo, senza accenti, via i "(feat. …)", i "[…]" e i
 * suffissi di versione ("- 2011 Remaster", "- Radio Edit"), solo lettere e cifre.
 */
function norm(s) {
  var out = fold(s);
  out = out.replace(/\((?:feat|ft|featuring|with|con)\b[^)]*\)/g, ' ');
  out = out.replace(/\[(?:feat|ft|featuring|with|con)\b[^\]]*\]/g, ' ');
  out = out.replace(/\s+-\s+.*$/, ' ');
  out = out.replace(/\b(?:feat|ft|featuring)\.?\s+.*$/, ' ');
  out = out.replace(/&/g, ' and ');
  out = out.replace(/[^a-z0-9]+/g, ' ');
  return trim(out);
}

function tokensOf(s) {
  if (!s) return [];
  var parts = String(s).split(' ');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) out.push(parts[i]);
  }
  return out;
}

/** Quanto due testi condividono le parole: 0 (niente) … 1 (le stesse). */
function overlap(a, b) {
  var ta = tokensOf(a);
  var tb = tokensOf(b);
  if (!ta.length || !tb.length) return 0;
  var hit = 0;
  for (var i = 0; i < ta.length; i++) {
    if (indexOf(tb, ta[i]) >= 0) hit++;
  }
  return hit / Math.max(ta.length, tb.length);
}

/* ------------------------------------------------------------------ */
/* Impostazioni                                                        */
/* ------------------------------------------------------------------ */

function setting(key, fallback) {
  var v = myspoti.settings.get(key);
  return (v === undefined || v === null) ? fallback : v;
}

function streamEnabled() {
  var v = setting('streamEnabled', true);
  return v !== false && String(v) !== 'false';
}

function preferHiRes() {
  var v = setting('preferHiRes', true);
  return v !== false && String(v) !== 'false';
}

/** Tolleranza in secondi tra la durata Spotify e quella del candidato. */
function toleranceSec() {
  var v = String(setting('tolerance', ''));
  if (v.indexOf('Rigorosa') === 0) return 3;
  if (v.indexOf('Permissiva') === 0) return 15;
  return 6;
}

/* ------------------------------------------------------------------ */
/* Abbinamento del brano                                               */
/* ------------------------------------------------------------------ */

/** Chiave stabile di un brano Spotify (id se c'è, altrimenti titolo/artista/durata). */
function matchKey(track) {
  if (track.id) return 'id:' + track.id;
  return 'x:' + norm(track.artist) + '|' + norm(track.title) + '|' + Math.round((track.durationMs || 0) / 1000);
}

function isMyspotiTrack(track) {
  if (!track || !track.title) return false;
  if (track.id) return true;
  return String(track.uri || '').indexOf('spotify:track:') === 0;
}

function readCache(key) {
  var all = myspoti.storage.get(CACHE_KEY);
  if (!all || typeof all !== 'object') return null;
  var e = all[key];
  if (!e || !e.ids || !e.ids.length) return null;
  if (e.at && now() - e.at > TTL_MATCH_MS) return null;
  return e;
}

function writeCache(key, entry) {
  var all = myspoti.storage.get(CACHE_KEY);
  if (!all || typeof all !== 'object') all = {};
  all[key] = entry;
  var keys = [];
  for (var k in all) {
    if (all.hasOwnProperty(k)) keys.push(k);
  }
  if (keys.length > MAX_CACHE) {
    keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
    for (var i = 0; i < keys.length - MAX_CACHE; i++) delete all[keys[i]];
  }
  try {
    myspoti.storage.set(CACHE_KEY, all);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

function isrcOf(track) {
  var v = track.isrc;
  return v ? String(v).toLowerCase() : '';
}

function durationSec(candidate) {
  var d = candidate.duration;
  if (d === undefined || d === null) return 0;
  var n = Number(d);
  if (isNaN(n) || n <= 0) return 0;
  // Alcune risposte danno i millisecondi: oltre un'ora e mezza in secondi è sospetto.
  return n > 5400 ? Math.round(n / 1000) : n;
}

function trackDurationSec(track) {
  var ms = Number(track.durationMs || 0);
  return ms > 0 ? ms / 1000 : 0;
}

/** Scarto di durata in secondi (Infinity quando uno dei due non la dichiara). */
function durationDelta(candidate, track) {
  var want = trackDurationSec(track);
  var got = durationSec(candidate);
  if (!want || !got) return Infinity;
  return Math.abs(want - got);
}

function durationOk(candidate, track) {
  var delta = durationDelta(candidate, track);
  return delta === Infinity || delta <= toleranceSec();
}

/** -30 … 22: la durata del candidato rispetto a quella del brano. */
function durationScore(candidate, track) {
  var delta = durationDelta(candidate, track);
  if (delta === Infinity) return 0;
  if (delta <= 1.5) return 22;
  if (delta <= 3) return 16;
  if (delta <= 6) return 8;
  if (delta <= 12) return -6;
  return -30;
}

/** 0 … 60: quanto il titolo del candidato somiglia a quello cercato. */
function titleScore(candidate, track) {
  var want = norm(track.title);
  var got = norm(candidate.title);
  if (!want || !got) return 0;
  if (want === got) return 60;
  if (got.indexOf(want) === 0 || want.indexOf(got) === 0) return 46;
  if (got.indexOf(want) >= 0 || want.indexOf(got) >= 0) return 34;
  return Math.round(32 * overlap(want, got));
}

/** 0 … 30: l'artista del candidato è uno degli artisti del brano. */
function artistScore(candidate, track) {
  var raw = trim(String(candidate.artist == null ? '' : candidate.artist));
  if (!raw) return 0;
  // Internet Archive elenca più nomi in un campo solo ("Sula Levitch, Debussy,
  // Arr. …"): conta il migliore, non la media di tutti.
  var options = [raw];
  var parts = raw.split(/\s*[,;]\s*/);
  for (var p = 0; p < parts.length; p++) {
    if (trim(parts[p])) options.push(trim(parts[p]));
  }
  var wanted = [];
  if (track.artists && track.artists.length) {
    for (var i = 0; i < track.artists.length; i++) wanted.push(track.artists[i]);
  }
  if (track.artist) wanted.push(track.artist);
  var best = 0;
  for (var o = 0; o < options.length; o++) {
    var got = norm(options[o]);
    if (!got) continue;
    for (var j = 0; j < wanted.length; j++) {
      var n = norm(wanted[j]);
      if (!n) continue;
      var s = 0;
      if (n === got) s = 30;
      else if (got.indexOf(n) >= 0 || n.indexOf(got) >= 0) s = 24;
      else s = Math.round(22 * overlap(n, got));
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Internet Archive non dichiara l'artista e mette tutto nel titolo
 * ("Glenn Miller - In the Mood", "Für Elise - Wilhelm Kempff"): si prova anche
 * a spezzare il titolo sul trattino e a scambiarne le due parti.
 */
function splitTitle(candidate) {
  var title = String(candidate.title == null ? '' : candidate.title);
  var at = title.indexOf(' - ');
  if (at < 0) return null;
  return { left: trim(title.slice(0, at)), right: trim(title.slice(at + 3)) };
}

/** Il candidato "raddrizzato": artista preso dal titolo quando manca. */
function variantsOf(candidate) {
  var out = [candidate];
  var missingArtist = !trim(candidate.artist);
  if (missingArtist) {
    var parts = splitTitle(candidate);
    if (parts) {
      out.push({ item: null, title: parts.right, artist: parts.left, album: candidate.album, duration: candidate.duration, audioQuality: candidate.audioQuality, id: candidate.id, source: candidate.source, swapped: true });
      out.push({ item: null, title: parts.left, artist: parts.right, album: candidate.album, duration: candidate.duration, audioQuality: candidate.audioQuality, id: candidate.id, source: candidate.source, swapped: true });
    }
  }
  return out;
}

/**
 * Quanto il titolo più corto è contenuto nell'altro: 0 … 1. Serve per fidarsi
 * dei candidati di Internet Archive, che non dichiarano artista né album.
 */
function titleCoverage(candidate, track) {
  var a = tokensOf(norm(track && track.title));
  var b = tokensOf(norm(candidate && candidate.title));
  if (!a.length || !b.length) return 0;
  var small = a.length <= b.length ? a : b;
  var big = a.length <= b.length ? b : a;
  var hit = 0;
  for (var i = 0; i < small.length; i++) {
    if (indexOf(big, small[i]) >= 0) hit++;
  }
  return hit / small.length;
}

/** 0, 8 o 12: quanto l'album del candidato somiglia a quello del brano. */
function albumScore(candidate, track) {
  var want = norm(track.album);
  var got = norm(candidate.album);
  if (!want || !got) return 0;
  if (want === got) return 12;
  if (want.indexOf(got) >= 0 || got.indexOf(want) >= 0) return 8;
  return 0;
}

/** "24-bit / 96 kHz" -> 24 (0 se non lo dice). */
function bitDepthOf(candidate) {
  var m = /(\d{1,2})\s*-\s*bit/i.exec(String(candidate.audioQuality || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/** "24-bit / 96 kHz" -> 96000 (0 se non lo dice). */
function sampleRateOf(candidate) {
  var m = /\/\s*([\d.]+)\s*kHz/i.exec(String(candidate.audioQuality || ''));
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * 1000);
}

/**
 * Valuta un candidato: null se non è lo stesso brano, altrimenti
 * { item, score, hiRes }. Regole d'accettazione, dalla più sicura:
 *   1. ISRC identico;
 *   2. titolo e artista buoni, durata nella tolleranza;
 *   3. titolo molto buono e artista localizzato (album o durata quasi uguale);
 *   4. album identico e durata quasi uguale, con titolo o artista localizzati;
 *   5. album identico, titolo e artista discreti.
 * Fuori da queste, meglio Spotify che la canzone sbagliata.
 */
function evaluate(rawCandidate, track, hiResBias) {
  if (!rawCandidate || rawCandidate.id === undefined || rawCandidate.id === null) return null;
  var variants = variantsOf(rawCandidate);
  var best = null;
  for (var vi = 0; vi < variants.length; vi++) {
    var ev = evaluateOne(variants[vi], track, hiResBias);
    if (ev && (!best || ev.score > best.score)) best = ev;
  }
  return best;
}

function evaluateOne(c, track, hiResBias) {
  var wantIsrc = isrcOf(track);
  var isrcMatched = !!(wantIsrc && c.isrc && String(c.isrc).toLowerCase() === wantIsrc);

  var t = titleScore(c, track);
  var a = artistScore(c, track);
  var alb = albumScore(c, track);
  var delta = durationDelta(c, track);
  var ok = durationOk(c, track);
  var foreign = isForeign(c.title) || isForeign(c.artist);

  var accept = false;
  // Internet Archive: un'altra esecuzione della stessa opera va bene (le durate
  // non coincidono quasi mai), purché titolo e artista siano buoni.
  var loose = providerOf(c.id) === 'ia' && acceptOtherPerformances() &&
    t >= 40 && a >= 12;
  if (isrcMatched) accept = true;
  else if (loose) accept = true;
  else if (!ok) accept = false;
  else if (t >= 30 && a >= 20) accept = true;
  else if (t >= 46 && a >= 8) accept = true;
  else if (t >= 46 && foreign && alb >= 8 && delta <= 2.5) accept = true;
  else if (alb >= 12 && delta <= 2 && foreign) accept = true;
  else if (alb >= 12 && t >= 34 && a >= 8) accept = true;
  // Internet Archive non dichiara artista né album: si accetta solo un titolo
  // quasi identico (almeno due parole nel titolo di Spotify), senza metadati
  // che contraddicano. La guardia sul nome del file controlla il resto.
  else if (t >= 46 && titleCoverage(c, track) >= 0.75 &&
           tokensOf(norm(track.title)).length >= 2 &&
           (!trim(c.artist) || a >= 8) && (!trim(c.album) || alb >= 8)) accept = true;
  if (!accept) return null;

  var hiRes = bitDepthOf(c) >= 24;
  var score = t + a + durationScore(c, track) + alb;
  // Il 24-bit è un tie-breaker, non un motivo per scegliere un'altra edizione.
  if (hiRes) score += (hiResBias === undefined ? (preferHiRes() ? 6 : 0) : hiResBias);
  if (isrcMatched) score += 100;
  return { item: c, score: score, hiRes: hiRes, isrcMatched: isrcMatched };
}

/** I candidati accettati per una ricerca, dal punteggio più alto. */
function rankCandidates(list, track, hiResBias) {
  var out = [];
  if (!list || !list.length) return out;
  for (var i = 0; i < list.length; i++) {
    var ev = evaluate(list[i], track, hiResBias);
    if (ev) out.push(ev);
  }
  out.sort(function (x, y) { return y.score - x.score; });
  return out;
}

/* ------------------------------------------------------------------ */
/* Relay Qobuz: più servizi, tre forme di API                          */
/* ------------------------------------------------------------------ */

/** Il relay si usa? (spento, l'estensione prova solo Qobuz diretto e Archivio) */
function relayEnabled() {
  var v = setting('relayEnabled', true);
  return v !== false && String(v) !== 'false';
}

/*
 * I servizi conosciuti, nell'ordine in cui si provano. `shape` dice come
 * parlano:
 *   arcod       /api/search            + /api/player/stream/<id>?quality=
 *   qobuzdl     /api/get-music         + /api/download-music?track_id=
 *   monochrome  /search/tracks         + il file direttamente su /track/<id>
 * Sono gli stessi servizi elencati dall'estensione Echo Music
 * (EchoMusicApp/lossless-extension) e da quella di TheWinner02: qui restano
 * solo quelli che rispondono davvero.
 */
var RELAY_SOURCES = [
  { key: 'arcod', base: 'https://arcod.xyz', shape: 'arcod' },
  { key: 'instable', base: 'https://instable.arcod.xyz', shape: 'arcod' },
  { key: 'qobuz-dl', base: 'https://qobuz-dll.foreyou.workers.dev', shape: 'qobuzdl' },
  { key: 'monochrome', base: 'https://tracks.monochrome.st', shape: 'monochrome' }
];

/**
 * I servizi da usare: quelli scritti nelle impostazioni, altrimenti i predefiniti.
 * Un indirizzo scritto a mano parla la forma `auto`: si prova prima /api/search,
 * poi /api/get-music, poi /search/tracks.
 */
function relaySources() {
  var raw = trim(String(setting('relayApi', '') || ''));
  var out = [];
  if (!raw) {
    for (var i = 0; i < RELAY_SOURCES.length; i++) {
      out.push({ key: RELAY_SOURCES[i].key, base: RELAY_SOURCES[i].base, shape: RELAY_SOURCES[i].shape });
    }
    return out;
  }
  var parts = raw.split(/[\s,;]+/);
  for (var p = 0; p < parts.length; p++) {
    var b = trim(parts[p]);
    if (!b) continue;
    // `mono:https://…` dice che quel servizio parla la forma monochrome
    // (ricerca su /search/tracks, file direttamente su /track/<id>).
    var shape = 'auto';
    if (/^mono:/i.test(b)) {
      shape = 'monochrome';
      b = b.replace(/^mono:/i, '');
    }
    if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
    b = b.replace(/\/+$/, '');
    var key = shape === 'monochrome' ? 'monochrome' : 'custom:' + b;
    var dup = false;
    for (var d = 0; d < out.length; d++) {
      if (out[d].base === b) dup = true;
    }
    if (!dup) out.push({ key: key, base: b, shape: shape });
  }
  return out;
}

/** Solo gli indirizzi, per i messaggi. */
function relayBases() {
  var srcs = relaySources();
  var out = [];
  for (var i = 0; i < srcs.length; i++) out.push(srcs[i].base);
  return out;
}

/** Lo stato del relay in storage: limiti, servizi che funzionano, forma di API. */
function relayState() {
  var st = myspoti.storage.get('relay_state');
  return (st && typeof st === 'object') ? st : {};
}

function relaySave(st) {
  try {
    myspoti.storage.set('relay_state', st);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

/** Vero se questo indirizzo ha appena risposto "troppe richieste". */
function relayLimited(base) {
  var st = relayState();
  var until = st.limited && st.limited[base] ? st.limited[base] : 0;
  return until > now();
}

/** Ricorda un 429: il servizio dice da sé quanto aspettare. */
function relayNoteLimit(base, status, body) {
  if (status !== 429) return;
  var st = relayState();
  st.limited = st.limited || {};
  var wait = body && body.retryAfterSeconds ? parseInt(body.retryAfterSeconds, 10) : 60;
  if (!wait || wait < 5) wait = 60;
  st.limited[base] = now() + Math.min(wait, 600) * 1000;
  relaySave(st);
  myspoti.log('relay ' + base.replace(/^https?:\/\//, '') + ': troppe richieste, si aspetta ' + wait + ' s');
}

/** Ricorda che questo indirizzo ha servito un file (o una ricerca). */
function relayNoteOk(base) {
  var st = relayState();
  st.ok = st.ok || {};
  st.ok[base] = now();
  if (st.bad && st.bad[base]) delete st.bad[base];
  relaySave(st);
}

/** Vero se questo indirizzo ha appena taciuto del tutto (rete, DNS, timeout). */
function relayRecentlyBad(base) {
  var st = relayState();
  var at = st.bad && st.bad[base] ? st.bad[base] : 0;
  return at > 0 && now() - at < 10 * 60000;
}

/** Ricorda che questo indirizzo non ha risposto (rete, 5xx): per un po' va in fondo. */
function relayNoteBad(base) {
  var st = relayState();
  st.bad = st.bad || {};
  st.bad[base] = now();
  relaySave(st);
}

/** La forma di API che ha funzionato l'ultima volta ('arcod' o 'kenny'). */
function relayShape() {
  var st = relayState();
  return st.shape === 'kenny' ? 'kenny' : 'arcod';
}

function relayRememberShape(shape) {
  var st = relayState();
  if (st.shape === shape) return;
  st.shape = shape;
  relaySave(st);
}

/**
 * I servizi in ordine di tentativo: prima quello preferito (l'id viene da lì),
 * poi quelli che hanno funzionato da poco, poi quelli mai provati, infine quelli
 * che hanno appena fallito.
 */
function relayOrder(preferKey) {
  var st = relayState();
  var srcs = relaySources();
  var copy = [];
  for (var i = 0; i < srcs.length; i++) {
    var src = srcs[i];
    var okAt = st.ok && st.ok[src.base] ? st.ok[src.base] : 0;
    var badAt = st.bad && st.bad[src.base] ? st.bad[src.base] : 0;
    var tier = 1;
    if (preferKey && src.key === preferKey) tier = 0;
    else if (okAt && now() - okAt < 30 * 60000) tier = 0;
    else if (badAt && now() - badAt < 10 * 60000) tier = 2;
    copy.push({ key: src.key, base: src.base, shape: src.shape, _o: tier * 100 + i });
  }
  copy.sort(function (a, b) { return a._o - b._o; });
  for (var j = 0; j < copy.length; j++) delete copy[j]._o;
  return copy;
}

/**
 * Quante richieste al relay sono rimaste a questa chiamata. Myspoti concede 120
 * richieste al minuto a tutta l'estensione: senza un tetto un servizio morto ne
 * brucerebbe una ventina per brano, fra indirizzi, rotte e qualità.
 */
var relayTriesLeft = 0;

function relayBudget(n) {
  relayTriesLeft = n;
}

/** Una chiamata a un indirizzo preciso del relay: { status, body } o null. */
function relayAt(base, path, timeoutMs) {
  if (leftMs() < 1200) return null;
  if (relayTriesLeft <= 0) return null;
  relayTriesLeft--;
  var raw = httpRaw(base + path, Math.min(timeoutMs || 6000, Math.max(1500, leftMs() - 500)));
  if (!raw || !raw.body) return null;
  var body = null;
  try {
    body = JSON.parse(raw.body);
  } catch (e) {
    body = null;
  }
  if (!body) {
    myspoti.log('relay ' + base.replace(/^https?:\/\//, '') + path.split('?')[0] +
      ': risposta non JSON (' + raw.status + ')');
    relayNoteLimit(base, raw.status, null);
    return { status: raw.status, body: null };
  }
  relayNoteLimit(base, raw.status, body);
  return { status: raw.status, body: body };
}

/** Le tracce dentro una risposta: {data:{tracks:{items:[…]}}} oppure {tracks:[…]}. */
function relayTrackItems(body) {
  if (!body) return [];
  var data = body.data && typeof body.data === 'object' ? body.data : body;
  var tracks = data.tracks || (body.tracks ? body.tracks : null);
  if (!tracks) return [];
  if (tracks.items) return tracks.items;
  return tracks.length ? tracks : [];
}

/** Le vie di ricerca di un servizio, nella forma che parla. */
function relaySearchPaths(src, q) {
  var arcod = ['/api/search?q=' + q + '&limit=20'];
  var qobuzdl = ['/api/get-music?q=' + q + '&limit=20&offset=0'];
  var mono = ['/search/tracks?q=' + q + '&limit=10'];
  if (src.shape === 'arcod') return arcod.concat(qobuzdl);
  if (src.shape === 'qobuzdl') return qobuzdl.concat(arcod);
  if (src.shape === 'monochrome') return mono;
  return relayShape() === 'kenny' ? qobuzdl.concat(arcod, mono) : arcod.concat(qobuzdl, mono);
}

/** Le vie del file di un servizio. */
function relayStreamPaths(src, trackId, quality) {
  var id = encodeURIComponent(trackId);
  var arcs = [
    '/api/player/stream/' + id + '?quality=' + quality,
    '/api/download-music?track_id=' + id + '&quality=' + quality,
    '/api/stream/' + id + '?quality=' + quality
  ];
  var qds = [
    '/api/download-music?track_id=' + id + '&quality=' + quality,
    '/api/player/stream/' + id + '?quality=' + quality
  ];
  if (src.shape === 'arcod') return arcs;
  if (src.shape === 'qobuzdl') return qds;
  if (src.shape === 'monochrome') return ['/track/' + id];
  return arcs.concat(qds);
}

/** Una risposta del relay nella forma dei candidati (id con prefisso `rl:`). */
function relayNormalize(body, src) {
  var arr = relayTrackItems(body);
  if (!arr.length && body && body.tracks && body.tracks.length) arr = body.tracks;
  if (!arr.length && body && body.data && body.data.tracks && body.data.tracks.length) arr = body.data.tracks;
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var t = arr[i];
    if (!t || t.id === undefined || t.id === null) continue;
    var title = String(t.title == null ? '' : t.title);
    if (t.version) title += ' (' + t.version + ')';
    var artist = '';
    if (t.performer && t.performer.name) artist = String(t.performer.name);
    else if (t.artist && t.artist.name) artist = String(t.artist.name);
    else if (typeof t.artist === 'string') artist = t.artist;
    else if (t.artistNames && t.artistNames.length) artist = t.artistNames.join(', ');
    var album = t.album && t.album.title ? String(t.album.title) : (typeof t.album === 'string' ? t.album : '');
    var dur = t.duration;
    if (typeof dur === 'number' && dur > 3600) dur = Math.round(dur / 1000); // millisecondi
    var depth = t.maximum_bit_depth || 0;
    var rate = t.maximum_sampling_rate || 0;
    out.push({
      id: RELAY_PREFIX + t.id,
      title: trim(title),
      artist: artist,
      album: album,
      duration: dur,
      isrc: t.isrc || '',
      audioQuality: depth ? (depth + '-bit / ' + rate + ' kHz') : '',
      hires: !!t.hires,
      sourceKey: src.key,
      source: 'Qobuz (relay)'
    });
  }
  return out;
}

/**
 * Le tracce cercate nei servizi del relay, in ordine: il primo che risponde
 * vince. Ogni ricerca in più costa (arcod ne concede quattordici al minuto),
 * quindi si smette appena un servizio dà dei risultati.
 */
function relaySearchTracks(query) {
  if (!trim(query)) return [];
  if (!relayEnabled()) return [];
  var q = encodeURIComponent(query);
  relayBudget(4);
  var srcs = relayOrder('');
  for (var s = 0; s < srcs.length; s++) {
    var src = srcs[s];
    if (relayLimited(src.base)) continue;
    // Un servizio che poco fa non ha risposto affatto non si richiama per dieci
    // minuti: senza questa riga un host morto costerebbe un timeout a ogni brano.
    if (relayRecentlyBad(src.base)) continue;
    var paths = relaySearchPaths(src, q);
    var answered = false;
    for (var p = 0; p < paths.length; p++) {
      if (leftMs() < 1500) return [];
      var res = relayAt(src.base, paths[p], src.shape === 'monochrome' ? 3000 : 6000);
      if (!res) continue;
      answered = true;
      var items = relayNormalize(res.body, src);
      if (items.length) {
        relayNoteOk(src.base);
        relayRememberShape(/get-music/.test(paths[p]) ? 'kenny' : 'arcod');
        return items;
      }
      if (res.status >= 200 && res.status < 300) break; // risposta valida ma vuota
    }
    if (!answered && !relayLimited(src.base)) relayNoteBad(src.base);
    if (leftMs() < 1500) break;
  }
  return [];
}

/** L'indirizzo del file dentro una risposta del relay, se c'è. */
function relayUrlOf(body) {
  if (!body) return '';
  var data = body.data && typeof body.data === 'object' ? body.data : body;
  var url = data.url || data.streamUrl || data.downloadUrl || body.url;
  if (typeof url !== 'string') return '';
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * L'URL del FLAC per un id Qobuz: si prova prima il servizio da cui viene l'id,
 * poi gli altri che parlano la stessa lingua dell'id (gli id Qobuz valgono per
 * arcod, instable e Qobuz-DL; quelli di monochrome solo per monochrome), con
 * l'hi-res e poi il 16-bit.
 */
function relayStreamUrl(trackId, wantHiRes, srcKey) {
  var qualities = wantHiRes ? [FORMAT_HI, FORMAT_CD] : [FORMAT_CD, FORMAT_HI];
  relayBudget(6);
  var srcs = relayOrder(srcKey || '');
  var lastStatus = 0;
  for (var s = 0; s < srcs.length; s++) {
    var src = srcs[s];
    // Il tetto di richieste vale per le ricerche, non per i file: qui si prova
    // sempre, anche se poco fa una ricerca è stata respinta.
    // Un id di monochrome non vale per gli altri servizi, e viceversa.
    if (srcKey === 'monochrome' && src.key !== 'monochrome') continue;
    if (srcKey !== 'monochrome' && src.shape === 'monochrome') continue;
    if (src.shape === 'monochrome') {
      return {
        url: src.base + '/track/' + encodeURIComponent(trackId),
        quality: qualities[0],
        base: src.base,
        status: 200,
        direct: true
      };
    }
    var answered = false;
    for (var q = 0; q < qualities.length; q++) {
      var paths = relayStreamPaths(src, trackId, qualities[q]);
      for (var p = 0; p < paths.length; p++) {
        if (leftMs() < 1500) return { status: lastStatus };
        var res = relayAt(src.base, paths[p], 6000);
        if (!res) continue;
        answered = true;
        lastStatus = res.status;
        var url = relayUrlOf(res.body);
        if (url) {
          relayNoteOk(src.base);
          return { url: url, quality: qualities[q], base: src.base, status: res.status };
        }
      }
    }
    // Nessuna risposta affatto: il servizio è giù, per un po' si prova dopo gli altri.
    if (!answered) relayNoteBad(src.base);
  }
  if (lastStatus) myspoti.log('relay ' + trackId + ': HTTP ' + lastStatus);
  return { status: lastStatus };
}

/**
 * La risposta del relay per un id: l'URL, più la qualità dichiarata dal catalogo
 * (quella del file la decide il servizio: chiedendo il 24-bit su un album 16-bit
 * torna il 16-bit, quindi non si promette nulla che non sia nel catalogo).
 */
function relayAnswer(trackId, wantHiRes, qualityText, wantSize, srcKey) {
  var got = relayStreamUrl(trackId, wantHiRes, srcKey);
  if (!got || !got.url) {
    var why = got && got.status ? got.status : 0;
    return { ok: false, reason: (why === 404 || why === 400) ? 'no-audio' : 'error' };
  }
  // La qualità si prende dal catalogo; senza quel dato si dice solo quello che
  // è certo (il 16/44.1 quando si è chiesto il CD), mai un 24-bit inventato.
  var depth = bitDepthOf({ audioQuality: qualityText });
  var rate = sampleRateOf({ audioQuality: qualityText });
  if (!depth && got.quality === FORMAT_CD) {
    depth = 16;
    rate = 44100;
  }
  var size = wantSize ? sizeOf(got.url) : 0;
  myspoti.log('relay ' + trackId + ': FLAC da ' + got.base.replace(/^https?:\/\//, '') +
    ' (' + (depth ? depth + '-bit / ' + Math.round(rate / 1000) + ' kHz' : 'qualità dichiarata dal catalogo') +
    ')' + (size ? ', ' + Math.round(size / 1048576) + ' MB' : ''));
  return {
    ok: true,
    answer: {
      url: got.url,
      format: 'flac',
      codec: 'flac',
      bitDepth: depth,
      sampleRate: rate,
      size: size,
      source: depth ? '' : 'FLAC · Qobuz (relay)',
      expiresAt: now() + RELAY_TTL_MS,
      at: now(),
      isrcMatched: false
    }
  };
}

/* ------------------------------------------------------------------ */
/* Internet Archive, diretto                                           */
/* ------------------------------------------------------------------ */

/**
 * La ricerca pubblica di archive.org (advancedsearch.php, nessuna chiave).
 * Si chiedono solo item audio; il formato FLAC si controlla dopo, nei metadati,
 * perché il campo "format" della ricerca è inaffidabile.
 */
/** L'indirizzo di archive.org (modificabile per i test o per uno specchio). */
function iaBase() {
  var v = trim(String(setting('iaApi', '') || ''));
  return v ? v.replace(/\/+$/, '') : IA;
}

function iaQuery(text) {
  // Solo item che contengono davvero FLAC: senza questo filtro l'archivio
  // restituisce soprattutto MP3 e la ricerca si riempie di items inutili.
  var q = 'title:(' + text + ') AND mediatype:(audio) AND format:(FLAC)';
  var url = iaBase() + '/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year' +
    '&rows=' + IA_ITEMS + '&page=1&output=json';
  var j = httpJson(url, 5000);
  var docs = j && j.response && j.response.docs ? j.response.docs : null;
  return docs || [];
}

/** I metadati di un item (file compresi), con cache: 14 giorni, 200 item. */
function iaMeta(identifier) {
  var all = myspoti.storage.get(IA_META_KEY);
  if (!all || typeof all !== 'object') all = {};
  var kept = all[identifier];
  if (kept && kept.at && (now() - kept.at) < IA_META_TTL_MS) return kept;

  var j = httpJson(iaBase() + '/metadata/' + encodeURIComponent(identifier), 5000);
  if (!j || !j.files) return null;
  var files = [];
  for (var i = 0; i < j.files.length; i++) {
    var f = j.files[i];
    var name = String(f.name || '');
    if (!/\.flac$/i.test(name)) continue;
    // "length" può essere "196.23" oppure "3:16"; "size" è in byte
    var seconds = parseLength(f.length);
    var size = parseInt(f.size, 10) || 0;
    files.push({ name: name, seconds: seconds, size: size, title: String(f.title || '') });
  }
  if (!files.length) return null;
  files.sort(function (x, y) { return (y.size || 0) - (x.size || 0); });
  var meta = {
    identifier: identifier,
    title: String((j.metadata && j.metadata.title) || ''),
    creator: creatorsOf(j.metadata && j.metadata.creator),
    files: files.slice(0, 40),
    at: now()
  };
  all[identifier] = meta;
  var keys = [];
  for (var k in all) if (all.hasOwnProperty(k)) keys.push(k);
  if (keys.length > 200) {
    keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
    for (var d = 0; d < keys.length - 200; d++) delete all[keys[d]];
  }
  try {
    myspoti.storage.set(IA_META_KEY, all);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
  return meta;
}

/** "196.23" o "3:16" o "1:02:03" -> secondi (0 se non si capisce). */
function parseLength(v) {
  if (v === undefined || v === null) return 0;
  var t = String(v).trim();
  if (!t) return 0;
  if (t.indexOf(':') < 0) {
    var n = parseFloat(t);
    return n > 0 ? n : 0;
  }
  var parts = t.split(':');
  var secs = 0;
  for (var i = 0; i < parts.length; i++) secs = secs * 60 + (parseFloat(parts[i]) || 0);
  return secs;
}

/** Il campo creator può essere testo, lista o oggetto: si riduce a una stringa. */
function creatorsOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 120);
  if (v.length !== undefined) {
    var out = [];
    for (var i = 0; i < v.length && i < 4; i++) if (v[i]) out.push(String(v[i]));
    return out.join(', ').slice(0, 160);
  }
  return String(v.name || v.value || '').slice(0, 120);
}

/**
 * Il file giusto dentro un item: nome che somiglia al titolo del brano e durata
 * compatibile. Se l'item ha un solo FLAC si prende quello.
 */
/**
 * I file "a tracce separate" (stem, multitrack) non sono il brano: sono una
 * parte di esso. L'Archivio ne ha parecchi ("… Stems/Drums.flac") e senza
 * questa guardia si finirebbe per suonare solo la batteria.
 */
function isStemName(name) {
  var n = norm(String(name || '').replace(/\.[a-z0-9]+$/i, ''));
  if (!n) return false;
  if (/\bstems?\b|multitrack|isolated|acapella|instrumental only/.test(n)) return true;
  return /^(drums?|bass|vocals?|voice|other|piano|guitars?|synth|percussion|keys|lead|backing|strings|brass|fx)$/.test(n);
}

function bestIaFile(meta, track) {
  if (!meta || !meta.files.length) return null;
  if (meta.files.length === 1) return meta.files[0];
  var want = trackDurationSec(track);
  var tol = toleranceSec();
  var fallback = null;
  for (var i = 0; i < meta.files.length; i++) {
    var f = meta.files[i];
    if (isStemName(f.name)) continue;
    var nameOk = fileLooksRight(iaBase() + '/download/x/' + encodeURIComponent(f.name), track);
    var durOk = !want || !f.seconds || Math.abs(f.seconds - want) <= Math.max(tol, 8);
    if (nameOk && durOk) return f;
    if (nameOk && !fallback) fallback = f;
  }
  return fallback;
}

/** I candidati di Internet Archive per un brano. */
function iaCandidates(track) {
  var queries = [];
  var clean = cleanTitle(track.title);
  if (clean) queries.push(clean);
  if (track.artist && clean) queries.push(clean + ' ' + track.artist);
  var out = [];
  var seen = {};
  // L'archivio ordina per rilevanza e non è detto che il primo item contenga il
  // brano: se i candidati della prima ricerca non passano le regole si prova la
  // seconda (titolo + artista), che spesso pesca un'incisione diversa.
  for (var q = 0; q < queries.length; q++) {
    if (nearDeadline(5000, 0.3)) break;
    var docs = iaQuery(queries[q]);
    for (var d = 0; d < docs.length && d < 6; d++) {
      if (nearDeadline(3000, 0.2) || out.length >= 4) break;
      var identifier = String(docs[d].identifier || '');
      if (!identifier || seen[identifier]) continue;
      if (/stem|multitrack|isolated tracks/i.test(identifier + ' ' + String(docs[d].title || ''))) continue;
      seen[identifier] = true;
      var meta = iaMeta(identifier);
      if (!meta) continue;
      var file = bestIaFile(meta, track);
      if (!file) continue;
      out.push({
        id: IA_PREFIX + identifier + '/' + file.name,
        title: trim(String(docs[d].title || meta.title || identifier)),
        artist: creatorsOf(docs[d].creator) || meta.creator,
        album: '',
        duration: Math.round(file.seconds) || undefined,
        audioQuality: 'FLAC',
        hires: 0,
        source: 'Internet Archive'
      });
    }
    var usable = false;
    for (var u = 0; u < out.length; u++) {
      if (evaluate(out[u], track)) { usable = true; break; }
    }
    if (usable) break;
  }
  return out;
}

/** L'URL del file di un id ia:<item>/<file>. */
function iaAnswer(id) {
  var rest = String(id).slice(3);
  var cut = rest.indexOf('/');
  if (cut <= 0) return { ok: false, reason: 'error' };
  var identifier = rest.slice(0, cut);
  var name = rest.slice(cut + 1);
  var parts = name.split('/');
  var url = iaBase() + '/download/' + encodeURIComponent(identifier) + '/';
  for (var i = 0; i < parts.length; i++) {
    if (i) url += '/';
    url += encodeURIComponent(parts[i]).replace(/%2F/g, '/');
  }
  // La dimensione dal metadata è già nota: niente HEAD in più.
  var meta = iaMeta(identifier);
  var size = 0;
  if (meta) {
    for (var k = 0; k < meta.files.length; k++) {
      if (meta.files[k].name === name) size = meta.files[k].size;
    }
  }
  return {
    ok: true,
    answer: {
      url: url,
      format: 'flac',
      codec: 'flac',
      bitDepth: 0,
      sampleRate: 0,
      size: size,
      source: 'FLAC · Internet Archive',
      expiresAt: 0,
      at: now(),
      isrcMatched: false
    }
  };
}

/**
 * Le tracce del catalogo Qobuz per una ricerca, chieste all'API ufficiale.
 * Il relay si interroga a parte, una volta sola, in findCandidates.
 */
function searchTracks(query) {
  if (!qobuzEnabled()) return [];
  return qobuzSearchTracks(query);
}

/** La parte numerica di un id: "qz:9140031" e "rl:9140031" sono lo stesso brano. */
function numericId(id) {
  var m = /^[a-z]{1,8}:(\d+)/.exec(String(id || ''));
  return m ? m[1] : '';
}

/**
 * Il titolo senza le code di versione: "Bohemian Rhapsody - Remastered 2011"
 * -> "Bohemian Rhapsody", "Get Lucky (feat. …)" -> "Get Lucky". Cambia molto:
 * il servizio risponde con edizioni diverse a seconda di come si cerca.
 */
function cleanTitle(title) {
  var out = String(title == null ? '' : title);
  out = out.replace(/\s*\((?:feat|ft|featuring|with|con|remaster(?:ed)?|deluxe|bonus|live|version|edit|mix)[^)]*\)/gi, '');
  out = out.replace(/\s*\[(?:feat|ft|featuring|with|con|remaster(?:ed)?|deluxe|bonus|live)[^\]]*\]/gi, '');
  out = out.replace(/\s+-\s+.*$/, '');
  out = out.replace(/\s+(?:feat|ft|featuring)\.?\s+.*$/i, '');
  return trim(out) || trim(title);
}

/** Le ricerche da provare, dalla più precisa alla più larga (senza doppioni). */
function queriesFor(track) {
  var title = track.title;
  var clean = cleanTitle(title);
  var artist = track.artist;
  var out = [];
  var seen = {};

  function add(q) {
    var t = trim(q);
    if (!t || seen[t]) return;
    seen[t] = true;
    out.push(t);
  }

  if (artist && clean) add(artist + ' ' + clean);
  if (artist && title) add(artist + ' ' + title);
  if (clean && artist) add(clean + ' ' + artist);
  if (clean && track.album) add(clean + ' ' + track.album);
  if (clean) add(clean);
  if (title) add(title);
  return out;
}

/* ------------------------------------------------------------------ */
/* Qobuz: pool di token condivisi                                      */
/* ------------------------------------------------------------------ */

/* MD5 in JavaScript puro, solo per stringhe ASCII (le firme di Qobuz). */
function md5hex(input) {
  function toBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }
  function add32(a, b) { return (a + b) & 0xffffffff; }
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

  var bytes = toBytes(input);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var lo = bitLen & 0xffffffff;
  var hi = Math.floor(bitLen / 4294967296) & 0xffffffff;
  for (var b = 0; b < 4; b++) bytes.push((lo >>> (8 * b)) & 0xff);
  for (var b2 = 0; b2 < 4; b2++) bytes.push((hi >>> (8 * b2)) & 0xff);

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var i = 0; i < bytes.length; i += 64) {
    var x = [];
    for (var j = 0; j < 16; j++) {
      x.push(bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24));
    }
    var a = a0, bb = b0, c = c0, d = d0;
    a = ff(a, bb, c, d, x[0], 7, -680876936); d = ff(d, a, bb, c, x[1], 12, -389564586);
    c = ff(c, d, a, bb, x[2], 17, 606105819); bb = ff(bb, c, d, a, x[3], 22, -1044525330);
    a = ff(a, bb, c, d, x[4], 7, -176418897); d = ff(d, a, bb, c, x[5], 12, 1200080426);
    c = ff(c, d, a, bb, x[6], 17, -1473231341); bb = ff(bb, c, d, a, x[7], 22, -45705983);
    a = ff(a, bb, c, d, x[8], 7, 1770035416); d = ff(d, a, bb, c, x[9], 12, -1958414417);
    c = ff(c, d, a, bb, x[10], 17, -42063); bb = ff(bb, c, d, a, x[11], 22, -1990404162);
    a = ff(a, bb, c, d, x[12], 7, 1804603682); d = ff(d, a, bb, c, x[13], 12, -40341101);
    c = ff(c, d, a, bb, x[14], 17, -1502002290); bb = ff(bb, c, d, a, x[15], 22, 1236535329);
    a = gg(a, bb, c, d, x[1], 5, -165796510); d = gg(d, a, bb, c, x[6], 9, -1069501632);
    c = gg(c, d, a, bb, x[11], 14, 643717713); bb = gg(bb, c, d, a, x[0], 20, -373897302);
    a = gg(a, bb, c, d, x[5], 5, -701558691); d = gg(d, a, bb, c, x[10], 9, 38016083);
    c = gg(c, d, a, bb, x[15], 14, -660478335); bb = gg(bb, c, d, a, x[4], 20, -405537848);
    a = gg(a, bb, c, d, x[9], 5, 568446438); d = gg(d, a, bb, c, x[14], 9, -1019803690);
    c = gg(c, d, a, bb, x[3], 14, -187363961); bb = gg(bb, c, d, a, x[8], 20, 1163531501);
    a = gg(a, bb, c, d, x[13], 5, -1444681467); d = gg(d, a, bb, c, x[2], 9, -51403784);
    c = gg(c, d, a, bb, x[7], 14, 1735328473); bb = gg(bb, c, d, a, x[12], 20, -1926607734);
    a = hh(a, bb, c, d, x[5], 4, -378558); d = hh(d, a, bb, c, x[8], 11, -2022574463);
    c = hh(c, d, a, bb, x[11], 16, 1839030562); bb = hh(bb, c, d, a, x[14], 23, -35309556);
    a = hh(a, bb, c, d, x[1], 4, -1530992060); d = hh(d, a, bb, c, x[4], 11, 1272893353);
    c = hh(c, d, a, bb, x[7], 16, -155497632); bb = hh(bb, c, d, a, x[10], 23, -1094730640);
    a = hh(a, bb, c, d, x[13], 4, 681279174); d = hh(d, a, bb, c, x[0], 11, -358537222);
    c = hh(c, d, a, bb, x[3], 16, -722521979); bb = hh(bb, c, d, a, x[6], 23, 76029189);
    a = hh(a, bb, c, d, x[9], 4, -640364487); d = hh(d, a, bb, c, x[12], 11, -421815835);
    c = hh(c, d, a, bb, x[15], 16, 530742520); bb = hh(bb, c, d, a, x[2], 23, -995338651);
    a = ii(a, bb, c, d, x[0], 6, -198630844); d = ii(d, a, bb, c, x[7], 10, 1126891415);
    c = ii(c, d, a, bb, x[14], 15, -1416354905); bb = ii(bb, c, d, a, x[5], 21, -57434055);
    a = ii(a, bb, c, d, x[12], 6, 1700485571); d = ii(d, a, bb, c, x[3], 10, -1894986606);
    c = ii(c, d, a, bb, x[10], 15, -1051523); bb = ii(bb, c, d, a, x[1], 21, -2054922799);
    a = ii(a, bb, c, d, x[8], 6, 1873313359); d = ii(d, a, bb, c, x[15], 10, -30611744);
    c = ii(c, d, a, bb, x[6], 15, -1560198380); bb = ii(bb, c, d, a, x[13], 21, 1309151649);
    a = ii(a, bb, c, d, x[4], 6, -145523070); d = ii(d, a, bb, c, x[11], 10, -1120210379);
    c = ii(c, d, a, bb, x[2], 15, 718787259); bb = ii(bb, c, d, a, x[9], 21, -343485551);
    a0 = add32(a0, a); b0 = add32(b0, bb); c0 = add32(c0, c); d0 = add32(d0, d);
  }
  function word(n) {
    var s = '';
    for (var i = 0; i < 4; i++) {
      var byte = (n >>> (8 * i)) & 0xff;
      s += ('0' + byte.toString(16)).slice(-2);
    }
    return s;
  }
  return word(a0) + word(b0) + word(c0) + word(d0);
}

/**
 * La firma che Qobuz vuole per getFileUrl: md5 della concatenazione
 * "trackgetFileUrl" + "format_id<N>" + "intentstream" + "track_id<ID>" +
 * timestamp + app_secret. Senza firma l'API risponde 400.
 */
function qobuzSign(ts, trackId, formatId, appSecret) {
  return md5hex('trackgetFileUrl' + 'format_id' + formatId + 'intentstream' +
    'track_id' + trackId + ts + appSecret);
}

/**
 * Il login con email e password: Qobuz restituisce un user_auth_token, che vale
 * quanto un token incollato a mano ma si rinnova da sé. La password viene
 * mandata solo in MD5 e resta sul telefono, nelle impostazioni dell'estensione.
 */
function qobuzLogin(force) {
  var email = trim(String(setting('qobuzEmail', '') || ''));
  var password = String(setting('qobuzPassword', '') || '');
  if (!email || !password) return null;
  var saved = myspoti.storage.get('qobuz_login');
  if (!force && saved && saved.token && saved.at && (now() - saved.at) < 12 * 60 * 60 * 1000) {
    return saved.token;
  }
  var res = httpPostForm(qobuzApi() + 'user/login', {
    email: email,
    password: md5hex(password),
    app_id: QOBUZ_LOGIN_APP
  }, 6000);
  if (!res || !res.body) {
    myspoti.log('qobuz: login senza risposta');
    return null;
  }
  if (res.status !== 200 || !res.body.user_auth_token) {
    var why = res.body.message ? String(res.body.message) : ('HTTP ' + res.status);
    myspoti.log('qobuz: login rifiutato — ' + why);
    // Credenziali sbagliate: non ha senso riprovare a ogni brano.
    if (/password|credentials|identification/i.test(why)) {
      try {
        myspoti.storage.set('qobuz_login_bad', { at: now(), why: why });
      } catch (e) {
        myspoti.log('storage piena: ' + e);
      }
    }
    return null;
  }
  var token = String(res.body.user_auth_token);
  try {
    myspoti.storage.set('qobuz_login', { token: token, at: now() });
    myspoti.storage.remove('qobuz_login_bad');
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
  myspoti.log('qobuz: login riuscito, token rinnovato');
  return token;
}

/** I token personali scritti nelle impostazioni: più d'uno, separati da virgole. */
function userTokens() {
  var raw = String(setting('userToken', '') || '');
  var parts = raw.split(/[\s,;]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var t = trim(parts[i]);
    if (t && t.length >= 20) out.push(t); // un token corto è un refuso
  }
  return out;
}

/**
 * Internet Archive conserva per lo più registrazioni d'epoca: la stessa opera
 * dura spesso meno del brano di Spotify. Con questa opzione attiva si accetta
 * la versione dell'archivio anche se dura diversamente; spenta, si accettano
 * solo file con la durata giusta.
 */
function acceptOtherPerformances() {
  var v = setting('iaLoose', true);
  return v !== false && String(v) !== 'false';
}

/**
 * Vero se nel pool c'è almeno un token che può servire un file intero. Con solo
 * account da anteprime la ricerca diretta si salta: si va dritti al relay, che
 * il catalogo lo legge lo stesso e l'audio lo serve.
 */
function qobuzHasFileToken() {
  var pool = tokenPool();
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].deadUntil && pool[i].deadUntil > now()) continue;
    if (previewOnly(pool[i].token)) continue;
    return true;
  }
  return false;
}

/** Qobuz acceso? (Con i token condivisi funziona anche senza token personali.) */
function qobuzEnabled() {
  var v = setting('qobuzEnabled', true);
  return v !== false && String(v) !== 'false';
}

/** Quanti token del pool possono ancora funzionare (non segnati come morti). */
function usableTokens() {
  var pool = tokenPool();
  var n = 0;
  for (var i = 0; i < pool.length; i++) {
    if (!pool[i].deadUntil || pool[i].deadUntil <= now()) n++;
  }
  return n;
}

/** L'indirizzo base dell'API (modificabile per specchi o per i test). */
function qobuzApi() {
  var custom = trim(String(setting('qobuzApi', '') || ''));
  if (!custom) return QOBUZ_API;
  return custom.charAt(custom.length - 1) === '/' ? custom : custom + '/';
}

/** Il pool salvato in storage (quello remoto, quando c'è), o null. */
function storedPool() {
  var saved = myspoti.storage.get(TOKENS_KEY);
  if (!saved || !saved.list || !saved.list.length) return null;
  if (saved.at && now() - saved.at > POOL_TTL_MS) return null;
  return saved;
}

/**
 * Il pool in uso: prima i token personali, poi il pool remoto (se configurato e
 * ancora fresco), poi quello condiviso scritto qui dentro. Ogni voce ha anche
 * lo stato "morto" per un po', così non si riprova un token appena rifiutato.
 */
function tokenPool() {
  var dead = myspoti.storage.get('qobuz_dead') || {};
  var out = [];
  var seen = {};

  function add(entry, source) {
    if (!entry || !entry.token || seen[entry.token]) return;
    seen[entry.token] = true;
    var at = dead[entry.token] || 0;
    out.push({
      token: entry.token,
      appId: String(entry.appId || QOBUZ_APP.appId),
      appSecret: String(entry.appSecret || QOBUZ_APP.appSecret),
      source: source,
      deadUntil: at && (now() - at) < TOKEN_DEAD_MS ? at + TOKEN_DEAD_MS : 0
    });
  }

  // 0. Il token del login (email + password): si rinnova da solo.
  var bad = myspoti.storage.get('qobuz_login_bad');
  var fresh = (!bad || !bad.at || (now() - bad.at) > 60 * 60 * 1000) ? qobuzLogin(false) : null;
  if (fresh) {
    add({ token: fresh, appId: QOBUZ_APP.appId, appSecret: QOBUZ_APP.appSecret }, 'login');
    add({ token: fresh, appId: QOBUZ_LOGIN_APP, appSecret: QOBUZ_APP.appSecret }, 'login');
  }

  // 1. Un token personale può appartenere a un'app diversa: si prova in più modi.
  var mine = userTokens();
  for (var u = 0; u < mine.length; u++) {
    var qd = myspoti.storage.get('qobuz_user_app') || {};
    var pref = qd[mine[u]] || null;
    if (pref === 'other') {
      add({ token: mine[u], appId: QOBUZ_APP.appId, appSecret: QOBUZ_APP.appSecret }, 'user');
      add({ token: mine[u] }, 'user');
    } else {
      add({ token: mine[u] }, 'user');
      add({ token: mine[u], appId: QOBUZ_APP.appId, appSecret: QOBUZ_APP.appSecret }, 'user');
    }
  }

  var saved = storedPool();
  if (saved) {
    for (var i = 0; i < saved.list.length; i++) add(saved.list[i], 'pool');
  }
  for (var j = 0; j < SHARED_TOKENS.length; j++) add(SHARED_TOKENS[j], 'shared');
  return out;
}

function markTokenDead(token) {
  var dead = myspoti.storage.get('qobuz_dead') || {};
  dead[token] = now();
  var keys = [];
  for (var k in dead) if (dead.hasOwnProperty(k)) keys.push(k);
  if (keys.length > 40) {
    keys.sort(function (a, b) { return dead[a] - dead[b]; });
    for (var i = 0; i < keys.length - 40; i++) delete dead[keys[i]];
  }
  try {
    myspoti.storage.set('qobuz_dead', dead);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

/**
 * Un token che risponde con "sample": true è valido, ma l'account non ha un
 * abbonamento attivo: serve solo anteprime da 30 secondi, inutili per noi. Non
 * è "morto" (la ricerca funziona benissimo), quindi si segna a parte e lo si
 * salta solo quando si chiede un file.
 */
function previewOnly(token) {
  var m = myspoti.storage.get('qobuz_preview') || {};
  var at = m[token] || 0;
  return !!at && (now() - at) < TOKEN_PREVIEW_MS;
}

function markPreviewOnly(token) {
  var m = myspoti.storage.get('qobuz_preview') || {};
  m[token] = now();
  var keys = [];
  for (var k in m) if (m.hasOwnProperty(k)) keys.push(k);
  if (keys.length > 40) {
    keys.sort(function (a, b) { return m[a] - m[b]; });
    for (var i = 0; i < keys.length - 40; i++) delete m[keys[i]];
  }
  try {
    myspoti.storage.set('qobuz_preview', m);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

/**
 * Rilegge il pool da un indirizzo, se l'utente ne ha indicato uno: il formato
 * accettato è quello dell'estensione Echo, un array di {token, app_id,
 * app_secret}, ma va bene anche {tokens: [...]} o un array di sole stringhe.
 */
function refreshPool(force) {
  var url = trim(String(setting('poolUrl', '') || ''));
  if (!url) return false;
  var saved = storedPool();
  if (!force && saved) return true;
  if (leftMs() < 2500) return false;
  var j = httpJson(url, POOL_TIMEOUT);
  var list = [];
  if (j) {
    var raw = j.tokens || j.data || j.accounts || j;
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) {
        var one = raw[i];
        if (!one) continue;
        if (typeof one === 'string') {
          if (one.length >= 20) list.push({ token: one });
          continue;
        }
        var token = one.token || one.user_auth_token || one.userAuthToken;
        if (!token) continue;
        var appId = one.app_id || one.appId || QOBUZ_APP.appId;
        var secret = one.app_secret || one.appSecret;
        if (!secret) {
          secret = String(appId) === '312369995' ? SHARED_TOKENS[0].appSecret : QOBUZ_APP.appSecret;
        }
        list.push({ token: String(token), appId: String(appId), appSecret: String(secret) });
      }
    }
  }
  if (!list.length) {
    myspoti.log('pool: niente da leggere da ' + url);
    return false;
  }
  try {
    myspoti.storage.set(TOKENS_KEY, { list: list, at: now() });
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
  myspoti.log('pool: ' + list.length + ' token da ' + url);
  return true;
}

function cacheUserApp(token, which) {
  var m = myspoti.storage.get('qobuz_user_app') || {};
  m[token] = which;
  try {
    myspoti.storage.set('qobuz_user_app', m);
  } catch (e) {
    myspoti.log('storage piena: ' + e);
  }
}

/**
 * Una chiamata all'API Qobuz, provando i token del pool a rotazione.
 *
 * Il token viaggia nella query (`user_auth_token`), non in un'intestazione: è
 * l'unico modo che Qobuz accetta allo stesso modo da tutti i client, e nel
 * sandbox di Myspoti non si dipende dal supporto delle intestazioni.
 *
 * Restituisce { status, body, entry } oppure null se nessun token risponde.
 * 401/403 = quel token è morto (o l'account ha perso l'abbonamento): si passa
 * al successivo e lo si ricorda per un po'.
 */
function qobuzCall(path, params, opts) {
  if (leftMs() < 1200) return null;
  refreshPool(false); // se c'è un pool da leggere e non è già fresco
  var pool = tokenPool();
  if (!pool.length) return null;
  var startAt = parseInt(String(myspoti.storage.get('qobuz_next') || '0'), 10) || 0;
  var order = [];
  for (var n = 0; n < pool.length; n++) order.push(pool[(startAt + n) % pool.length]);

  var tries = 0;
  var last = null;
  for (var i = 0; i < order.length && tries < MAX_TOKEN_TRIES; i++) {
    var entry = order[i];
    if (entry.deadUntil && entry.deadUntil > now()) continue;
    if (opts && opts.skip && opts.skip(entry)) continue;
    if (leftMs() < 1000) break;
    tries++;

    var extra = '';
    var signed = opts && opts.sign ? opts.sign(entry) : null;
    for (var key in params) {
      if (params.hasOwnProperty(key) && params[key] !== null && params[key] !== undefined) {
        extra += '&' + key + '=' + encodeURIComponent(String(params[key]));
      }
    }
    if (signed) extra += '&request_sig=' + encodeURIComponent(signed);

    var url = qobuzApi() + path + '?app_id=' + encodeURIComponent(entry.appId) +
      '&user_auth_token=' + encodeURIComponent(entry.token) + extra;
    // `cap`: un tetto per le chiamate che non devono mangiarsi il tempo
    // dell'archivio se Qobuz non risponde.
    var cap = opts && opts.cap ? opts.cap : TIMEOUT;
    var res = httpRaw(url, Math.min(cap, TIMEOUT, Math.max(1500, leftMs() - 600)));
    if (!res) continue;

    if (res.status === 401 || res.status === 403) {
      markTokenDead(entry.token);
      myspoti.log('qobuz: token ' + entry.source + ' rifiutato (' + res.status + ')');
      continue;
    }
    var body = null;
    try {
      body = JSON.parse(res.body);
    } catch (e) {
      body = null;
    }
    if (!body) {
      myspoti.log('qobuz: risposta non JSON da ' + path + ' (' + res.status + ')');
      last = { status: res.status, body: null, entry: entry };
      continue;
    }
    if (res.status === 200) {
      // Ricorda quale token funziona: la prossima chiamata riparte da lì.
      try {
        myspoti.storage.set('qobuz_next', String((startAt + i) % pool.length));
      } catch (e) {
        myspoti.log('storage piena: ' + e);
      }
      if (entry.source === 'user') {
        cacheUserApp(entry.token, entry.appId === QOBUZ_APP.appId ? 'other' : 'shared');
      }
      return { status: 200, body: body, entry: entry };
    }
    // 400/404/5xx: non è colpa del token, inutile insistere con altri.
    return { status: res.status, body: body, entry: entry };
  }
  if (tries >= MAX_TOKEN_TRIES) myspoti.log('qobuz: nessun token del pool ha risposto');
  return last;
}

/** Le tracce Qobuz per una ricerca, già nella forma dei candidati. */
function qobuzSearchTracks(query) {
  if (!trim(query)) return [];
  // Sei secondi bastano e avanzano per una ricerca: oltre, meglio passare
  // all'archivio che restare appesi a Qobuz.
  var res = qobuzCall('track/search', { query: query, limit: 20 }, { cap: 6000 });
  var items = res && res.body && res.body.tracks ? res.body.tracks.items : null;
  if (!items || !items.length) return [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    if (!t || t.id === undefined) continue;
    var title = String(t.title == null ? '' : t.title);
    if (t.version) title += ' (' + t.version + ')';
    var artist = t.performer && t.performer.name ? t.performer.name
      : (t.artist && t.artist.name ? t.artist.name : '');
    var album = t.album && t.album.title ? t.album.title : '';
    var depth = t.maximum_bit_depth || 0;
    var rate = t.maximum_sampling_rate || 0;
    out.push({
      id: QOBUZ_PREFIX + t.id,
      title: trim(title),
      artist: artist,
      album: album,
      duration: t.duration,
      isrc: t.isrc || '',
      audioQuality: depth ? (depth + '-bit / ' + rate + ' kHz') : '',
      hires: !!t.hires,
      source: 'Qobuz'
    });
  }
  return out;
}

/** In streaming: l'URL del FLAC per un id qz:<trackId>, 24-bit se c'è. */
function qobuzAnswer(trackId, wantHiRes) {
  var formats = wantHiRes ? [FORMAT_HI, FORMAT_CD] : [FORMAT_CD, FORMAT_HI];
  var last = null;
  var previewed = false;
  // Se gli account già noti servono solo anteprime non vale la pena chiedere
  // niente: si dice subito com'è la situazione (serve a `status`).
  var early = tokenPool();
  var usable = 0;
  for (var e = 0; e < early.length; e++) {
    if (early[e].deadUntil && early[e].deadUntil > now()) continue;
    if (previewOnly(early[e].token)) continue;
    usable++;
  }
  if (early.length && !usable) {
    myspoti.log('qobuz ' + trackId + ': tutti gli account del pool servono solo anteprime');
    return { ok: false, reason: 'preview' };
  }
  for (var i = 0; i < formats.length; i++) {
    if (leftMs() < 1500) return { ok: false, reason: previewed ? 'preview' : 'timeout' };
    var fmt = formats[i];
    // Un account senza abbonamento risponde "sample": true. Capita anche nel
    // pool: si segna e si riprova lo stesso formato con il token successivo,
    // invece di rinunciare al brano per colpa del primo della lista.
    for (var attempt = 0; attempt < 3; attempt++) {
      if (leftMs() < 1500) break;
      var ts = Math.floor(now() / 1000);
      var res = qobuzCall('track/getFileUrl', {
        request_ts: ts,
        track_id: trackId,
        format_id: fmt,
        intent: 'stream'
      }, {
        // La firma dipende dalla secret dell'app del token che risponde.
        sign: function (entry) {
          return qobuzSign(ts, trackId, fmt, entry.appSecret);
        },
        // skip riceve la voce del pool, non il token: qui si guarda il token.
        skip: function (entry) { return previewOnly(entry.token); }
      });
      if (!res) break;
      if (res.status === 200 && res.body && res.body.url) {
        var b = res.body;
        if (b.sample === true || /[?&]range=/.test(String(b.url))) {
          var tok = res.entry && res.entry.token ? res.entry.token : '';
          myspoti.log('qobuz ' + trackId + ': anteprima di 30 secondi dal token ' +
            (res.entry ? res.entry.source : '?') + ' — provo un altro');
          if (tok) markPreviewOnly(tok);
          previewed = true;
          if (!tok) break;
          continue; // stesso formato, token successivo
        }
        return {
          ok: true,
          answer: {
            url: String(b.url),
            format: 'flac',
            codec: 'flac',
            bitDepth: parseInt(b.bit_depth, 10) || 0,
            sampleRate: Math.round((parseFloat(b.sampling_rate) || 0) * 1000),
            size: 0,
            expiresAt: tokenExpiry(b.url),
            at: now(),
            isrcMatched: false
          }
        };
      }
      last = res && res.body && res.body.message ? String(res.body.message) : ('HTTP ' + (res ? res.status : '?'));
      break; // 400/404/5xx: non è colpa del token, si passa al formato dopo
    }
  }
  if (previewed) {
    myspoti.log('qobuz ' + trackId + ': solo anteprime da 30 secondi — brano lasciato a Spotify');
    return { ok: false, reason: 'preview' };
  }
  myspoti.log('qobuz ' + trackId + ': ' + (last || 'nessun token'));
  return { ok: false, reason: 'error' };
}

/**
 * Gli id dei candidati per un brano, dal migliore al peggiore:
 * { ids: [ { i: "19170173", h: 1 }, … ], at }. In storage per due settimane:
 * così un brano già abbinato costa una sola richiesta (lo stream).
 */
function findCandidates(track) {
  var key = matchKey(track);
  var cached = readCache(key);
  if (cached) return cached;

  var queries = queriesFor(track);
  var seen = {};
  var seenNum = {};
  var all = [];

  function addRanked(list) {
    var ranked = rankCandidates(list, track);
    for (var j = 0; j < ranked.length; j++) {
      var id = String(ranked[j].item.id);
      if (seen[id]) continue;
      seen[id] = true;
      var num = numericId(id);
      if (num) seenNum[num] = true;
      all.push(ranked[j]);
    }
    return ranked;
  }

  // Qobuz diretto: la ricerca funziona anche con i token che servono solo
  // anteprime (l'abbonamento conta al momento del file, non del catalogo), ed è
  // la via più corta: l'id trovato qui lo può suonare anche il relay.
  if (qobuzEnabled()) {
    for (var i = 0; i < queries.length && i < MAX_QUERIES; i++) {
      if (i > 0 && (nearDeadline(5000, 0.3) || leftMs() < 9500)) break;
      addRanked(searchTracks(queries[i]));
      // Abbinamento netto: inutile insistere, ma solo se arriva da una fonte che
      // ha già dimostrato di servire audio.
      var good = 0;
      for (var g = 0; g < all.length; g++) {
        var known = providers()[providerOf(all[g].item.id)];
        if (known && known.ok) { good++; break; }
      }
      if (all.length && all[0].score >= 90 && good) break;
    }
  }

  // Il relay cerca solo se il catalogo non ha dato niente (nessun token, 401):
  // con un id già in mano basta chiedergli il file.
  if (!all.length && relayEnabled() && !nearDeadline(4000, 0.25) && queries.length) {
    var relayed = relaySearchTracks(queries[0]);
    var fresh = [];
    for (var r = 0; r < relayed.length; r++) {
      var rnum = numericId(relayed[r].id);
      if (rnum && seenNum[rnum]) continue;
      fresh.push(relayed[r]);
    }
    addRanked(fresh);
  }

  // Internet Archive solo quando catalogo e relay non hanno dato nulla: se c'è
  // già un abbinamento buono, la ricerca nell'archivio costerebbe un secondo per
  // niente (lo streamFor lo prova comunque, come ultima spiaggia).
  if (!all.length && !nearDeadline(5000, 0.3)) {
    var ia = iaCandidates(track);
    for (var w = 0; w < ia.length; w++) {
      if (seen[ia[w].id]) continue;
      seen[ia[w].id] = true;
      var ev = evaluate(ia[w], track);
      if (ev) all.push(ev);
    }
  }

  if (!all.length) return null;

  all.sort(function (x, y) { return y.score - x.score; });
  var ids = [];
  for (var k = 0; k < all.length && k < MAX_CANDIDATES; k++) {
    ids.push({
      i: String(all[k].item.id),
      h: all[k].hiRes ? 1 : 0,
      d: durationSec(all[k].item),
      s: Math.round(all[k].score),
      p: providerOf(all[k].item.id),
      q: String(all[k].item.audioQuality || ''), // per dire la qualità senza indovinare
      s: String(all[k].item.sourceKey || ''),    // da quale servizio del relay viene l'id
    });
  }
  // ok: l'id che ha già risposto (si riprova quello per primo);
  // bad: gli id che il servizio ha rifiutato (502): inutile riprovarli.
  var entry = { ids: ids, ok: null, bad: [], at: now() };
  writeCache(key, entry);
  return entry;
}

/* ------------------------------------------------------------------ */
/* Stream                                                              */
/* ------------------------------------------------------------------ */

/**
 * Perché una risposta del servizio non è un brano intero lossless (null: va bene).
 * Il servizio può degradare e servire anteprime: URL con `range=…`, formato MP3,
 * o `fmt=` diverso da 6/7 (i codici FLAC di Qobuz). Meglio dirlo che far suonare
 * trenta secondi.
 */
function previewReason(info) {
  if (!info || !info.url) return 'nessun indirizzo';
  var url = String(info.url);
  var format = String(info.format || info.codec || '').toLowerCase();
  if (/[?&]range=/.test(url)) return 'anteprima (range nell\'indirizzo)';
  var fmt = /[?&]fmt=(\d+)/.exec(url);
  if (fmt && fmt[1] !== '6' && fmt[1] !== '7') return 'formato non lossless (fmt=' + fmt[1] + ')';
  if (format && format !== 'flac') return 'formato ' + format + ' (non FLAC)';
  return null;
}

/**
 * Internet Archive mette il titolo del brano nel nome del file, e l'addon a
 * volte pesca il file sbagliato dentro l'item ("In the Mood" -> "I've Got a Gal
 * in Kalamazoo.flac"). Dove il nome è parlante si controlla: se non c'entra con
 * il titolo del brano, la risposta si scarta. Nomi senza parole (hash, "6-09-73_
 * t19_24-96.flac") non si possono giudicare e si lasciano passare.
 */
/**
 * Le parole che contano per riconoscere un brano: almeno tre lettere, niente
 * cifre ("op", "no" e "1" non aiutano) e niente paroline di servizio.
 */
var SKIP_WORDS = ['the', 'and', 'for', 'you', 'all', 'not', 'but', 'con', 'del', 'dei',
  'della', 'gli', 'una', 'uno', 'per', 'non', 'nel', 'sua', 'suo', 'live', 'version',
  'edit', 'remaster', 'remastered', 'mono', 'stereo', 'vol'];
function significantWords(text) {
  var parts = tokensOf(String(text == null ? '' : text));
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var w = parts[i];
    if (w.length >= 3 && !/[0-9]/.test(w) && indexOf(SKIP_WORDS, w) < 0) out.push(w);
  }
  return out;
}

function fileLooksRight(url, track) {
  var last = String(url || '').split('?')[0].split('/').pop();
  if (!last || !/\.(flac|mp3|m4a)$/i.test(last)) return true;
  // Nome del file: minuscole, senza estensione e senza punteggiatura. Non si usa
  // norm() qui: taglia tutto dopo " - ", che in un nome di file è normale.
  var name = '';
  try {
    name = decodeURIComponent(last);
  } catch (e) {
    name = last;
  }
  name = fold(name).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9]+/g, ' ');
  var words = significantWords(name);
  if (words.length < 2) return true; // nome non parlante ("01.flac", "6-09-73_t19")
  var want = significantWords(norm(track && track.title));
  if (!want.length) return true; // titolo fatto solo di numeri e paroline
  var hit = 0;
  for (var j = 0; j < want.length; j++) {
    if (indexOf(words, want[j]) >= 0) hit++;
  }
  return hit / want.length >= 0.5;
}

/**
 * Un file enorme per un brano corto è un concerto intero (o un'altra cosa):
 * meglio lasciar perdere. Senza Content-Length non si giudica.
 */
function tooBigFor(answer, track) {
  var seconds = trackDurationSec(track);
  if (!answer || !answer.size || !seconds) return false;
  return answer.size > (seconds * MAX_MB_PER_SECOND + 30) * 1024 * 1024;
}

/** Fine validità del token nell'URL (epoch ms), 0 se non c'è (il token dura ~1 h). */
function tokenExpiry(url) {
  var m = /[?&]etsp=(\d{9,})/.exec(String(url || ''));
  if (!m) return 0;
  return parseInt(m[1], 10) * 1000;
}

/**
 * Chiede al servizio l'URL del FLAC di un id.
 * null quando quell'id non è riproducibile (il servizio risponde 502 su alcune
 * versioni hi-res) o la risposta non è un FLAC.
 */
function buildAnswer(id, wantHiRes, meta, wantSize) {
  if (leftMs() < 2000) return { ok: false, reason: 'timeout' };
  var quality = meta && meta.q ? String(meta.q) : '';
  if (providerOf(id) === 'qz') return qobuzAnswer(String(id).slice(3), wantHiRes);
  if (providerOf(id) === 'rl') {
    return relayAnswer(String(id).slice(3), wantHiRes, quality, wantSize,
      meta && meta.s ? String(meta.s) : '');
  }
  if (providerOf(id) === 'ia') return iaAnswer(id);
  return { ok: false, reason: 'no-audio' };
}

/**
 * L'ordine in cui provare gli id: prima quello che ha già funzionato, poi i
 * migliori; a CD il 16-bit prima (file più piccolo). Gli id che il servizio ha
 * rifiutato vanno in fondo, non si buttano: se cambia idea restano lì.
 */
function orderIds(entry, wantHiResFirst, track, asDownload) {
  var bad = entry.bad || [];
  var want = track ? trackDurationSec(track) : 0;

  // 1. Durata: per un download Myspoti accetta solo file fra -5 s e +15 s.
  var byDuration = [];
  for (var k = 0; k < entry.ids.length; k++) {
    var id = entry.ids[k];
    if (asDownload && want && id.d && !(id.d >= want - 5 && id.d <= want + 15)) continue;
    byDuration.push(id);
  }
  // Nessuna edizione con la durata giusta: meglio niente file che uno che
  // Myspoti rifiuterebbe dopo averlo scaricato tutto.
  if (!byDuration.length) {
    if (asDownload) return [];
    byDuration = entry.ids.slice(0);
  }

  // 2. Fonti: quelle che hanno già detto di non avere audio si saltano.
  var usable = [];
  for (var m = 0; m < byDuration.length; m++) {
    if (providerUsable(byDuration[m].i)) usable.push(byDuration[m]);
  }
  if (!usable.length) return []; // niente da provare: si risponde subito

  // Ordine dei tentativi: prima le fonti già viste funzionare, poi (se serve)
  // l'alta risoluzione, poi il punteggio di abbinamento.
  var known = providers();
  function provRank(id) {
    var k = known[String(id).split(':')[0]];
    if (!k) return 1; // fonte mai provata
    return k.ok ? 0 : 2;
  }
  usable.sort(function (x, y) {
    var rx = provRank(x.i);
    var ry = provRank(y.i);
    if (rx !== ry) return rx - ry;
    if (wantHiResFirst && x.h !== y.h) return x.h ? -1 : 1;
    return (y.s || 0) - (x.s || 0);
  });

  var okHi = 1;
  for (var n = 0; n < usable.length; n++) {
    if (String(usable[n].i) === String(entry.ok)) okHi = usable[n].h;
  }
  var out = [];
  // L'id che ha già funzionato va per primo, se è della qualità cercata.
  if (entry.ok && indexOf(bad, entry.ok) < 0 && (wantHiResFirst || okHi === 0)) out.push(String(entry.ok));
  for (var i = 0; i < usable.length; i++) {
    var one = String(usable[i].i);
    if (one === entry.ok || indexOf(bad, one) >= 0) continue;
    out.push(one);
  }
  return out;
}

/** La risposta per un brano (con cache), o null. [wantHiRes] e [asDownload] ordinano i tentativi. */
function streamFor(track, wantHiRes, asDownload) {
  if (!isMyspotiTrack(track)) return null;
  var key = matchKey(track);
  var hiResFirst = wantHiRes === undefined ? preferHiRes() : !!wantHiRes;

  var kept = answers[key];
  if (kept) {
    // Pochi secondi dopo la stessa richiesta: quasi sempre Myspoti che riprova
    // perché l'indirizzo è stato rifiutato. Si ricostruisce invece di ripeterlo.
    if (now() - (kept.at || 0) < RETRY_MS) {
      delete answers[key];
    } else {
      var fresh = kept.expiresAt ? (kept.expiresAt - now() > MIN_LEFT_MS)
                                 : (now() - (kept.at || 0) < KEEP_ANSWER_MS);
      if (fresh) return kept;
      delete answers[key];
    }
  }

  var entry = findCandidates(track);
  if (!entry) {
    myspoti.log('nessun abbinamento per "' + track.title + '" — ' + track.artist);
    return null;
  }

  var metaOf = {};
  for (var mi = 0; mi < entry.ids.length; mi++) metaOf[String(entry.ids[mi].i)] = entry.ids[mi];

  var ids = orderIds(entry, hiResFirst, track, asDownload);
  if (!ids.length) {
    // Tutte le fonti di questo brano hanno già detto di non avere audio:
    // si risponde subito, senza riprovare e senza sporcare il log.
    if (!entry.dead) writeCache(key, { ids: entry.ids, ok: entry.ok, bad: entry.bad, at: entry.at, dead: true });
    return null;
  }
  var changed = false;
  for (var i = 0; i < ids.length && i < MAX_TRIES; i++) {
    if (i > 0 && leftMs() < 2500) break;
    var out = buildAnswer(ids[i], hiResFirst, metaOf[String(ids[i])], !!asDownload);
    if (out.ok) {
      var answer = out.answer;
      // Il file è un altro brano (Internet Archive pesca a volte il file sbagliato)?
      if (!fileLooksRight(answer.url, track)) {
        myspoti.log('stream ' + ids[i] + ': il file è un altro brano — scartato');
        continue;
      }
      // Un file enorme per un brano corto è un concerto intero: solo per IA,
      // che è l'unica fonte che può servire item di ore.
      if (!answer.size && providerOf(ids[i]) === 'ia') answer.size = sizeOf(answer.url);
      if (tooBigFor(answer, track)) {
        myspoti.log('stream ' + ids[i] + ': file di ' + Math.round(answer.size / 1048576) + ' MB, troppo per questo brano');
        continue;
      }
      answers[key] = answer;
      markProvider(ids[i], true);
      if (entry.ok !== ids[i]) {
        entry.ok = ids[i];
        changed = true;
      }
      break;
    }
    if ((out.reason === 'preview' || out.reason === 'error') &&
        providerOf(ids[i]) === 'qz' && relayEnabled()) {
      // Qobuz risponde "solo anteprime" (o nessun token valido): lo stesso
      // brano può arrivare dal relay, che parla con Qobuz al posto nostro.
      var mm = metaOf[String(ids[i])] || {};
      var viaRelay = relayAnswer(numericId(ids[i]), hiResFirst,
        mm.q || '', !!asDownload, mm.s || '');
      if (viaRelay.ok && fileLooksRight(viaRelay.answer.url, track) &&
          !tooBigFor(viaRelay.answer, track)) {
        answers[key] = viaRelay.answer;
        markProvider(RELAY_PREFIX + '0', true);
        if (entry.ok !== ids[i]) {
          entry.ok = ids[i];
          changed = true;
        }
        break;
      }
    }
    if (out.reason === 'preview' && providerOf(ids[i]) === 'qz') {
      // L'account del token serve solo assaggi, e il relay non ha dato il file:
      // inutile provare le altre edizioni.
      markProvider(ids[i], false);
      break;
    }
    if (out.reason === 'no-audio') {
      markProvider(ids[i], false);
      if (entry.ok === ids[i]) {
        entry.ok = null;
        changed = true;
      }
    }
    // preview, timeout o errore di rete: si prova il candidato successivo
  }
  if (changed) writeCache(key, entry);

  // Qobuz non ha dato niente di buono (token morti, anteprime, brano assente):
  // si prova Internet Archive, che non ha bisogno di account.
  if (!answers[key] && leftMs() > 5500) {
    var ias = iaCandidates(track);
    var tried = {};
    for (var t = 0; t < ids.length; t++) tried[String(ids[t])] = true;
    for (var w = 0; w < ias.length && w < 4; w++) {
      if (tried[ias[w].id]) continue;
      var ev = evaluate(ias[w], track);
      if (!ev) continue;
      if (leftMs() < 3000) break;
      var out2 = buildAnswer(ias[w].id, false);
      if (!out2.ok) continue;
      if (!fileLooksRight(out2.answer.url, track)) {
        myspoti.log('archive ' + ias[w].id + ': il file non è il brano — scartato');
        continue;
      }
      if (tooBigFor(out2.answer, track)) continue;
      answers[key] = out2.answer;
      markProvider(ias[w].id, true);
      break;
    }
  }

  if (!answers[key]) {
    myspoti.log('nessuno stream utilizzabile per "' + track.title + '"');
    return null;
  }
  return answers[key];
}

/**
 * expiresInMs per l'hook: solo quando il token scade prima della finestra in cui
 * Myspoti tiene una risposta (dieci minuti); altrimenti il default va benissimo.
 */
function expiresInMs(answer) {
  if (!answer.expiresAt) return undefined;
  var left = answer.expiresAt - now();
  if (left <= MIN_LEFT_MS) return undefined;
  if (left >= KEEP_ANSWER_MS + 60000) return undefined;
  return left - 30000;
}

/* ------------------------------------------------------------------ */
/* Hook                                                               */
/* ------------------------------------------------------------------ */

function hasFeature(name) {
  // Su una Myspoti più vecchia `features` può mancare del tutto.
  return !myspoti.features || myspoti.features.indexOf(name) >= 0;
}

myspoti.provide('audio-source', function (track) {
  startBudget(13);
  if (!streamEnabled()) return null;
  try {
    var a = streamFor(track, preferHiRes());
    if (!a) return null;
    var out = { url: a.url, mimeType: 'audio/flac', codec: 'flac' };
    if (a.bitDepth) out.bitDepth = a.bitDepth;
    if (a.sampleRate) out.sampleRate = a.sampleRate;
    // Se il file non dichiara la profondità, meglio dire da dove arriva che
    // lasciare il player senza qualità.
    if (!a.bitDepth && a.source) out.source = String(a.source).slice(0, 80);
    if (hasFeature('audio.expires')) {
      var exp = expiresInMs(a);
      if (exp !== undefined) out.expiresInMs = exp;
    }
    return out;
  } catch (e) {
    myspoti.log('audio-source: ' + e);
    return null;
  }
});

myspoti.provide('download-source', function (track) {
  startBudget(28);
  try {
    // quality: "hi-res" (il meglio), "cd" (16-bit lossless), "small" (un file piccolo)
    var cd = String(track.quality || '') === 'cd';
    var a = streamFor(track, !cd, true);
    if (!a) return null;
    var file = {
      url: a.url,
      format: 'flac',
      provider: PROVIDER,
      isrcMatched: !!a.isrcMatched
    };
    if (a.bitDepth) file.bitDepth = a.bitDepth;
    if (a.sampleRate) file.sampleRate = a.sampleRate;
    var size = a.size || sizeOf(a.url);
    var seconds = trackDurationSec(track);
    // Un file da 64 kbps non è un brano intero lossless: è un'anteprima sfuggita
    // ai controlli sull'indirizzo. Meglio nessun file che uno inutile.
    if (size && seconds > 30 && size < seconds * 8000) {
      myspoti.log('file di ' + size + ' byte per ' + Math.round(seconds) + ' s: probabile anteprima');
      return null;
    }
    if (size) {
      a.size = size;
      file.sizeHint = size;
    }
    return [file];
  } catch (e) {
    myspoti.log('download-source: ' + e);
    return null;
  }
});

/*
 * `status`: Myspoti chiede se l'estensione sa servire audio e, con `live:false`,
 * la spegne (niente streaming, niente download) finché non torna un sì. Per
 * questo la sonda è breve e prudente: una fonte che ha servito un file da poco
 * vale come prova senza spendere richieste, e se il tempo finisce prima di avere
 * una risposta chiara si resta attivi — l'ultima parola è del brano, non di una
 * sonda andata male.
 */
myspoti.provide('status', function () {
  startBudget(4);
  try {
    return statusNow();
  } catch (e) {
    // Un errore qui non deve spegnere niente: tre eccezioni di fila e Myspoti
    // mette l'estensione fuori uso.
    myspoti.log('status: ' + e);
    return { live: true };
  }
});

function statusNow() {
  var known = providers();
  var recent = 10 * 60000;
  // Una fonte che ha servito un file negli ultimi dieci minuti è una prova
  // migliore di qualunque sonda: nessuna richiesta, si è vivi.
  if ((known.qz && known.qz.ok && now() - known.qz.at < recent) ||
      (known.rl && known.rl.ok && now() - known.rl.at < recent) ||
      (known.ia && known.ia.ok && now() - known.ia.at < recent)) {
    return { live: true };
  }

  var problems = [];
  var undecided = false;
  // Un brano noto del catalogo: serve solo a chiedere un indirizzo.
  var PROBE_TRACK = '9140031';

  // 1. Il relay: una richiesta di file, nessun download.
  if (relayEnabled() && leftMs() > 1200) {
    var r = relayAnswer(PROBE_TRACK, false, '', false, '');
    if (r.ok) {
      markProvider(RELAY_PREFIX + '0', true);
      return { live: true };
    }
    if (leftMs() < 1200 || r.reason === 'timeout') undecided = true;
    else problems.push('Qobuz (relay): il servizio non restituisce il file');
  }

  // 2. Qobuz diretto: un getFileUrl con i token configurati.
  if (qobuzEnabled() && leftMs() > 1200) {
    var q = qobuzAnswer(PROBE_TRACK, false);
    if (q.ok) {
      markProvider(QOBUZ_PREFIX + '0', true);
      return { live: true };
    }
    if (q.reason === 'timeout') undecided = true;
    else if (q.reason === 'preview') problems.push('Qobuz: gli account del pool servono solo anteprime da 30 s');
    else problems.push('Qobuz: nessun token valido');
  }

  // 3. Internet Archive: l'unica fonte che non chiede niente a nessuno.
  if (leftMs() > 1500) {
    var iaOk = known.ia && known.ia.ok && (now() - (known.ia.at || 0)) < PROVIDER_TTL_MS;
    if (iaOk) return { live: true };
    var found = iaCandidates({
      id: 'probe', uri: 'spotify:track:probe', title: 'Clair de lune',
      artist: 'Claude Debussy', artists: ['Claude Debussy'], album: '', durationMs: 300000
    });
    if (found && found.length) {
      markProvider(IA_PREFIX + '0', true);
      myspoti.storage.set(PROBE_KEY, String(found[0].id));
      return { live: true };
    }
    if (leftMs() > 600) problems.push('Internet Archive: nessun file FLAC trovato');
    else undecided = true;
  } else {
    undecided = true;
  }

  // Nessuna risposta chiara (rete lenta, tempo finito): si resta attivi. Meglio
  // un brano che ci mette qualche secondo in più che un'estensione spenta.
  if (undecided) {
    myspoti.log('status: sonda non conclusa, resto attivo');
    return { live: true };
  }
  return {
    live: false,
    detail: problems.length
      ? problems.join('; ') + '. I brani restano su Spotify.'
      : 'Nessuna fonte audio disponibile: i brani restano su Spotify.'
  };
}

/*
 * Il pulsante «Prova le fonti»: una richiesta per fonte, e un riassunto. Serve a
 * capire dal telefono che cosa risponde e che cosa no, senza leggere i log.
 */
function probeRelaySource(src) {
  var paths = relaySearchPaths(src, 'daft%20punk');
  var out = 'non risponde';
  var cap = src.shape === 'monochrome' ? 2500 : 4000;
  for (var p = 0; p < paths.length; p++) {
    relayBudget(2);
    var res = relayAt(src.base, paths[p], cap);
    if (!res) {
      out = 'non risponde';
      continue;
    }
    if (res.body && relayNormalize(res.body, src).length) return 'ok';
    if (res.status >= 200 && res.status < 300) { out = 'vuoto'; continue; }
    out = 'HTTP ' + res.status;
    if (res.status !== 404 && res.status !== 400) break;
  }
  return out;
}

function runDiagnostics() {
  startBudget(22);
  var short = [];
  function add(name, verdict) {
    short.push(name + ': ' + verdict);
  }
  // Prima le fonti veloci e più importanti (Qobuz e Archivio), poi i relay: se il
  // tempo finisce, almeno si sa se il problema è il catalogo o un servizio.
  if (qobuzEnabled()) {
    if (leftMs() > 3500) {
      var probe = qobuzCall('track/search', { query: 'daft punk', limit: 1 }, { cap: 4000 });
      var item = probe && probe.body && probe.body.tracks && probe.body.tracks.items
        ? probe.body.tracks.items[0] : null;
      if (item) {
        var a = qobuzAnswer(String(item.id), false);
        add('Qobuz', a.ok ? 'file ok' : (a.reason === 'preview' ? 'solo anteprime' : a.reason));
      } else {
        add('Qobuz', probe && probe.status ? 'HTTP ' + probe.status : 'non risponde');
      }
    } else {
      add('Qobuz', 'non provato (tempo)');
    }
  } else {
    add('Qobuz', 'spento');
  }
  if (leftMs() > 3500) {
    var ia = iaCandidates({
      id: 'diag', uri: 'spotify:track:diag', title: 'Clair de lune',
      artist: 'Claude Debussy', artists: ['Claude Debussy'], album: '', durationMs: 300000
    });
    add('Archivio', ia && ia.length ? 'file ok' : 'niente FLAC');
  } else {
    add('Archivio', 'non provato (tempo)');
  }
  if (relayEnabled()) {
    var srcs = relaySources();
    for (var i = 0; i < srcs.length; i++) {
      if (leftMs() < 2500) { add(srcs[i].key, 'non provato (tempo)'); continue; }
      add(srcs[i].key, probeRelaySource(srcs[i]));
    }
  } else {
    add('relay', 'spento');
  }
  var line = short.join(' · ');
  myspoti.log('fonti — ' + line);
  myspoti.notify(line.length > 190 ? line.slice(0, 187) + '…' : line);
}

myspoti.on('setting', function (e) {
  if (!e || !e.pressed) return;
  if (e.key === 'testSources') {
    try {
      runDiagnostics();
    } catch (err) {
      myspoti.log('diagnostica: ' + err);
      myspoti.notify('Prova non riuscita: ' + err);
    }
    return;
  }
  if (e.key !== 'clearCache') return;
  answers = {};
  myspoti.storage.remove(CACHE_KEY);
  myspoti.storage.remove(PROBE_KEY);
  myspoti.storage.remove(PROVIDERS_KEY);
  myspoti.storage.remove(TOKENS_KEY);
  myspoti.storage.remove('qobuz_dead');
  myspoti.storage.remove('qobuz_preview');
  myspoti.storage.remove('relay_state');
  myspoti.storage.remove('qobuz_next');
  myspoti.notify('Cache, fonti e token dimenticati');
});

myspoti.log('Qobuz Hi-Res pronto (' + myspoti.extension.version + ')');
