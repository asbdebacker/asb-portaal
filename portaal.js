// Het klantenportaal, fase 1: een vaste klant ziet de stand van zijn projecten. Alleen kijken.
// De gegevens komen van het ASB werkplatform op kantoor: dat stuurt zelf, alleen uitgaand, het volledige overzicht naar
// POST /api/ontvang. Het portaal vraagt nooit iets aan kantoor en verstuurt geen mail.
// Aanmelden: met het e-mailadres en een wachtwoord dat het werkplatform maakt. Het bureau heeft daarnaast één universeel
// wachtwoord dat, samen met het e-mailadres van een account, dat account opent. Het portaal kent van elk wachtwoord
// alleen de vingerafdruk (scrypt), gemaakt op kantoor.
// Instellingen uit de omgeving (nooit in de code):
//   PORTAAL_SLEUTEL (of TEST_SLEUTEL)       de sleutel die het werkplatform meestuurt
//   DB_HOST, DB_POORT, DB_USER, DB_PASS, DB_NAAM   de MySQL-database van het pakket. Zonder DB_HOST: bestanden in PORTAAL_MAP
//   PORTAAL_MAP                             map voor die bestanden (alleen voor de proef op een pc; bij de hosting
//                                           verdwijnen bestanden bij elke nieuwe versie, daar is de database nodig)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const PRIJS = require('./prijs.js');                                              // de richtprijs van een zaaglijst (zie prijs.js)
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
  if (!b || typeof b !== 'object' || b.versie !== 2 || !Array.isArray(b.accounts) || !Array.isArray(b.projecten) || !Array.isArray(b.klanten)) return { fout: 'De gegevens hebben niet de verwachte vorm.' };
  if (b.accounts.length > 500 || b.projecten.length > 10000 || b.klanten.length > 500) return { fout: 'Te veel regels.' };
  const klanten = {}; for (const k of b.klanten) { const afk = tekst(k && k.afk, 12).toUpperCase(); if (afk) klanten[afk] = tekst(k.naam, 80) || afk; }
  const accounts = [], gezien = new Set();
  for (const a of b.accounts) {
    const r = { id: tekst(a && a.id, 40), klantAfk: tekst(a && a.klantAfk, 12).toUpperCase(), mail: tekst(a && a.mail, 120).toLowerCase(), naam: tekst(a && a.naam, 80), ph: tekst(a && a.ph, 120) };
    if (!/^[a-z0-9]{6,40}$/i.test(r.id) || !r.klantAfk || !klanten[r.klantAfk] || !r.mail || gezien.has(r.id) || gezien.has('m:' + r.mail)) return { fout: 'Een account is onvolledig of dubbel.' };
    if (r.ph && !PH.test(r.ph)) return { fout: 'Een account heeft een ongeldige vingerafdruk.' };
    gezien.add(r.id); gezien.add('m:' + r.mail); accounts.push(r);
  }
  const universeel = tekst(b.universeel, 120); if (universeel && !PH.test(universeel)) return { fout: 'Het universele wachtwoord heeft een ongeldige vingerafdruk.' };
  const projecten = [];
  for (const p of b.projecten) {
    const r = { code: tekst(p && p.code, 60), klantAfk: tekst(p && p.klantAfk, 12).toUpperCase(), ref: tekst(p && p.ref, 120), stap: parseInt(p && p.stap, 10), sinds: tekst(p && p.sinds, 30) };
    if (!r.code || !klanten[r.klantAfk] || !(r.stap >= 1 && r.stap <= 4)) return { fout: 'Een project is onvolledig.' };
    if (r.sinds && isNaN(new Date(r.sinds))) r.sinds = '';
    projecten.push(r);
  }
  // de stand van de aanvragen die kantoor kent, met het antwoord van het bureau
  const aanvragen = {};
  if (b.aanvragen != null) {
    if (!Array.isArray(b.aanvragen) || b.aanvragen.length > 5000) return { fout: 'De aanvragen hebben niet de verwachte vorm.' };
    for (const x of b.aanvragen) { const id = tekst(x && x.id, 20); if (!/^P[0-9a-f]{12}$/.test(id) || !['nieuw', 'bezig', 'klaar'].includes(x.status)) return { fout: 'Een aanvraag is onvolledig.' }; aanvragen[id] = { status: x.status, antwoord: tekst(x.antwoord, 600) }; }
  }
  return { stand: { ontvangen: new Date().toISOString(), verstuurd: tekst(b.verstuurd, 30), universeel, klanten, accounts, projecten, aanvragen, prijs: PRIJS.schoon(b.prijs) } };
}

// ---------- wachtwoorden: het portaal kent alleen de vingerafdruk (scrypt met een eigen zout), gemaakt op kantoor ----------
const PH = /^s1\$([A-Za-z0-9+/=]{20,30})\$([A-Za-z0-9+/=]{40,50})$/;
const LEEG_PH = 's1$' + crypto.randomBytes(16).toString('base64') + '$' + crypto.randomBytes(32).toString('base64');   // om altijd even lang te rekenen
function wwKlopt(ww, ph) {
  return new Promise(klaar => {
    const m = PH.exec(String(ph || '')) || PH.exec(LEEG_PH), echt = PH.test(String(ph || ''));
    crypto.scrypt(String(ww), Buffer.from(m[1], 'base64'), 32, (fout, a) => { const b = Buffer.from(m[2], 'base64'); klaar(!fout && echt && a.length === b.length && crypto.timingSafeEqual(a, b)); });
  });
}

// ---------- aanmelden ----------
const pogingen = new Map();
// hoogstens 10 mislukte pogingen per kwartier van hetzelfde adres; een geslaagde aanmelding telt niet mee
const recent = adres => (pogingen.get(adres) || []).filter(t => Date.now() - t < 900000);
const MAX_POGINGEN = Math.max(3, parseInt(process.env.PORTAAL_MAX_POGINGEN || '10', 10) || 10);       // alleen de proef zet dit hoger
const teVeel = adres => recent(adres).length >= MAX_POGINGEN;
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
  // het account is weg, of het wachtwoord waarmee aangemeld werd is vervangen: de oude aanmelding telt niet meer
  if (!a) return null;
  if (s.bureau ? !(stand.universeel && s.ph === stand.universeel) : !(a.ph && s.ph === a.ph)) return null;
  if (s.tot - Date.now() < SESSIE_MS - 86400000) { s.tot = Date.now() + SESSIE_MS; await schrijf('sessies', sessies); }   // hoogstens één keer per dag verlengen
  return { account: a, stand, alsBureau: !!s.bureau };
}

// ---------- aanvragen van de klant (fase 2): een zaaglijst bestellen, een stuk opnieuw bestellen ----------
// Het portaal bewaart de aanvraag; het werkplatform haalt ze zelf op (alleen uitgaand vanaf kantoor) en stuurt nadien de
// stand en het antwoord van het bureau terug. Er gebeurt niets vanzelf en er wordt niets gemaild.
const REDENEN = { productie: 'Fout bij ASB: maat, bewerking of afwerking klopt niet', levering: 'Beschadigd bij levering of transport', plaatsing: 'Beschadigd tijdens het plaatsen', ontbreekt: 'Stuk ontbreekt in de levering', eigen: 'Eigen fout in de tekening of de bestelling', extra: 'Extra stuk nodig', anders: 'Andere reden' };
const URGENTIES = { normaal: 'Normaal: mee in de planning', dringend: 'Dringend: zo snel mogelijk', stilstand: 'Zeer dringend: de werf ligt stil' };
const getal = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const lang = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\r\n?/g, '\n').trim().slice(0, max);
function schoonZaaglijst(b, prijs) {
  const ref = tekst(b.ref, 80); if (!ref) return { fout: 'Geef uw referentie voor deze zaaglijst.' };
  const gewenst = tekst(b.gewenst, 10); if (gewenst && (!/^\d{4}-\d{2}-\d{2}$/.test(gewenst) || isNaN(new Date(gewenst)))) return { fout: 'De gewenste datum is niet geldig.' };
  if (!Array.isArray(b.regels) || !b.regels.length) return { fout: 'Vul minstens één regel in.' };
  if (b.regels.length > 200) return { fout: 'Een zaaglijst mag hoogstens 200 regels hebben. Stuur een grotere lijst in twee delen.' };
  const regels = [];
  for (let i = 0; i < b.regels.length; i++) {
    const r = b.regels[i] || {}, k = r.kanten || {}, n = 'Regel ' + (i + 1) + ': ';
    const gekozen = r.mat ? ((prijs && prijs.materialen) || []).find(x => x.id === String(r.mat)) : null;
    if (r.mat && !gekozen) return { fout: n + 'dit materiaal staat niet meer in de lijst. Kies het opnieuw.' };
    const o = { mat: gekozen ? gekozen.id : '', materiaal: gekozen ? gekozen.naam : tekst(r.materiaal, 80), dikte: gekozen ? gekozen.dikte : r.dikte === '' || r.dikte == null ? null : getal(r.dikte), l: getal(r.l), b: getal(r.b), aantal: Math.round(getal(r.aantal)), nerf: r.nerf === true, kanten: { l1: k.l1 === true, l2: k.l2 === true, b1: k.b1 === true, b2: k.b2 === true }, ref: tekst(r.ref, 60) };
    if (!o.materiaal) return { fout: n + 'vul het materiaal in.' };
    if (o.dikte !== null && !(o.dikte > 0 && o.dikte <= 120)) return { fout: n + 'de dikte moet tussen 0 en 120 mm liggen.' };
    if (!(o.l >= 10 && o.l <= 6000) || !(o.b >= 10 && o.b <= 6000)) return { fout: n + 'lengte en breedte moeten tussen 10 en 6000 mm liggen.' };
    if (!(o.aantal >= 1 && o.aantal <= 999)) return { fout: n + 'het aantal moet tussen 1 en 999 liggen.' };
    regels.push(o);
  }
  return { soort: 'zaaglijst', ref, gewenst, opmerking: lang(b.opmerking, 1000), regels };
}
function schoonOpnieuw(b, codes) {
  const code = tekst(b.code, 60), project = tekst(b.project, 80);
  if (code && !codes.includes(code)) return { fout: 'Dit project staat niet in uw overzicht.' };
  if (!code && !project) return { fout: 'Kies het project, of schrijf over welk project het gaat.' };
  const stuk = lang(b.stuk, 300); if (stuk.length < 3) return { fout: 'Omschrijf het stuk: bv. het nummer op het etiket, of de naam en de maten.' };
  const aantal = Math.round(getal(b.aantal)); if (!(aantal >= 1 && aantal <= 50)) return { fout: 'Het aantal moet tussen 1 en 50 liggen.' };
  if (!REDENEN[b.reden]) return { fout: 'Kies een reden.' };
  if (!URGENTIES[b.urgentie]) return { fout: 'Kies hoe dringend het is.' };
  const toelichting = lang(b.toelichting, 1000);
  if (b.reden === 'anders' && toelichting.length < 5) return { fout: 'Schrijf bij “Andere reden” kort wat er aan de hand is.' };
  return { soort: 'opnieuw', code, project, stuk, aantal, reden: b.reden, urgentie: b.urgentie, toelichting };
}
const titelVan = a => a.soort === 'zaaglijst' ? `Zaaglijst ${a.ref} (${a.regels.length} ${a.regels.length === 1 ? 'regel' : 'regels'}, ${a.regels.reduce((t, r) => t + r.aantal, 0)} stukken)` : `Stuk opnieuw: ${a.aantal} × ${a.stuk.split('\n')[0].slice(0, 80)}`;
// alleen verzoeken van de eigen site: JSON, en als de browser zegt vanwaar het komt, moet dat deze site zijn
// Bij de hosting staat er een tussenserver voor de toepassing: de kop Host is daar niet het adres van de site (vastgesteld
// op 27/11/2026: elk verzoek uit een browser werd geweigerd). Daarom, in deze volgorde:
//   1. zegt de browser zelf "same-origin" (Sec-Fetch-Site, niet te vervalsen door een script), dan is het goed;
//   2. anders moet de herkomst (Origin) een van onze eigen adressen zijn, of het adres waarop de toepassing zelf antwoordt.
const EIGEN_ADRESSEN = String(process.env.PORTAAL_ADRESSEN || 'asbdebacker.eu,www.asbdebacker.eu,asbdebacker.be,www.asbdebacker.be,portaal.asbdebacker.be').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function eigenVerzoek(req) {
  if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return false;
  const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs) return sfs === 'same-origin';
  const o = req.headers.origin; if (!o) return true;
  let host; try { host = new URL(o).host.toLowerCase(); } catch (e) { return false; }
  const hier = [req.headers.host, req.headers['x-forwarded-host']].map(h => String(h || '').split(',')[0].trim().toLowerCase()).filter(Boolean);
  return hier.includes(host) || EIGEN_ADRESSEN.includes(host);
}

const prijsTel = new Map();                                                    // hoogstens 400 berekeningen per tien minuten per account
function teVeelPrijs(id) { const nu = Date.now(), l = (prijsTel.get(id) || []).filter(t => nu - t < 600000); if (l.length >= 400) return true; l.push(nu); prijsTel.set(id, l); if (prijsTel.size > 2000) prijsTel.clear(); return false; }

const stuur = (res, code, o, koppen) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, koppen || {})); res.end(JSON.stringify(o)); };
const leesBody = (req, max) => new Promise((ok, nok) => { let t = '', n = 0; req.on('data', d => { n += d.length; if (n > max) { nok(new Error('te groot')); req.destroy(); } else t += d; }); req.on('end', () => ok(t)); req.on('error', nok); });

// Geeft true als het adres van het portaal is (en dus beantwoord), anders false.
async function behandel(req, res, pad) {
  if (pad !== '/api/ontvang' && pad !== '/api/ontvang/aanvragen' && !pad.startsWith('/api/portaal/')) return false;
  try {
    if (pad.startsWith('/api/portaal/') && req.method === 'POST' && !eigenVerzoek(req)) return stuur(res, 403, { fout: 'Dit verzoek komt niet van het portaal.' }), true;
    if (pad === '/api/ontvang/aanvragen') {
      if (SLEUTEL.length < 16 || !zelfde(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SLEUTEL)) return stuur(res, 401, { fout: 'geen of een verkeerde sleutel' }), true;
      if (req.method !== 'GET') return stuur(res, 405, { fout: 'Alleen lezen.' }), true;
      const lijst = await lees('aanvragen', []);
      return stuur(res, 200, { aanvragen: lijst.filter(a => !a.opgehaald).slice(0, 200) }), true;
    }
    if (pad === '/api/ontvang') {
      if (SLEUTEL.length < 16 || !zelfde(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SLEUTEL)) return stuur(res, 401, { fout: 'geen of een verkeerde sleutel' }), true;
      if (req.method === 'GET') { const s = await lees('stand', LEEG); return stuur(res, 200, { ontvangen: s.ontvangen, accounts: s.accounts.length, projecten: s.projecten.length, opslag: metDb() ? 'database' : 'bestand' }), true; }
      if (req.method !== 'POST') return stuur(res, 405, { fout: 'Alleen versturen.' }), true;
      let b; try { b = JSON.parse(await leesBody(req, 3000000)); } catch (e) { return stuur(res, 400, { fout: 'De gegevens konden niet gelezen worden.' }), true; }
      const r = schoon(b); if (r.fout) return stuur(res, 400, { fout: r.fout }), true;
      await schrijf('stand', r.stand);
      // wat kantoor kent, is opgehaald; wat afgehandeld en ouder dan een jaar is, mag weg
      const lijst = await lees('aanvragen', []), jaar = Date.now() - 366 * 86400000; let anders = false;
      for (const a of lijst) if (!a.opgehaald && r.stand.aanvragen[a.id]) { a.opgehaald = true; anders = true; }
      const blijft = lijst.filter(a => !(a.opgehaald && new Date(a.tijd) < jaar && (!r.stand.aanvragen[a.id] || r.stand.aanvragen[a.id].status === 'klaar')));
      if (anders || blijft.length !== lijst.length) await schrijf('aanvragen', blijft);
      return stuur(res, 200, { ok: true, ontvangen: r.stand.ontvangen, accounts: r.stand.accounts.length, projecten: r.stand.projecten.length, opslag: metDb() ? 'database' : 'bestand' }), true;
    }
    if (pad === '/api/portaal/in' && req.method === 'POST') {
      if (teVeel(adresVan(req))) return stuur(res, 429, { fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }), true;
      let b; try { b = JSON.parse(await leesBody(req, 2000)); } catch (e) { b = null; }
      const mail = b && typeof b.mail === 'string' ? tekst(b.mail, 120).toLowerCase() : '', ww = b && typeof b.ww === 'string' ? b.ww.slice(0, 200) : '';
      if (mail && teVeel('m:' + mail)) return stuur(res, 429, { fout: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' }), true;
      const stand = await lees('stand', LEEG), gevonden = stand.accounts.find(x => x.mail === mail) || null;
      // altijd twee keer rekenen, ook als het e-mailadres niet bestaat: geen verschil in tijd
      const eigen = await wwKlopt(ww, gevonden && gevonden.ph), bureau = await wwKlopt(ww, stand.universeel);
      const a = gevonden && ww && (eigen || bureau) ? gevonden : null;
      if (!a) { telMislukt(adresVan(req)); if (mail) telMislukt('m:' + mail); }
      if (!a) return stuur(res, 401, { fout: 'Het e-mailadres of het wachtwoord klopt niet.' }), true;
      const id = crypto.randomBytes(32).toString('base64url'), sessies = await lees('sessies', {}), nu = Date.now();
      for (const k of Object.keys(sessies)) if (sessies[k].tot < nu) delete sessies[k];
      const sleutels = Object.keys(sessies); if (sleutels.length > 3000) for (const k of sleutels.sort((x, y) => sessies[x].tot - sessies[y].tot).slice(0, sleutels.length - 3000)) delete sessies[k];
      // met het eigen wachtwoord: geldig zolang dat wachtwoord blijft; met het universele: zolang dat blijft
      sessies[hash(id)] = eigen ? { account: a.id, ph: a.ph, tot: nu + SESSIE_MS } : { account: a.id, ph: stand.universeel, bureau: true, tot: nu + SESSIE_MS };
      await schrijf('sessies', sessies);
      return stuur(res, 200, { ok: true }, { 'Set-Cookie': zetKoek(req, id, Math.round(SESSIE_MS / 1000)) }), true;
    }
    if (pad === '/api/portaal/uit' && req.method === 'POST') {
      const k = koekje(req); if (k) { const sessies = await lees('sessies', {}); if (sessies[hash(k)]) { delete sessies[hash(k)]; await schrijf('sessies', sessies); } }
      return stuur(res, 200, { ok: true }, { 'Set-Cookie': zetKoek(req, 'weg', 0) }), true;
    }
    if (pad === '/api/portaal/mijn' && req.method === 'GET') {
      const w = await wieIs(req); if (!w) return stuur(res, 401, { fout: 'Meld u aan.' }), true;
      const a = w.account, s = w.stand;
      const projecten = s.projecten.filter(p => p.klantAfk === a.klantAfk).map(p => ({ code: p.code, ref: p.ref, stap: p.stap, sinds: p.sinds })).sort((x, y) => ((x.stap === 4) - (y.stap === 4)) || (y.stap - x.stap) ||String(y.sinds).localeCompare(String(x.sinds)) || x.code.localeCompare(y.code));
      // de eigen aanvragen: de stand en het antwoord komen van kantoor; zolang kantoor ze niet opgehaald heeft: "verstuurd"
      const kent = s.aanvragen || {}, drie = Date.now() - 92 * 86400000;
      const aanvragen = (await lees('aanvragen', [])).filter(x => x.klantAfk === a.klantAfk).map(x => { const k = kent[x.id]; return { id: x.id, soort: x.soort, tijd: x.tijd, titel: titelVan(x), urgentie: x.urgentie || '', status: k ? k.status : x.opgehaald ? 'nieuw' : 'verstuurd', antwoord: k ? k.antwoord : '' }; })
        .filter(x => x.status !== 'klaar' || new Date(x.tijd) > drie).sort((x, y) => String(y.tijd).localeCompare(String(x.tijd))).slice(0, 60);
      return stuur(res, 200, { klant: s.klanten[a.klantAfk] || a.klantAfk, naam: a.naam, mail: a.mail, alsBureau: !!w.alsBureau, bijgewerkt: s.ontvangen, oud: !s.ontvangen || Date.now() - new Date(s.ontvangen) > OUD_MS, projecten, aanvragen, redenen: REDENEN, urgenties: URGENTIES, materialen: s.prijs ? s.prijs.materialen.map(m => ({ id: m.id, naam: m.naam, dikte: m.dikte })) : [] }), true;
    }
    // de richtprijs terwijl de klant typt: alleen het totaal en per regel of het uit stock kan. Onvolledige regels tellen niet mee.
    if (pad === '/api/portaal/prijs' && req.method === 'POST') {
      const w = await wieIs(req); if (!w) return stuur(res, 401, { fout: 'Meld u aan.' }), true;
      if (teVeelPrijs(w.account.id)) return stuur(res, 429, { fout: 'Even geduld.' }), true;
      let b; try { b = JSON.parse(await leesBody(req, 200000)); } catch (e) { b = null; }
      if (!b || !Array.isArray(b.regels) || b.regels.length > 200) return stuur(res, 400, { fout: 'De lijst kon niet gelezen worden.' }), true;
      const vol = [], plaats = [];
      b.regels.forEach((r, i) => { r = r || {}; const o = { mat: String(r.mat || ''), l: getal(r.l), b: getal(r.b), aantal: Math.round(getal(r.aantal)), nerf: r.nerf === true, kanten: r.kanten && typeof r.kanten === 'object' ? r.kanten : {} }; if (o.l >= 10 && o.l <= 6000 && o.b >= 10 && o.b <= 6000 && o.aantal >= 1 && o.aantal <= 999) { vol.push(o); plaats.push(i); } });
      const rp = PRIJS.richtprijs(w.stand.prijs, w.account.klantAfk, vol), regels = b.regels.map(() => ({ stock: '' }));
      plaats.forEach((i, n) => { regels[i] = rp.regels[n]; });
      const her = t => t.replace(/^Regel (\d+)/, (m, nr) => 'Regel ' + (plaats[parseInt(nr, 10) - 1] + 1));
      return stuur(res, 200, { totaal: vol.length ? rp.totaal : null, waarom: vol.length ? rp.waarom.map(her).slice(0, 6) : [], regels, platen: rp.platen, geteld: vol.length }), true;
    }
    if ((pad === '/api/portaal/zaaglijst' || pad === '/api/portaal/opnieuw') && req.method === 'POST') {
      const w = await wieIs(req); if (!w) return stuur(res, 401, { fout: 'Meld u aan.' }), true;
      const a = w.account;
      let b; try { b = JSON.parse(await leesBody(req, 200000)); } catch (e) { return stuur(res, 400, { fout: 'De aanvraag kon niet gelezen worden.' }), true; }
      if (!b || typeof b !== 'object') return stuur(res, 400, { fout: 'De aanvraag kon niet gelezen worden.' }), true;
      const inhoud = pad.endsWith('zaaglijst') ? schoonZaaglijst(b, w.stand.prijs) : schoonOpnieuw(b, w.stand.projecten.filter(p => p.klantAfk === a.klantAfk).map(p => p.code));
      if (inhoud.fout) return stuur(res, 400, { fout: inhoud.fout }), true;
      // de richtprijs zoals de klant ze zag, mee bewaren voor het bureau (null = prijs op aanvraag)
      if (inhoud.soort === 'zaaglijst') { const rp = PRIJS.richtprijs(w.stand.prijs, a.klantAfk, inhoud.regels); inhoud.richtprijs = rp.totaal; inhoud.richtReden = rp.totaal == null ? (rp.waarom[0] || '') : ''; inhoud.regels.forEach((r, i) => { r.stock = rp.regels[i].stock; }); }
      const lijst = await lees('aanvragen', []), dag = Date.now() - 86400000;
      if (lijst.filter(x => x.account === a.id && new Date(x.tijd) > dag).length >= 20) return stuur(res, 429, { fout: 'U hebt vandaag al veel aanvragen verstuurd. Bel ons als het dringend is.' }), true;
      if (lijst.length >= 3000) return stuur(res, 503, { fout: 'Het portaal kan nu geen aanvragen aannemen. Bel of mail ons.' }), true;
      const ref = p => (w.stand.projecten.find(x => x.code === p && x.klantAfk === a.klantAfk) || {}).ref || '';
      const nieuw = Object.assign({ id: 'P' + crypto.randomBytes(6).toString('hex'), tijd: new Date().toISOString(), account: a.id, klantAfk: a.klantAfk, mail: a.mail, naam: a.naam, doorBureau: !!w.alsBureau, opgehaald: false }, inhoud, inhoud.soort === 'opnieuw' && inhoud.code ? { projectRef: ref(inhoud.code) } : {});
      lijst.push(nieuw); await schrijf('aanvragen', lijst);
      return stuur(res, 200, { ok: true, id: nieuw.id, titel: titelVan(nieuw) }), true;
    }
    stuur(res, 404, { fout: 'bestaat niet' });
  } catch (e) { console.error('[portaal]', e.code || e.message); stuur(res, 500, { fout: 'Er ging iets mis.' }); }
  return true;
}
module.exports = { behandel, schoon, hash };
