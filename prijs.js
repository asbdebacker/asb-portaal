// Richtprijs voor een zaaglijst in het klantenportaal. Zelfde rekenwijze als Prijsaanvraag > Calculatie in het
// werkplatform (reken.js en zaagplan.js daar): platen via het zaagplan en volledig aangerekend (nooit met resten),
// zaagtijd, kantenband, lijm en de tijd aan de kantenlijmer. Het portaal kent alleen verkoopwaarden per klant;
// de inkoopprijzen en de factoren blijven op kantoor. De klant krijgt alleen het totaal te zien.
// zaagplan.js is een ongewijzigde kopie van public/zaagplan.js uit het werkplatform: hou ze gelijk.
'use strict';
const Zaagplan = require('./zaagplan.js');
const n = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; };

// Wat kantoor stuurt nakijken; bij twijfel geen prijslijst (dan is alles "prijs op aanvraag").
function schoon(p) {
  if (!p || typeof p !== 'object' || !p.reken || !Array.isArray(p.materialen) || !p.klanten || typeof p.klanten !== 'object' || p.materialen.length > 2000) return null;
  const reken = {}; for (const k of ['snede', 'boord', 'secPerSnede', 'meterPerMin', 'secPerPlaat', 'kantToeslag', 'secPerKant', 'snelheid', 'tussenruimte', 'wisselMin']) reken[k] = n(p.reken[k]);
  const materialen = p.materialen.map(m => ({ id: String(m && m.id || '').slice(0, 60), naam: String(m && m.naam || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 80), dikte: n(m && m.dikte), l: n(m && m.l), b: n(m && m.b), nerf: !!(m && m.nerf), opStock: !!(m && m.opStock), voorraad: Math.max(0, Math.round(n(m && m.voorraad))) })).filter(m => m.id && m.naam && m.dikte > 0 && m.l > 0 && m.b > 0);
  const klanten = {};
  for (const afk of Object.keys(p.klanten).slice(0, 500)) {
    const k = p.klanten[afk] || {}, pm2 = {}, kant = {};
    for (const m of materialen) { pm2[m.id] = n((k.pm2 || {})[m.id]); kant[m.id] = n((k.kant || {})[m.id]); }
    klanten[String(afk).toUpperCase().slice(0, 12)] = { zaagUur: n(k.zaagUur), kantUur: n(k.kantUur), lijm: n(k.lijm), pm2, kant };
  }
  return { reken, materialen, klanten };
}

// regels: [{ mat, l, b, aantal, nerf, kanten: {l1, l2, b1, b2} }] in de volgorde van het formulier.
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
    groepen.get(m.id).delen.push({ i, l: n(o.l), b: n(o.b), aantal: Math.round(n(o.aantal)), nerf: o.nerf === true || m.nerf, kanten: o.kanten || {} });
  });
  let plaat = 0, zaagSec = 0, kantMat = 0, kantStuks = 0, kantMeter = 0, mmMeter = 0, soorten = 0;
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
    let stuks = 0, meter = 0;
    for (const d of delen) for (const [zijde, lengte] of [['l1', d.l], ['l2', d.l], ['b1', d.b], ['b2', d.b]]) if (d.kanten[zijde] === true) { stuks += d.aantal; meter += d.aantal * (lengte + r.kantToeslag) / 1000; }
    if (stuks) {
      if (!(k.kant[m.id] > 0)) { for (const d of delen) if (Object.values(d.kanten).some(v => v === true)) uit.waarom.push(`Regel ${d.i + 1}: voor de kantenband op dit materiaal maken wij een prijs op aanvraag.`); continue; }
      soorten++; kantStuks += stuks; kantMeter += meter; mmMeter += meter * m.dikte; kantMat += meter * k.kant[m.id];
    }
  }
  if (uit.waarom.length) return uit;
  const nettoMeter = Math.max(0, kantMeter - kantStuks * r.kantToeslag / 1000);
  const kantUren = kantStuks ? (kantStuks * r.secPerKant + (nettoMeter + kantStuks * r.tussenruimte) / Math.max(1, r.snelheid) * 60 + soorten * r.wisselMin * 60) / 3600 : 0;
  const totaal = plaat + zaagSec / 3600 * k.zaagUur + kantMat + mmMeter * k.lijm + kantUren * k.kantUur;
  uit.totaal = Math.round(totaal * 100) / 100;
  return uit;
}
module.exports = { schoon, richtprijs };
