// Zaagplanberekening voor de opdeelzaag (Mayer PS80).
// Rekent hoeveel platen er nodig zijn voor een lijst stukken, met doorlopende zaagsneden (stroken).
// Werkt in de browser (window.Zaagplan) en in Node (module.exports).
(function (root) {
  'use strict';

  const standaard = {
    snede: 4.4,            // breedte van de zaagsnede in mm
    boord: 10,             // schoonzaagsnede rondom de plaat in mm
    maxLengte: 4300,       // grootste plaat die op de zaag kan
    secPerSnede: 65,       // handwerk per zaagsnede (geijkt op de zaagtijden van Ardis)
    zaagMeterPerMin: 30,   // zaagsnelheid
    secPerPlaat: 240       // plaat opleggen en resten wegnemen
  };

  // Eén poging: stroken over de lengte van de plaat. stukken = [{l, b, id}] (al uitgeklapt per stuk).
  function vulPlaten(stukken, plaatL, plaatB, snede) {
    const platen = [];
    const rest = stukken.slice().sort((a, b) => b.b - a.b || b.l - a.l);
    const past = (s) => s.l <= plaatL + 1e-6 && s.b <= plaatB + 1e-6;
    for (const s of rest) if (!past(s)) return null;
    const gebruikt = new Array(rest.length).fill(false);
    let over = rest.length;
    while (over > 0) {
      const plaat = { stroken: [], hoogte: 0 };
      // stroken stapelen over de breedte van de plaat
      for (;;) {
        const vrij = plaatB - plaat.hoogte;
        // hoogste stuk dat nog past bepaalt de strookhoogte
        let eerste = -1;
        for (let i = 0; i < rest.length; i++) if (!gebruikt[i] && rest[i].b <= vrij + 1e-6) { eerste = i; break; }
        if (eerste < 0) break;
        const h = rest[eerste].b;
        const strook = { y: plaat.hoogte, h, delen: [], x: 0 };
        // strook van links naar rechts vullen; in elke kolom kleinere stukken stapelen
        for (let i = eerste; i < rest.length; i++) {
          if (gebruikt[i]) continue;
          const s = rest[i];
          if (s.b > h + 1e-6 || s.l > plaatL - strook.x + 1e-6) continue;
          gebruikt[i] = true; over--;
          const kolomX = strook.x, kolomB = s.l;
          let y = s.b + snede;
          strook.delen.push({ x: kolomX, y: strook.y, l: s.l, b: s.b, id: s.id });
          for (let j = i + 1; j < rest.length; j++) {
            if (gebruikt[j]) continue;
            const t = rest[j];
            if (t.l <= kolomB + 1e-6 && t.b <= h - y + 1e-6) {
              gebruikt[j] = true; over--;
              strook.delen.push({ x: kolomX, y: strook.y + y, l: t.l, b: t.b, id: t.id });
              y += t.b + snede;
            }
          }
          strook.x += kolomB + snede;
        }
        plaat.stroken.push(strook);
        plaat.hoogte += h + snede;
      }
      if (!plaat.stroken.length) return null;
      platen.push(plaat);
    }
    return platen;
  }

  // onderdelen = [{l, b, aantal, nerf, id}] ; plaat = {l, b}
  function bereken(onderdelen, plaat, opties) {
    const o = Object.assign({}, standaard, opties || {});
    // boord: schoonzaagsnede per zijde. boordL en boordB kunnen apart opgegeven worden (bv. bij een rest).
    const boordL = o.boordL != null ? o.boordL : o.boord, boordB = o.boordB != null ? o.boordB : o.boord;
    const L = plaat.l - 2 * boordL, B = plaat.b - 2 * boordB;
    const stukken = [];
    let netto = 0, nietPassend = [];
    for (const d of onderdelen) {
      const aantal = Math.max(0, Math.round(d.aantal || 0));
      for (let i = 0; i < aantal; i++) stukken.push({ l: d.l, b: d.b, nerf: !!d.nerf, id: d.id });
      netto += aantal * d.l * d.b;
      const pastRecht = d.l <= L && d.b <= B, pastGedraaid = !d.nerf && d.b <= L && d.l <= B;
      if (aantal && !pastRecht && !pastGedraaid) nietPassend.push(d);
    }
    if (nietPassend.length) return { fout: 'past niet op de plaat', nietPassend, platen: 0 };
    if (!stukken.length) return { platen: 0, netto: 0, bruto: 0, benutting: 0, sneden: 0, zaagMeter: 0, zaagtijdSec: 0, tekening: [] };

    // verschillende manieren proberen en de beste houden
    const pogingen = [];
    const richtingen = [
      s => ({ l: s.l, b: s.b, id: s.id }),                                             // alles zoals opgegeven
      s => (s.nerf || s.b > L || s.l > B) ? { l: s.l, b: s.b, id: s.id } : { l: s.b, b: s.l, id: s.id },   // alles gedraaid waar het mag
      s => (!s.nerf && s.b > s.l && s.b <= L && s.l <= B) ? { l: s.b, b: s.l, id: s.id } : { l: s.l, b: s.b, id: s.id }, // langste zijde langs de plaat
      s => (!s.nerf && s.l > s.b && s.b <= L && s.l <= B) ? { l: s.b, b: s.l, id: s.id } : { l: s.l, b: s.b, id: s.id }  // kortste zijde langs de plaat
    ];
    for (const r of richtingen) {
      const lijst = stukken.map(s => { const t = r(s); return (t.l <= L && t.b <= B) ? t : { l: s.l, b: s.b, id: s.id }; });
      const a = vulPlaten(lijst, L, B, o.snede);
      if (a) pogingen.push({ platen: a, gedraaid: false });
      const lijst2 = lijst.map(s => ({ l: s.b, b: s.l, id: s.id }));     // stroken over de breedte in plaats van de lengte
      const b = vulPlaten(lijst2, B, L, o.snede);
      if (b) pogingen.push({ platen: b, gedraaid: true });
    }
    if (!pogingen.length) return { fout: 'geen zaagplan gevonden', platen: 0 };
    const vulling = p => { const laatste = p.platen[p.platen.length - 1]; return laatste.hoogte; };
    pogingen.sort((a, b) => a.platen.length - b.platen.length || vulling(a) - vulling(b));
    const beste = pogingen[0];

    // sneden tellen: per plaat de stroken, per strook de kolommen, per kolom de stukken
    let sneden = 0, zaagMeter = 0;
    const pl = beste.gedraaid ? B : L, pb = beste.gedraaid ? L : B;
    const tekening = [];
    for (const p of beste.platen) {
      const delen = [];
      for (const s of p.stroken) {
        sneden += 1; zaagMeter += pl / 1000;
        const kolommen = new Map();
        for (const d of s.delen) { if (!kolommen.has(d.x)) kolommen.set(d.x, []); kolommen.get(d.x).push(d); }
        for (const [, k] of kolommen) {
          sneden += 1; zaagMeter += s.h / 1000;
          for (const d of k) { if (k.length > 1 || d.b < s.h - 0.5) { sneden += 1; zaagMeter += d.l / 1000; } delen.push(d); }
        }
      }
      tekening.push(delen.map(d => beste.gedraaid ? { x: d.y, y: d.x, l: d.b, b: d.l, id: d.id } : d));
    }
    const n = beste.platen.length;
    const bruto = n * plaat.l * plaat.b;
    const zaagtijdSec = sneden * o.secPerSnede + zaagMeter / o.zaagMeterPerMin * 60 + n * o.secPerPlaat;
    return { platen: n, netto: netto / 1e6, bruto: bruto / 1e6, benutting: netto / bruto * 100, sneden, zaagMeter, zaagtijdSec, tekening, plaat: { l: plaat.l, b: plaat.b }, boord: o.boord };
  }

  const api = { standaard, bereken };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Zaagplan = api;
})(typeof window !== 'undefined' ? window : this);
