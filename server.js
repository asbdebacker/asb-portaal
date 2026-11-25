// Testapplicatie voor de Node.js-hosting. Alleen verzonnen testgegevens, geen klanten of projecten.
// Instellingen komen uit de omgeving (nooit in de code):
//   PORT          poort waarop de hosting de applicatie verwacht
//   TEST_SLEUTEL  geheime sleutel die de server op kantoor meestuurt
//   DB_HOST, DB_USER, DB_PASS, DB_NAAM   de MySQL-database van het pakket
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const VERSIE = '0.1.1';
const POORT = parseInt(process.env.PORT || '3000', 10);
const SLEUTEL = process.env.TEST_SLEUTEL || '';
const GESTART = new Date();
const BESTAND = path.join(process.env.TEST_MAP || __dirname, 'testgegevens.json');

// ---------- wat de applicatie onthoudt ----------
// In het geheugen (weg na een herstart) en, als het kan, in een bestand en in de database.
const geheugen = { hartslagen: [], ontvangen: [] };
let bestandFout = '';
function leesBestand() { try { return JSON.parse(fs.readFileSync(BESTAND, 'utf8')); } catch (e) { return { starts: [], hartslagen: [], ontvangen: [] }; } }
function schrijfBestand(d) { try { fs.writeFileSync(BESTAND, JSON.stringify(d)); bestandFout = ''; } catch (e) { bestandFout = e.code || e.message; } }
function inBestand(soort, wat, max) { const d = leesBestand(); (d[soort] = d[soort] || []).push(wat); if (d[soort].length > max) d[soort] = d[soort].slice(-max); schrijfBestand(d); }

// ---------- database ----------
let pool = null, dbFout = '';
function db() {
  if (pool) return pool;
  if (!process.env.DB_HOST) { dbFout = 'geen database ingesteld (DB_HOST ontbreekt)'; return null; }
  try {
    pool = require('mysql2/promise').createPool({ host: process.env.DB_HOST, port: parseInt(process.env.DB_POORT || '3306', 10), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAAM, connectionLimit: 3, connectTimeout: 8000 });
    return pool;
  } catch (e) { dbFout = e.code || e.message; return null; }
}
async function dbKlaar() {
  const p = db(); if (!p) return false;
  await p.query('CREATE TABLE IF NOT EXISTS test_hartslag (id INT AUTO_INCREMENT PRIMARY KEY, tijd DATETIME NOT NULL, soort VARCHAR(20) NOT NULL, tekst VARCHAR(255))');
  return true;
}
async function inDb(soort, tekst) { try { if (!await dbKlaar()) return false; await pool.query('INSERT INTO test_hartslag (tijd, soort, tekst) VALUES (UTC_TIMESTAMP(), ?, ?)', [soort, String(tekst || '').slice(0, 255)]); dbFout = ''; return true; } catch (e) { dbFout = e.code || e.message; return false; } }

// ---------- hartslag: elke minuut een teken van leven, ook zonder bezoekers ----------
function hartslag() {
  const nu = new Date().toISOString();
  geheugen.hartslagen.push(nu); if (geheugen.hartslagen.length > 3000) geheugen.hartslagen.shift();
  inBestand('hartslagen', nu, 3000);
  inDb('hartslag', 'start ' + GESTART.toISOString());
}
// de grootste pauze tussen twee hartslagen: toont of de applicatie stilgelegd werd
function gaten(lijst) {
  let grootste = 0, aantal = 0;
  for (let i = 1; i < lijst.length; i++) { const s = (new Date(lijst[i]) - new Date(lijst[i - 1])) / 1000; if (s > grootste) grootste = s; if (s > 150) aantal++; }
  return { aantal: lijst.length, eerste: lijst[0] || null, laatste: lijst[lijst.length - 1] || null, grootstePauzeSeconden: Math.round(grootste), pauzesLangerDan150s: aantal };
}

// ---------- antwoorden ----------
const stuur = (res, code, o) => { const t = JSON.stringify(o, null, 2); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(t); };
const lees = req => new Promise((ok, nok) => { let t = '', n = 0; req.on('data', d => { n += d.length; if (n > 200000) { nok(new Error('te groot')); req.destroy(); } else t += d; }); req.on('end', () => ok(t)); req.on('error', nok); });
const zelfde = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const magSturen = req => SLEUTEL.length >= 16 && zelfde((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SLEUTEL);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const pad = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && pad === '/') {
      return stuur(res, 200, { toepassing: 'ASB testapplicatie (alleen testgegevens)', versie: VERSIE, node: process.version, gestart: GESTART.toISOString(), draaitSeconden: Math.round(process.uptime()), sleutelIngesteld: SLEUTEL.length >= 16, databaseIngesteld: !!process.env.DB_HOST });
    }
    if (req.method === 'GET' && pad === '/hartslag') {
      const d = leesBestand(); const uit = { gestart: GESTART.toISOString(), draaitSeconden: Math.round(process.uptime()), sindsDezeStart: gaten(geheugen.hartslagen), inBestand: Object.assign(gaten(d.hartslagen || []), { starts: d.starts || [], fout: bestandFout || null }) };
      try { if (await dbKlaar()) { const [r] = await pool.query("SELECT COUNT(*) AS aantal, MIN(tijd) AS eerste, MAX(tijd) AS laatste, COUNT(DISTINCT tekst) AS starts FROM test_hartslag WHERE soort = 'hartslag'"); uit.inDatabase = r[0]; } else uit.inDatabase = { fout: dbFout }; } catch (e) { uit.inDatabase = { fout: e.code || e.message }; }
      return stuur(res, 200, uit);
    }
    if (req.method === 'GET' && pad === '/db') {
      if (!await dbKlaar()) return stuur(res, 200, { werkt: false, fout: dbFout });
      const merk = 'proef ' + crypto.randomBytes(4).toString('hex');
      await pool.query('INSERT INTO test_hartslag (tijd, soort, tekst) VALUES (UTC_TIMESTAMP(), ?, ?)', ['proef', merk]);
      const [terug] = await pool.query('SELECT id, tijd, tekst FROM test_hartslag WHERE tekst = ?', [merk]);
      const [v] = await pool.query('SELECT VERSION() AS versie, DATABASE() AS naam');
      const [g] = await pool.query('SELECT ROUND(SUM(data_length + index_length) / 1024) AS kb FROM information_schema.tables WHERE table_schema = DATABASE()');
      return stuur(res, 200, { werkt: terug.length === 1, geschrevenEnTeruggelezen: terug[0] || null, server: v[0].versie, database: v[0].naam, grootteKb: g[0].kb });
    }
    if (pad === '/api/ontvang') {
      // bij een weigering alleen lengtes tonen, nooit de sleutel zelf: zo is te zien of de kop onderweg verdwijnt of de instelling anders is
      if (!magSturen(req)) return stuur(res, 401, { fout: 'geen of een verkeerde sleutel', kopOntvangen: !!req.headers.authorization, lengteOntvangen: (req.headers.authorization || '').replace(/^Bearer\s+/i, '').length, lengteIngesteld: SLEUTEL.length, lengteIngesteldZonderSpaties: SLEUTEL.trim().length });
      if (req.method === 'POST') {
        let b; try { b = JSON.parse(await lees(req)); } catch (e) { return stuur(res, 400, { fout: 'geen geldige gegevens' }); }
        const rij = { ontvangen: new Date().toISOString(), verstuurd: b.verstuurd || null, volgnummer: b.volgnummer, regels: Array.isArray(b.regels) ? b.regels.length : 0, vanAdres: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), viaHttps: (req.headers['x-forwarded-proto'] || '') || (req.socket.encrypted ? 'https' : 'onbekend') };
        geheugen.ontvangen.push(rij); if (geheugen.ontvangen.length > 500) geheugen.ontvangen.shift();
        inBestand('ontvangen', rij, 500); const inDatabase = await inDb('ontvangen', 'volgnummer ' + b.volgnummer + ', ' + rij.regels + ' regels');
        return stuur(res, 200, { ok: true, ontvangen: rij.ontvangen, volgnummer: b.volgnummer, regels: rij.regels, inDatabase });
      }
      if (req.method === 'GET') { const d = leesBestand(); return stuur(res, 200, { sindsDezeStart: geheugen.ontvangen.length, inBestand: (d.ontvangen || []).length, laatste: (d.ontvangen || geheugen.ontvangen).slice(-10) }); }
    }
    stuur(res, 404, { fout: 'bestaat niet' });
  } catch (e) { stuur(res, 500, { fout: e.code || e.message }); }
});

inBestand('starts', GESTART.toISOString(), 200);
hartslag(); setInterval(hartslag, 60000);
server.listen(POORT, () => console.log('testapplicatie ' + VERSIE + ' luistert op poort ' + POORT));
process.on('SIGTERM', () => { console.log('gestopt door de hosting (SIGTERM)'); server.close(() => process.exit(0)); });
