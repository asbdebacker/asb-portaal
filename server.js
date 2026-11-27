// De website van ASB De Backer als kleine Node.js-toepassing, zonder pakketten.
// Ze toont de pagina's uit de map site en neemt de berichten van het contactformulier aan.
// Instellingen uit de omgeving (nooit in de code):
//   PORT           poort waarop de hosting de toepassing verwacht
//   BERICHTEN_MAP  map waarin de berichten bewaard worden (standaard: de map gegevens naast dit bestand, niet publiek)
// De berichten komen in berichten.json. Ze worden NOG NIET doorgemaild: dat is de volgende stap (zie LEESMIJ.txt).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORTAAL = require('./portaal.js');                                          // het klantenportaal (zie portaal.js)
const POORT = parseInt(process.env.PORT || '3000', 10);
const SITE = path.join(__dirname, 'site');
const MAP = process.env.BERICHTEN_MAP || path.join(__dirname, 'gegevens');
const BESTAND = path.join(MAP, 'berichten.json');
const SOORT = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

const stuur = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const lees = req => new Promise((ok, nok) => { let t = '', n = 0; req.on('data', d => { n += d.length; if (n > 20000) { nok(new Error('te groot')); req.destroy(); } else t += d; }); req.on('end', () => ok(t)); req.on('error', nok); });
const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

// niet meer dan 5 berichten per kwartier van hetzelfde adres, en 200 per dag in totaal
const perAdres = new Map(); let vandaag = { dag: '', n: 0 };
function teVeel(adres) {
  const nu = Date.now(), lijst = (perAdres.get(adres) || []).filter(t => nu - t < 900000);
  const dag = new Date().toISOString().slice(0, 10); if (vandaag.dag !== dag) vandaag = { dag, n: 0 };
  if (lijst.length >= 5 || vandaag.n >= 200) return true;
  lijst.push(nu); perAdres.set(adres, lijst); vandaag.n++;
  if (perAdres.size > 5000) perAdres.clear();
  return false;
}
function bewaar(b) {
  fs.mkdirSync(MAP, { recursive: true });
  let lijst = []; try { lijst = JSON.parse(fs.readFileSync(BESTAND, 'utf8')); } catch (e) { lijst = []; }
  lijst.push(b); if (lijst.length > 2000) lijst = lijst.slice(-2000);
  fs.writeFileSync(BESTAND + '.tmp', JSON.stringify(lijst, null, 1)); fs.renameSync(BESTAND + '.tmp', BESTAND);
}

const server = http.createServer(async (req, res) => {
  let pad; try { pad = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end('Ongeldig adres'); }
  try {
    if (await PORTAAL.behandel(req, res, pad)) return;
    if (pad === '/api/contact') {
      if (req.method !== 'POST') return stuur(res, 405, { fout: 'Alleen versturen.' });
      let b; try { b = JSON.parse(await lees(req)); } catch (e) { return stuur(res, 400, { fout: 'Het bericht kon niet gelezen worden.' }); }
      if (!b || typeof b !== 'object') return stuur(res, 400, { fout: 'Het bericht kon niet gelezen worden.' });
      if (tekst(b.website, 200)) return stuur(res, 200, { ok: true });                    // het verborgen veld is ingevuld: een robot. Doen alsof het gelukt is, niets bewaren.
      const m = { naam: tekst(b.naam, 80), bedrijf: tekst(b.bedrijf, 80), mail: tekst(b.mail, 120), tel: tekst(b.tel, 30), bericht: tekst(b.bericht, 4000), wie: b.wie === 'particulier' ? 'particulier' : 'professional' };
      if (!m.naam) return stuur(res, 400, { fout: 'Vul uw naam in.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.mail)) return stuur(res, 400, { fout: 'Vul een geldig e-mailadres in.' });
      if (m.bericht.length < 10) return stuur(res, 400, { fout: 'Schrijf kort wat u nodig hebt.' });
      if (b.akkoord !== 'on' && b.akkoord !== true) return stuur(res, 400, { fout: 'Vink aan dat wij uw gegevens mogen gebruiken om te antwoorden.' });
      const adres = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (teVeel(adres)) return stuur(res, 429, { fout: 'Er zijn te veel berichten verstuurd. Probeer het later opnieuw, of bel ons.' });
      bewaar(Object.assign({ id: crypto.randomBytes(6).toString('hex'), tijd: new Date().toISOString(), doorgestuurd: false }, m));
      return stuur(res, 200, { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Niet toegestaan'); }
    let f = path.normalize(path.join(SITE, pad === '/' ? 'index.html' : pad));
    if (!f.startsWith(SITE + path.sep)) { res.writeHead(404); return res.end('Niet gevonden'); }
    if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
    let st = null; try { st = fs.statSync(f); } catch (e) { st = null; }
    if (!st || !st.isFile() || !SOORT[path.extname(f).toLowerCase()]) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!DOCTYPE html><meta charset="utf-8"><title>Niet gevonden</title><p style="font:18px sans-serif;margin:40px">Deze pagina bestaat niet. <a href="/">Naar de startpagina</a></p>'); }
    res.writeHead(200, { 'Content-Type': SOORT[path.extname(f).toLowerCase()], 'Content-Length': st.size, 'Cache-Control': /\.html$/.test(f) ? 'no-cache' : 'max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.writeHead(500); res.end('Er ging iets mis.'); }
});
server.listen(POORT, () => console.log('website luistert op poort ' + POORT));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
