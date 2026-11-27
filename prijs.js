// Richtprijs voor een zaaglijst in het klantenportaal. Zelfde rekenwijze als Prijsaanvraag > Calculatie in het
// werkplatform (reken.js en zaagplan.js daar): platen via het zaagplan en volledig aangerekend (nooit met resten),
// zaagtijd, kantenband, lijm en de tijd aan de kantenlijmer. Het portaal kent alleen verkoopwaarden per klant;
// de inkoopprijzen en de factoren blijven op kantoor. De klant krijgt alleen het totaal te zien.
// Kant: elke plaat heeft een standaardkant (gekozen door het bureau); de klant kan per regel een andere kant kiezen.
// zaagplan.js is een ongewijzigde kopie van public/zaagplan.js uit het werkplatform: hou ze gelijk.
'use strict';
const Zaagplan = require('./zaagplan.js');
const n = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; };
const naamVan = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Wat kantoor stuurt nakijken; bij twijfel geen prijslijst (dan is alles "prijs op aanvraag").
function schoon(p) {
  if (!p || typeof p !== 'object' || !p.reken || !Array.isArray(p.materialen) || !p.klanten || typeof p.klanten !== 'object' || p.materialen.length > 2000) return null;
  const reken = {}; for (const k of ['snede', 'boord', 'secPerSnede', 'meterPerMin', 'secPerPlaat', 'kantToeslag', 'secPerKant', 'snelheid', 'tussenruimte', 'wisselMin']) reken[k] = n(p.reken[k]);
  const kanten = (Array.isArray(p.kanten) ? p.kanten : []).slice(0, 500).map(k => naamVan(k, 80)).filter(Boolean);
  const materialen = p.materialen.map(m => ({ id: String(m && m.id || '').slice(0, 60), naam: naamVan(m && m.naam, 80), dikte: n(m && m.dikte), l: n(m && m.l), b: n(m && m.b), nerf: !!(m && m.nerf), kant: kanten.includes(naamVan(m && m.kant, 80)) ? naamVan(m.kant, 80) : '', opStock: !!(m && m.opStock), voorraad: Math.max(0, Math.round(n(m && m.voorraad))) })).filter(m => m.id && m.naam && m.dikte > 0 && m.l > 0 && m.b > 0);
  const klanten = {};
  for (const afk of Object.keys(p.klanten).slice(0, 500)) {
    const k = p.klanten[afk] || {}, pm2 = {}, kant = {};
    for (const m of materialen) { pm2[m.id] = n((k.pm2 || {})[m.id]); kant[m.id] = {}; const bron = (k.kant || {})[m.id]; if (bron && typeof bron === 'object') for (const kn of kanten) if (n(bron[kn]) > 0) kant[m.id][kn] = n(bron[kn]); }
    klanten[String(afk).toUpperCase().slice(0, 12)] = { zaagUur: n(k.zaagUur), kantUur: n(k.kantUur), lijm: n(k.lijm), pm2, kant };
  }
  return { reken, materialen, kanten, klanten };
}

// regels: [{ mat, l, b, aantal, nerf, kant, kanten: {l1, l2, b1, b2} }] in de volgorde van het formulier. kant = de naam
// van de gekozen kant, leeg = de standaardkant van de plaat.
// Geeft { totaal (null = prijs op aanvraag), waarom: [...], regels: [{ stock: 'ja' | 'nee' | '' }], platen }.
function richtprijs(prijs, afk, regels) {
  const uit = { totaal: null, waarom: [], regels: regels.map(() => ({ stock: '' })), platen: 0 };
  const k = prijs && prijs.klanten[afk];
  if (!prijs || !k) { uit.waarom.push('Voor deze lijst maken wij een prijs op aanvraag.'); return uit; }
  const r = prijs.reken, groepen = new Map();
  regels.forEach((o, i) => {
    const m = o.mat ? prijs.materialen.find(x => x.id === o.mat) : null;
    if (!m) { uit.waarom.push(`Regel ${i + 1}: ander materiaal, prijs op aanvraag.`); return; }
    if (!(k.pm2[m.id] > 0)) { uit.waarom.push(`Regel ${i + 1}: voor dit materiaal maken wij een prijs op aanvraag.`); return; }
    if (!groepen.has(m.id)) groepen.set(m.id, { m, delen: [] });
    groepen.get(m.id).delen.push({ i, l: n(o.l), b: n(o.b), aantal: Math.round(n(o.aantal)), nerf: o.nerf === true || m.nerf, kant: naamVan(o.kant, 80) || m.kant, kanten: o.kanten || {} });
  });
  let plaat = 0, zaagSec = 0, kantMat = 0, kantStuks = 0, kantMeter = 0, mmMeter = 0;
  const soorten = new Set();                                                      // elke kant per plaatdikte is één wissel aan de kantenlijmer
  for (const { m, delen } of groepen.values()) {
    const z = Zaagplan.bereken(delen.map(d => ({ l: d.l, b: d.b, aantal: d.aantal, nerf: d.nerf, id: String(d.i) })), { l: m.l, b: m.b }, { snede: r.snede, boord: r.boord, secPerSnede: r.secPerSnede, zaagMeterPerMin: r.meterPerMin, secPerPlaat: r.secPerPlaat });
    if (z.fout) {
      const groot = new Set((z.nietPassend || []).map(d => d.id));
      for (const d of delen) if (!groot.size || groot.has(String(d.i))) uit.waarom.push(`Regel ${d.i + 1}: dit stuk past niet op een plaat van ${m.l} × ${m.b} mm${d.nerf ? ' met de nerf in de lengte' : ''}.`);
      continue;
    }
    plaat += z.bruto * k.pm2[m.id]; zaagSec += z.zaagtijdSec; uit.platen += z.platen;
    // stock: genoeg volledige platen liggen klaar voor al de regels van dit materiaal samen
    const genoeg = m.opStock && m.voorraad >= z.platen;
    for (const d of delen) uit.regels[d.i].stock = genoeg ? 'ja' : 'nee';
    for (const d of delen) {
      let stuks = 0, meter = 0;
      for (const [zijde, lengte] of [['l1', d.l], ['l2', d.l], ['b1', d.b], ['b2', d.b]]) if (d.kanten[zijde] === true) { stuks += d.aantal; meter += d.aantal * (lengte + r.kantToeslag) / 1000; }
      if (!stuks) continue;
      if (!d.kant) { uit.waarom.push(`Regel ${d.i + 1}: kies een kant voor dit materiaal.`); continue; }
      const kp = (k.kant[m.id] || {})[d.kant];
      if (!(kp > 0)) { uit.waarom.push(`Regel ${d.i + 1}: voor deze kant maken wij een prijs op aanvraag.`); continue; }
      soorten.add(d.kant + '|' + m.dikte); kantStuks += stuks; kantMeter += meter; mmMeter += meter * m.dikte; kantMat += meter * kp;
    }
  }
  if (uit.waarom.length) return uit;
  const nettoMeter = Math.max(0, kantMeter - kantStuks * r.kantToeslag / 1000);
  const kantUren = kantStuks ? (kantStuks * r.secPerKant + (nettoMeter + kantStuks * r.tussenruimte) / Math.max(1, r.snelheid) * 60 + soorten.size * r.wisselMin * 60) / 3600 : 0;
  const totaal = plaat + zaagSec / 3600 * k.zaagUur + kantMat + mmMeter * k.lijm + kantUren * k.kantUur;
  uit.totaal = Math.round(totaal * 100) / 100;
  return uit;
}
module.exports = { schoon, richtprijs };
