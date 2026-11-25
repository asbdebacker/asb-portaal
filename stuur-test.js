// Draait op kantoor: stuurt verzonnen testgegevens via https naar de testapplicatie. Alleen uitgaand verkeer.
// Gebruik:  node stuur-test.js <adres> [aantal keer] [seconden ertussen]
// De sleutel komt uit de omgeving (TEST_SLEUTEL), nooit uit de opdrachtregel of de code.
'use strict';
const adres = process.argv[2], keer = parseInt(process.argv[3] || '1', 10), wacht = parseInt(process.argv[4] || '60', 10);
const sleutel = process.env.TEST_SLEUTEL || '';
if (!adres || !sleutel) { console.log('Geef een adres op en zet TEST_SLEUTEL in de omgeving.'); process.exit(1); }
const lib = adres.startsWith('https:') ? require('https') : require('http');
const stuur = nr => new Promise(klaar => {
  const tekst = JSON.stringify({ verstuurd: new Date().toISOString(), volgnummer: nr, regels: [{ project: 'TEST-001', klant: 'Testklant A', status: 'in productie' }, { project: 'TEST-002', klant: 'Testklant B', status: 'klaar' }] });
  const begin = Date.now(); const u = new URL('/api/ontvang', adres);
  // TEST_ZONDER_CERTCONTROLE=1: alleen voor de proef op het tijdelijke adres, dat geen geldig certificaat heeft. Nooit voor echte gegevens.
  const req = lib.request({ rejectUnauthorized: process.env.TEST_ZONDER_CERTCONTROLE !== '1', hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST', timeout: 20000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tekst), Authorization: 'Bearer ' + sleutel } }, res => {
    let t = ''; res.on('data', d => t += d); res.on('end', () => { console.log(new Date().toLocaleTimeString('nl-BE'), '| nr', nr, '| antwoord', res.statusCode, '|', Date.now() - begin, 'ms |', t.replace(/\s+/g, ' ').slice(0, 160)); klaar(res.statusCode === 200); });
  });
  req.on('timeout', () => req.destroy(new Error('geen antwoord binnen 20 s')));
  req.on('error', e => { console.log(new Date().toLocaleTimeString('nl-BE'), '| nr', nr, '| MISLUKT:', e.code || e.message); klaar(false); });
  req.end(tekst);
});
(async () => { let goed = 0; for (let i = 1; i <= keer; i++) { if (await stuur(i)) goed++; if (i < keer) await new Promise(r => setTimeout(r, wacht * 1000)); } console.log('gelukt:', goed, 'van', keer); })();
