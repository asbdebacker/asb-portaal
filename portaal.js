// Het klantenportaal, fase 1: een vaste klant ziet de stand van zijn projecten. Alleen kijken.
// De gegevens komen van het ASB werkplatform op kantoor: dat stuurt zelf, alleen uitgaand, het volledige overzicht naar
// POST /api/ontvang. Het portaal vraagt nooit iets aan kantoor en verstuurt geen mail.
// Aanmelden: met een persoonlijke link die het bureau in het werkplatform maakt. Het portaal kent alleen de vingerafdruk
// (SHA-256) van die link, nooit de link zelf.
// Instellingen uit de omgeving (nooit in de code):
//   PORTAAL_SLEUTEL (of TEST_SLEUTEL)       de sleutel die het werkplatform meestuurt
//   DB_HOST, DB_POORT, DB_USER, DB_PASS, DB_NAAM   de MySQL-database van het pakket. Zonder DB_HOST: bestanden in PORTAAL_MAP
//   PORTAAL_MAP                             map voor die bestanden (alleen voor de proef op een pc; bij de hosting
//                                           verdwijnen bestanden bij elke nieuwe versie, daar is de database nodig)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SLEUTEL = String(process.env.PORTAAL_SLEUTEL || process.env.TEST_SLEUTEL || '').trim();
const MAP = process.env.PORTAAL_MAP || path.join(__dirname, 'gegevens');
const SESSIE_MS = 30 * 86400000, OUD_MS = 2 * 3600000, KOEK = 'asb_portaal';
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const zelfde = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

// ---------- opslag: één rij per naam, in de database of (proef) in een bestand ----------
let pool = null, tabelKlaar = false;
const metDb = () => !!process.env.DB_HOST;
async function db() {
  if (!pool) pool = require('mysql2/promise').createPool({ host: process.env.DB_HOST, port: parseInt(process.env.DB_POORT || '3306', 10), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAAM, connectionLimit: 3, connectTimeout: 8000, charset: 'utf8mb4' });
  if (!tabelKlaar) { await pool.query('CREATE TABLE IF NOT EXISTS portaal_opslag (naam VARCHAR(40) NOT NULL PRIMARY KEY, inhoud MEDIUMTEXT NOT NULL, tijd DATETIME NOT NULL) CHARACTER SET utf8mb4'); tabelKlaar = true; }
  return pool;
}
const geheugen = new Map();                                                    // naam -> { tijd, waarde }
async function lees(naam, leeg) {
  const g = geheugen.get(naam); if (g && Date.now() - g.tijd < 20000) return g.waarde;
  let waarde = leeg;
  if (metDb()) { const [r] = await (await db()).query('SELECT inhoud FROM portaal_opslag WHERE naam = ?', [naam]); if (r.length) { try { waarde = JSON.parse(r[0].inhoud); } catch (e) { waarde = leeg; } } }
  else { try { waarde = JSON.parse(fs.readFileSync(path.join(MAP, 'portaal-' + naam + '.json'), 'utf8')); } catch (e) { waarde = leeg; } }
  geheugen.set(naam, { tijd: Date.now(), waarde });
  return waarde;
}
async function schrijf(naam, waarde) {
  const t = JSON.stringify(waarde);
  if (metDb()) await (await db()).query('REPLACE INTO portaal_opslag (naam, inhoud, tijd) VALUES (?, ?, UTC_TIMESTAMP())', [naam, t]);
  else { fs.mkdirSync(MAP, { recursive: true }); const f = path.join(MAP, 'portaal-' + naam + '.json'); fs.writeFileSync(f + '.tmp', t); fs.renameSync(f + '.tmp', f); }
  geheugen.set(naam, { tijd: Date.now(), waarde });
}
const LEEG = { ontvangen: null, verstuurd: null, klanten: {}, accounts: [], projecten: [] };

// ---------- wat het werkplatform stuurt: nakijken en alleen de gekende velden overnemen ----------
function schoon(b) {
  if (!b || typeof b !== 'object' || b.versie !== 1 || !Array.isArray(b.accounts) || !Array.isArray(b.projecten) || !Array.isArray(b.klanten)) return { fout: 'De gegevens hebben niet de verwachte vorm.' };
  if (b.accounts.length > 500 || b.projecten.length > 10000 || b.klanten.length > 500) return { fout: 'Te veel regels.' };
  const klanten = {}; for (const k of b.klanten) { const afk = tekst(k && k.afk, 12).toUpperCase(); if (afk) klanten[afk] = tekst(k.naam, 80) || afk; }
  const accounts = [], gezien = new Set();
  for (const a of b.accounts) {
    const r = { id: tekst(a && a.id, 40), klantAfk: tekst(a && a.klantAfk, 12).toUpperCase(), mail: tekst(a && a.mail, 120).toLowerCase(), naam: tekst(a && a.naam, 80), th: tekst(a && a.th, 64).toLowerCase() };
    if (!/^[a-z0-9]{6,40}$/i.test(r.id) || !r.klantAfk || !klanten[r.klantAfk] || gezien.has(r.id)) return { fout: 'Een account is onvolledig of dubbel.' };
    if (r.th && !/^[0-9a-f]{64}$/.test(r.th)) return { fout: 'Een account heeft een ongeldige vingerafdruk.' };
    gezien.add(r.id); accounts.push(r);
  }
  const projecten = [];
  for (const p of b.projecten) {
    const r = { code: tekst(p && p.code, 60), klantAfk: tekst(p && p.klantAfk, 12).toUpperCase(), ref: tekst(p && p.ref, 120), stap: parseInt(p && p.stap, 10), sinds: tekst(p && p.sinds, 30) };
    if (!r.code || !klanten[r.klantAfk] || !(r.stap >= 1 && r.stap <= 3)) return { fout: 'Een project is onvolledig.' };
    if (r.sinds && isNaN(new Date(r.sinds))) r.sinds = '';
    projecten.push(r);
  }
  return { stand: { ontvangen: new Date().toISOString(), verstuurd: tekst(b.verstuurd, 30), klanten, accounts, projecten } };
}

// ---------- aanmelden ----------
const pogingen = new Map();
// hoogstens 10 mislukte pogingen per kwartier van hetzelfde adres; een geslaagde aanmelding telt niet mee
const recent = adres => (pogingen.get(adres) || []).filter(t => Date.now() - t < 900000);
const teVeel = adres => recent(adres).length >= 10;
function telMislukt(adres) { const lijst = recent(adres); lijst.push(Date.now()); pogingen.set(adres, lijst); if (pogingen.size > 5000) pogingen.clear(); }
const koekje = req => { const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + KOEK + '=([A-Za-z0-9_-]{20,80})')); return m ? m[1] : ''; };
const veilig = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
const zetKoek = (req, waarde, seconden) => `${KOEK}=${waarde}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconden}${veilig(req) ? '; Secure' : ''}`;
const adresVan = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

async function wieIs(req) {
  const k = koekje(req); if (!k) return null;
  const sessies = await lees('sessies', {}), s = sessies[hash(k)];
  if (!s || s.tot < Date.now()) return null;
  const stand = await lees('stand', LEEG), a = stand.accounts.find(x => x.id === s.account);
  // het account is weg, of het bureau maakte een nieuwe link: de oude aanmelding telt niet meer
  if (!a || !a.th || a.th !== s.th) return null;
  if (s.tot - Date.now() < SESSIE_MS - 86400000) { s.tot = Date.now() + SESSIE_MS; await schrijf('sessies', sessies); }   // hoogstens één keer per dag verlengen
  return { account: a, stand };
}

const stuur = (res, code, o, koppen) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, koppen || {})); res.end(JSON.stringify(o)); };
const leesBody = (req, max) => new Promise((ok, nok) => { let t = '', n = 0; req.on('data', d => { n += d.length; if (n > max) { nok(new Error('te groot')); req.destroy(); } else t += d; }); req.on('end', () => ok(t)); req.on('error', nok); });

// Geeft true als het adres van het portaal is (en dus beantwoord), anders false.
async function behandel(req, res, pad) {
  if (pad !== '/api/ontvang' && !pad.startsWith('/api/portaal/')) return false;
  try {
    if (pad === '/api/ontvang') {
      if (SLEUTEL.length < 16 || !zelfde(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SLEUTEL)) return stuur(res, 401, { fout: 'geen of een verkeerde sleutel' }), true;
      if (req.method === 'GET') { const s = await lees('stand', LEEG); return stuur(res, 200, { ontvangen: s.ontvangen, accounts: s.accounts.length, projecten: s.projecten.length, opslag: metDb() ? 'database' : 'bestand' }), true; }
      if (req.method !== 'POST') return stuur(res, 405, { fout: 'Alleen versturen.' }), true;
      let b; try { b = JSON.parse(await leesBody(req, 3000000)); } catch (e) { return stuur(res, 400, { fout: 'De gegevens konden niet gelezen worden.' }), true; }
      const r = schoon(b); if (r.fout) return stuur(res, 400, { fout: r.fout }), true;
      await schrijf('stand', r.stand);
      return stuur(res, 200, { ok: true, ontvangen: r.stand.ontvangen, accounts: r.stand.accounts.length, projecten: r.stand.projecten.length, opslag: metDb() ? 'database' : 'bestand' }), true;
    }
    if (pad === '/api/portaal/in' && req.method === 'POST') {
      if (teVeel(adresVan(req))) return stuur(res, 429, { fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }), true;
      let b; try { b = JSON.parse(await leesBody(req, 2000)); } catch (e) { b = null; }
      const t = b && typeof b.t === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(b.t) ? b.t : '';
      const stand = await lees('stand', LEEG), th = t ? hash(t) : ''; let a = null;
      for (const x of stand.accounts) if (x.th && th && zelfde(x.th, th)) a = x;      // altijd de hele lijst af: geen verschil in tijd
      if (!a) telMislukt(adresVan(req));
      if (!a) return stuur(res, 401, { fout: 'Deze link werkt niet (meer). Neem contact met ons op voor een nieuwe link.' }), true;
      const id = crypto.randomBytes(32).toString('base64url'), sessies = await lees('sessies', {}), nu = Date.now();
      for (const k of Object.keys(sessies)) if (sessies[k].tot < nu) delete sessies[k];
      const sleutels = Object.keys(sessies); if (sleutels.length > 3000) for (const k of sleutels.sort((x, y) => sessies[x].tot - sessies[y].tot).slice(0, sleutels.length - 3000)) delete sessies[k];
      sessies[hash(id)] = { account: a.id, th: a.th, tot: nu + SESSIE_MS };
      await schrijf('sessies', sessies);
      return stuur(res, 200, { ok: true }, { 'Set-Cookie': zetKoek(req, id, Math.round(SESSIE_MS / 1000)) }), true;
    }
    if (pad === '/api/portaal/uit' && req.method === 'POST') {
      const k = koekje(req); if (k) { const sessies = await lees('sessies', {}); if (sessies[hash(k)]) { delete sessies[hash(k)]; await schrijf('sessies', sessies); } }
      return stuur(res, 200, { ok: true }, { 'Set-Cookie': zetKoek(req, 'weg', 0) }), true;
    }
    if (pad === '/api/portaal/mijn' && req.method === 'GET') {
      const w = await wieIs(req); if (!w) return stuur(res, 401, { fout: 'Meld u aan met uw persoonlijke link.' }), true;
      const a = w.account, s = w.stand;
      const projecten = s.projecten.filter(p => p.klantAfk === a.klantAfk).map(p => ({ code: p.code, ref: p.ref, stap: p.stap, sinds: p.sinds })).sort((x, y) => (y.stap - x.stap) || String(y.sinds).localeCompare(String(x.sinds)) || x.code.localeCompare(y.code));
      return stuur(res, 200, { klant: s.klanten[a.klantAfk] || a.klantAfk, naam: a.naam, mail: a.mail, bijgewerkt: s.ontvangen, oud: !s.ontvangen || Date.now() - new Date(s.ontvangen) > OUD_MS, projecten }), true;
    }
    stuur(res, 404, { fout: 'bestaat niet' });
  } catch (e) { console.error('[portaal]', e.code || e.message); stuur(res, 500, { fout: 'Er ging iets mis.' }); }
  return true;
}
module.exports = { behandel, schoon, hash };
