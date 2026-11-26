// Bouwt de website van ASB De Backer: gewone pagina's (HTML en CSS), zonder pakketten.
// Gebruik: node bouw.js   -> schrijft de pagina's in de map site. De teksten staan hieronder, per pagina.
// Foto's staan in site\foto; zolang een foto ontbreekt, staat er een grijs vlak met de omschrijving.
'use strict';
const fs = require('fs'), path = require('path');
const UIT = path.join(__dirname, 'site');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BEDRIJF = { naam: 'ASB De Backer', straat: 'Atealaan 22', gemeente: '2270 Herenthout', tel: '014 21 73 31', telLink: '+3214217331', mail: 'info@asbdebacker.be', kaart: 'https://www.google.be/maps/place/Atealaan+22+2270+Herenthout', btw: 'BTW BE 0686.799.293' };
// NOG IN TE VULLEN door Axel. Zolang de naam leeg is, staat er alleen dat particulieren ons mogen contacteren.
const PARTNER = { naam: '', url: '' };
// NOG IN TE VULLEN door Axel: het grootste formaat per soort werk, bv. { werk: 'Plaatwerk frezen (nesting)', formaat: '4600 × 2200 mm' }.
// Zolang de lijst leeg is, komt het blok "Maximale formaten" niet op de site.
const FORMATEN = [];
// Het contactformulier staat pas op de site als de berichten ook echt bij het bureau aankomen (doormailen is nog niet gebouwd).
const FORMULIER_AAN = false;
// Zolang de site een proefversie is (op asbdebacker.eu), vragen we zoekmachines om ze niet op te nemen. Zet op false bij de echte start.
const PROEF = true;
const MENU = [['index.html', 'Home'], ['professionals.html', 'Voor professionals'], ['realisaties.html', 'Realisaties'], ['werkwijze.html', 'Werkwijze'], ['contact.html', 'Contact']];

const foto = (bestand, omschrijving, klasse) => bestand && fs.existsSync(path.join(UIT, 'foto', bestand))
  ? `<img class="foto ${klasse || ''}" src="foto/${esc(bestand)}" alt="${esc(omschrijving)}" loading="lazy">`
  : `<div class="foto leeg ${klasse || ''}" role="img" aria-label="${esc(omschrijving)}"><span>Foto: ${esc(omschrijving)}</span></div>`;
const knop = (href, tekst, soort) => `<a class="knop ${soort || ''}" href="${href}">${esc(tekst)}</a>`;

function pagina(bestand, titel, beschrijving, inhoud) {
  const nav = MENU.map(([h, t]) => `<a href="${h}"${h === bestand ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} – ${BEDRIJF.naam}</title>
<meta name="description" content="${esc(beschrijving)}">${PROEF ? `\n<meta name="robots" content="noindex, nofollow">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="stijl.css">
</head>
<body>
<a class="spring" href="#inhoud">Naar de inhoud</a>
<header class="kop"><div class="binnen">
  <a class="merk" href="index.html"><img src="logo.jpg" alt="${BEDRIJF.naam}" width="92" height="69"></a>
  <input type="checkbox" id="menuknop" hidden><label for="menuknop" class="menuknop" aria-label="Menu">Menu</label>
  <nav aria-label="Hoofdmenu">${nav}<a class="portaal" href="portaal.html">Klantenportaal</a></nav>
</div></header>
<main id="inhoud">
${inhoud}
</main>
<footer class="voet"><div class="binnen">
  <div><b>${BEDRIJF.naam}</b><br>${BEDRIJF.straat}<br>${BEDRIJF.gemeente}<br>${esc(BEDRIJF.btw)}</div>
  <div><a href="tel:${BEDRIJF.telLink}">${BEDRIJF.tel}</a><br><a href="mailto:${BEDRIJF.mail}">${BEDRIJF.mail}</a><br><a href="${BEDRIJF.kaart}" rel="noopener">Route</a></div>
  <div>${MENU.map(([h, t]) => `<a href="${h}">${t}</a>`).join('<br>')}</div>
  <div><a href="privacy.html">Privacy</a><br><a href="portaal.html">Klantenportaal</a></div>
</div></footer>
</body>
</html>
`;
}
const sectie = (kop, inhoud, klasse) => `<section class="sectie ${klasse || ''}"><div class="binnen">${kop ? `<h2>${kop}</h2>` : ''}${inhoud}</div></section>`;
const kaarten = lijst => `<div class="kaarten">${lijst.map(k => `<article class="kaart">${k.foto !== undefined ? foto(k.foto, k.fotoTekst || k.titel) : ''}<h3>${k.titel}</h3><p>${k.tekst}</p>${k.link ? `<a href="${k.link[0]}">${k.link[1]} →</a>` : ''}</article>`).join('')}</div>`;
const afsluiter = (kop, tekst) => sectie('', `<div class="oproep"><div><h2>${kop}</h2><p>${tekst}</p></div><div class="knoppen">${knop('contact.html', 'Neem contact op', 'hoofd')}${knop('tel:' + BEDRIJF.telLink, BEDRIJF.tel)}</div></div>`, 'donker');
// particulieren: doorverwijzen naar een partner, en ze mogen ook ons contacteren
const particulier = () => `<div class="kader particulier"><h3>Bent u particulier?</h3><p>Wij werken in de eerste plaats voor vakmensen. ${PARTNER.naam
  ? `Voor een keuken, kast of interieur bij u thuis verwijzen wij u graag door naar onze partner <a href="${esc(PARTNER.url)}" rel="noopener">${esc(PARTNER.naam)}</a>. Liever eerst met ons overleggen? Dat kan ook.`
  : 'Hebt u als particulier een project? Neem contact op, dan bekijken wij samen wie u het best kan helpen.'}</p>${knop('contact.html?wie=particulier#formulier', 'Contacteer ons')}</div>`;
const formaten = () => FORMATEN.length ? sectie('Maximale formaten', `<div class="tabelwrap"><table class="formaten"><thead><tr><th>Soort werk</th><th>Grootste formaat</th></tr></thead><tbody>${FORMATEN.map(f => `<tr><td>${esc(f.werk)}</td><td>${esc(f.formaat)}</td></tr>`).join('')}</tbody></table></div><p class="klein">Groter of anders? Vraag het ons: vaak is er een oplossing.</p>`, 'licht') : '';

// ---------------------------------------------------------------- de pagina's
const P = {};

P['index.html'] = ['Maatwerk in hout en plaat voor professionals', 'ASB De Backer in Herenthout maakt onderdelen en afgewerkte meubels op maat, tot op de millimeter, voor interieurbouwers, architecten en schrijnwerkers.', `
<section class="held"><div class="binnen">
  <div>
    <p class="boventitel">Schrijnwerkerij in Herenthout · al 30 jaar</p>
    <h1>Maatwerk dat klopt tot op de millimeter</h1>
    <p class="intro">Wij maken onderdelen en afgewerkte meubels op maat, in massief hout en plaatmateriaal. Voor interieurbouwers, architecten en collega-schrijnwerkers die een betrouwbaar atelier zoeken voor wat ze zelf niet kunnen of willen maken.</p>
    <div class="knoppen">${knop('professionals.html', 'Voor professionals', 'hoofd')}${knop('realisaties.html', 'Bekijk realisaties')}</div>
  </div>
  ${foto('home.jpg', 'een gebogen profiel in massief hout, gefreesd op de CNC-machine', 'groot')}
</div></section>
${sectie('Wat wij voor u doen', kaarten([
  { titel: 'Onderdelen op maat', tekst: 'Gezaagd en gefreesd volgens uw tekening of lijst, klaar om zelf te monteren.', link: ['professionals.html', 'Voor professionals'] },
  { titel: 'Speciale vormen', tekst: 'Gebogen, geprofileerde en driedimensionale stukken in massief hout: werk waarvoor niet elk atelier de machines heeft.', link: ['realisaties.html', 'Realisaties'] },
  { titel: 'Afgewerkte meubels', tekst: 'Kasten, bladen en ander meubilair, in ons atelier gemaakt en afgewerkt naar uw ontwerp.', link: ['werkwijze.html', 'Werkwijze'] }
]))}
${sectie('Waarom ASB De Backer', `<div class="punten">
  <div><b>Alles op maat, tot op de millimeter</b><p>Geen standaardmaten. Elk stuk wordt gemaakt volgens uw tekening.</p></div>
  <div><b>Eigen atelier</b><p>Zagen, frezen en afwerken gebeuren bij ons. Zo houden wij kwaliteit en termijn zelf in de hand.</p></div>
  <div><b>30 jaar vakkennis</b><p>Massief hout, fineer, melamine en laminaat: wij kennen het materiaal en zeggen het als iets beter anders kan.</p></div>
</div>`, 'licht')}
${sectie('', particulier())}
${afsluiter('Een project of een lijst met onderdelen?', 'Stuur ons uw tekening, schets of stuklijst. U krijgt een offerte op maat.')}
`];

P['professionals.html'] = ['Voor professionals', 'Onderdelen en afgewerkte meubels op maat voor interieurbouwers, architecten en schrijnwerkers: zagen, CNC-frezen, massief hout en afwerking.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Voor interieurbouwers, architecten en schrijnwerkers</p><h1>Uw ontwerp, ons atelier</h1>
<p class="intro">U ontwerpt en verkoopt, wij maken. Dat kan een pakket onderdelen zijn dat u zelf monteert, of een volledig afgewerkt meubel. U kiest hoe ver wij gaan.</p></div></section>
${sectie('Wat u bij ons kunt laten doen', kaarten([
  { titel: 'Plaatmateriaal op maat', foto: 'materialen.jpg', fotoTekst: 'stalen van plaatmateriaal en fineer', tekst: 'Gezaagd of gefreesd uit de volle plaat volgens uw lijst: rechthoekige stukken, vormen, uitsparingen en boringen voor beslag.' },
  { titel: 'Gebogen en gevormde stukken', foto: 'gebogen.jpg', fotoTekst: 'een gebogen onderdeel in massief hout op de machine', tekst: 'Bogen, profielen en driedimensionale vormen in massief hout, gefreesd op de CNC-machine.' },
  { titel: 'Massief hout en fineer', foto: 'massief.jpg', fotoTekst: 'een ronde vorm gefreesd uit massief hout', tekst: 'Naast melamine en laminaat verwerken wij massief hout en gefineerde platen.' },
  { titel: 'Afwerking en montage', foto: 'bladen.jpg', fotoTekst: 'afgewerkte bladen in het atelier', tekst: 'Wilt u een afgewerkt geheel? Wij monteren en werken af in het atelier.' },
  { titel: 'Speciale onderdelen', foto: 'frezen3d.jpg', fotoTekst: 'een golvend profiel gefreesd uit massief hout', tekst: 'Een onderdeel dat u zelf niet kunt maken of waarvoor uw machines niet geschikt zijn: vraag het ons.' },
  { titel: 'Op de millimeter', foto: 'maat.jpg', fotoTekst: 'een onderdeel wordt nagemeten met een schuifmaat', tekst: 'Wij maken alles op maat, tot op de millimeter, en meten na wat de deur uitgaat.' }
]))}
${formaten()}
${sectie('Zo werkt het', `<ol class="stappen">
  <li><b>U bezorgt uw gegevens</b><p>Een tekening, een stuklijst of een schets met maten.</p></li>
  <li><b>Wij maken een offerte</b><p>Met materiaal, bewerkingen en een datum. Onduidelijkheden bespreken we vooraf, niet achteraf.</p></li>
  <li><b>Productie in ons atelier</b><p>Elk onderdeel krijgt een etiket met uw referentie, zodat u bij de montage niet moet zoeken.</p></li>
  <li><b>U haalt af</b><p>Uw bestelling staat klaar in Herenthout. Wij verwittigen u zodra u ze kunt ophalen.</p></li>
</ol>`, 'licht')}
${sectie('Klantenportaal', `<p class="smal">Wij bouwen aan een portaal voor onze vaste klanten. U zult er de stand van uw projecten kunnen volgen, en later ook zaaglijsten kunnen bestellen.</p><div class="knoppen">${knop('portaal.html', 'Meer over het portaal')}</div>`)}
${afsluiter('Werkt u aan een project?', 'Stuur uw tekening of lijst door. Wij bekijken wat wij voor u kunnen maken.')}
`];

P['realisaties.html'] = ['Realisaties', 'Werk uit het atelier van ASB De Backer: gebogen en gefreesde stukken in massief hout, kasten, bladen en deuren op maat.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Realisaties</p><h1>Werk uit ons atelier</h1>
<p class="intro">Een greep uit wat wij maken. De meeste stukken vertrekken als onderdeel of als afgewerkt meubel naar een interieurbouwer of schrijnwerker.</p></div></section>
${sectie('', kaarten([
  { titel: 'Driedimensionaal freeswerk', foto: 'frezen3d.jpg', fotoTekst: 'een golvend profiel gefreesd uit massief hout', tekst: 'Profielen en vormen die uit een massief blok gefreesd worden.' },
  { titel: 'Gebogen onderdelen', foto: 'gebogen.jpg', fotoTekst: 'een gebogen onderdeel in massief hout', tekst: 'Bogen en gebogen lijsten in massief hout, op maat van uw ontwerp.' },
  { titel: 'Vormen uit massief hout', foto: 'massief.jpg', fotoTekst: 'een ronde vorm gefreesd uit massief hout', tekst: 'Ronde en organische vormen, opgebouwd en gefreesd uit massief hout.' },
  { titel: 'Kasten op maat', foto: 'kast.jpg', fotoTekst: 'een kastenwand onder een schuin dak', tekst: 'Kasten en kastenwanden, ook onder een schuin dak of in een moeilijke hoek.' },
  { titel: 'Bladen', foto: 'bladen.jpg', fotoTekst: 'afgewerkte bladen in het atelier', tekst: 'Tafelbladen en werkbladen in fineer en massief hout, afgewerkt in ons atelier.' },
  { titel: 'Deuren en panelen', foto: 'deuren.jpg', fotoTekst: 'deuren en panelen in het atelier', tekst: 'Deuren en panelen op maat, met of zonder profilering.' }
]))}
${afsluiter('Iets gelijkaardigs in gedachten?', 'Vertel ons wat u zoekt. Wij denken mee over materiaal, afwerking en budget.')}
`];

P['werkwijze.html'] = ['Werkwijze', 'Hoe een opdracht bij ASB De Backer verloopt: van tekening en offerte over productie tot afhaling.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Werkwijze</p><h1>Van tekening tot afgewerkt stuk</h1>
<p class="intro">Elke opdracht verloopt in dezelfde duidelijke stappen. Zo weet u altijd waar u staat.</p></div></section>
${sectie('', `<ol class="stappen">
  <li><b>Uw vraag</b><p>U bezorgt een tekening, een stuklijst of een schets met maten, en vertelt wat u nodig hebt.</p></li>
  <li><b>Materiaalkeuze</b><p>Samen leggen we materiaal en afwerking vast: massief hout, fineer, melamine of laminaat.</p></li>
  <li><b>Offerte</b><p>U krijgt een duidelijke offerte. Pas na uw akkoord starten wij.</p></li>
  <li><b>Tekenen en voorbereiden</b><p>Wij tekenen het werk volledig uit in 3D. Uit die tekening komen de programma's voor de machines.</p></li>
  <li><b>Productie</b><p>Zagen, frezen, afwerken en monteren gebeuren in ons atelier in Herenthout.</p></li>
  <li><b>Afhalen</b><p>Uw bestelling staat klaar in ons atelier. Wij verwittigen u zodra u ze kunt ophalen.</p></li>
</ol>`)}
${sectie('Van scherm naar machine', `<div class="tweekol">${foto('tekenen.jpg', 'een onderdeel wordt voorbereid op het scherm', 'groot')}<div><p>Elk stuk wordt eerst getekend en op het scherm voorbereid. De machines werken rechtstreeks vanuit die tekening. Dat geeft maatvaste onderdelen en weinig fouten.</p><p>Wij maken alles op maat, tot op de millimeter. Elk stuk krijgt een etiket met uw referentie, zodat het bij de montage meteen op de juiste plaats terechtkomt.</p></div></div>`, 'licht')}
${formaten()}
${sectie('', `<div class="tweekol"><div><h2>Ons atelier</h2><p>In ons atelier in Herenthout zagen, frezen en werken wij af onder één dak. U bent welkom om uw project ter plaatse te bespreken.</p><div class="knoppen">${knop('contact.html', 'Maak een afspraak', 'hoofd')}</div></div>${foto('atelier.jpg', 'de CNC-machine in het atelier', 'groot')}</div>`)}
${afsluiter('Klaar om te starten?', 'Neem contact op voor een eerste gesprek of een offerte.')}
`];

P['contact.html'] = ['Contact', 'Contacteer ASB De Backer, Atealaan 22, 2270 Herenthout. Telefoon 014 21 73 31.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Contact</p><h1>Vertel ons over uw project</h1>
<p class="intro">${FORMULIER_AAN ? "Bel, mail of gebruik het formulier." : "Bel of mail ons."} Stuurt u een tekening, schets of stuklijst mee, dan kunnen wij sneller een offerte maken.</p></div></section>
${sectie('', `<div class="tweekol">
  ${FORMULIER_AAN ? `<form id="formulier" class="kader formulier" method="post" action="/api/contact" novalidate>
    <h3>Stuur ons een bericht</h3>
    <label>Ik ben<select name="wie" id="f-wie"><option value="professional">een professional (interieurbouwer, architect, schrijnwerker)</option><option value="particulier">een particulier</option></select></label>
    <label>Naam<input name="naam" autocomplete="name" required maxlength="80"></label>
    <label>Bedrijf <span class="klein">(als u een professional bent)</span><input name="bedrijf" autocomplete="organization" maxlength="80"></label>
    <label>E-mail<input name="mail" type="email" autocomplete="email" required maxlength="120"></label>
    <label>Telefoon<input name="tel" type="tel" autocomplete="tel" maxlength="30"></label>
    <label>Uw vraag<textarea name="bericht" rows="6" required maxlength="4000"></textarea></label>
    <label class="niet-invullen" aria-hidden="true">Laat dit veld leeg<input name="website" tabindex="-1" autocomplete="off"></label>
    <label class="vink"><input type="checkbox" name="akkoord" required><span>Ik ga akkoord dat ASB De Backer mijn gegevens gebruikt om mijn vraag te beantwoorden (<a href="privacy.html">privacy</a>).</span></label>
    <button class="knop hoofd" type="submit">Verstuur</button>
    <p class="klein">Een tekening of lijst meesturen? Mail ze naar <a href="mailto:${BEDRIJF.mail}">${BEDRIJF.mail}</a>.</p>
    <p id="f-melding" role="status" aria-live="polite"></p>
  </form>` : `<div id="formulier" class="kader"><h3>Wat helpt ons bij een offerte</h3><ul><li>Een tekening, schets of foto met de maten</li><li>Het materiaal en de afwerking die u wenst</li><li>Of u onderdelen wilt of een afgewerkt geheel</li><li>De gewenste termijn</li><li>Voor professionals: uw stuklijst of zaaglijst</li></ul><div class="knoppen">${knop("mailto:" + BEDRIJF.mail + "?subject=Aanvraag%20via%20de%20website", "Mail ons", "hoofd")}${knop("tel:" + BEDRIJF.telLink, BEDRIJF.tel)}</div></div>`}
  <div>
    <div class="contactblok">
      <p><span>Telefoon</span><a class="grootlink" href="tel:${BEDRIJF.telLink}">${BEDRIJF.tel}</a></p>
      <p><span>E-mail</span><a class="grootlink" href="mailto:${BEDRIJF.mail}?subject=Aanvraag%20via%20de%20website">${BEDRIJF.mail}</a></p>
      <p><span>Adres</span>${BEDRIJF.naam}<br>${BEDRIJF.straat}<br>${BEDRIJF.gemeente}<br><a href="${BEDRIJF.kaart}" rel="noopener">Route op de kaart</a></p>
    </div>
    ${particulier().replace(/<a class="knop[^>]*>[^<]*<\/a>/, '')}
  </div>
</div>
${FORMULIER_AAN ? `<script>
(function(){
  var f = document.getElementById('formulier'), m = document.getElementById('f-melding');
  if (new URLSearchParams(location.search).get('wie') === 'particulier') document.getElementById('f-wie').value = 'particulier';
  f.addEventListener('submit', function(e){
    e.preventDefault(); m.className = ''; m.textContent = '';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    var d = {}; new FormData(f).forEach(function(v, k){ d[k] = v; });
    var k = f.querySelector('button'); k.disabled = true; k.textContent = 'Bezig…';
    fetch('/api/contact', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d)})
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return {ok: r.ok, j: j}; }); })
      .then(function(r){ if (r.ok) { f.reset(); m.className = 'goed'; m.textContent = 'Bedankt, uw bericht is goed aangekomen. Wij nemen zo snel mogelijk contact op.'; } else { m.className = 'fout'; m.textContent = r.j.fout || 'Het versturen is niet gelukt. Bel of mail ons gerust.'; } })
      .catch(function(){ m.className = 'fout'; m.textContent = 'Het versturen is niet gelukt. Bel of mail ons gerust.'; })
      .then(function(){ k.disabled = false; k.textContent = 'Verstuur'; });
  });
})();
</script>` : ""}`)}
`];

P['portaal.html'] = ['Klantenportaal', 'Het klantenportaal van ASB De Backer voor vaste zakelijke klanten is in opbouw.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Klantenportaal</p><h1>In opbouw</h1>
<p class="intro">Wij bouwen aan een portaal voor onze vaste zakelijke klanten. U zult er de stand van uw projecten kunnen volgen. Later komen daar het bestellen van zaaglijsten en een configurator bij.</p>
<div class="knoppen">${knop('contact.html', 'Neem contact op', 'hoofd')}</div></div></section>
`];

P['privacy.html'] = ['Privacy', 'Hoe ASB De Backer omgaat met uw gegevens.', `
<section class="paginakop"><div class="binnen"><p class="boventitel">Privacy</p><h1>Uw gegevens</h1></div></section>
${sectie('', `<div class="smal">
<p>Deze website plaatst geen cookies en volgt uw bezoek niet. De lettertypes worden geladen van Google Fonts.</p>
<p>Als u ons belt, mailt of het contactformulier invult, gebruiken wij uw gegevens alleen om uw vraag te beantwoorden, een offerte te maken en een opdracht uit te voeren. Wij geven ze niet door aan anderen, behalve als dat nodig is om uw opdracht uit te voeren of als de wet het ons verplicht.</p>
<p>U kunt uw gegevens laten inkijken, verbeteren of verwijderen. Stuur daarvoor een mail naar <a href="mailto:${BEDRIJF.mail}">${BEDRIJF.mail}</a>.</p>
<p>Verantwoordelijke: ${BEDRIJF.naam}, ${BEDRIJF.straat}, ${BEDRIJF.gemeente}, ${esc(BEDRIJF.btw)}.</p>
<p class="nota">Voorlopige tekst: laat deze pagina nalezen voor de site online gaat.</p></div>`)}
`];

fs.mkdirSync(UIT, { recursive: true });
for (const [bestand, [titel, beschrijving, inhoud]] of Object.entries(P)) fs.writeFileSync(path.join(UIT, bestand), pagina(bestand, titel, beschrijving, inhoud));
console.log('geschreven:', Object.keys(P).join(', '), '| partner:', PARTNER.naam || 'NOG IN TE VULLEN', '| formaten:', FORMATEN.length || 'NOG IN TE VULLEN');
