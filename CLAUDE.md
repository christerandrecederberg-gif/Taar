# Tår – barlager (kontekst for nye Claude-økter)

Personlig lager-app for Christer, som driver baren **Tår Cocktails & Kaffe** i Kristiansand. Appen er bare for Christer, ikke for teamet. Han bruker den på iPhone, lagt til på hjemskjermen.

## Hvordan Christer vil jobbe
- Skriv **norsk**, **kort og enkelt**. Christer liker ikke lange tekster. Svar direkte på det han spør om.
- Når han sier «diskuter først» eller «ikke gjør noe enda», skal du foreslå og spørre, ikke bygge.
- **Aldri flytt eller endre dataene hans automatisk** uten at han ber om det. Han flytter heller selv.
- Han kan ikke kode. Gi alltid konkrete trykk-for-trykk-steg i appen.
- Alle priser han oppgir er **inkl. mva**.

## Teknisk
- Statisk PWA uten byggesteg: `index.html`, `app.js` (all logikk), `styles.css`, `sw.js` (service worker), `manifest.webmanifest`, `logo.svg`, `fonts/`, `vendor/zxing.min.js` (strekkodeleser).
- **Data ligger bare i localStorage på telefonen**, med nøkkelen `taar.data.v1`, som aldri skal endres. Vi kan ikke lese eller skrive dataene hans herfra. Endringer i dataene må gå via knapper i appen, for eksempel innebygde lister han trykker på, import-skjemaer, backup og gjenoppretting.
- Publiseres med GitHub Pages fra branchen `claude/dazzling-dijkstra-ckw04x`: https://christerandrecederberg-gif.github.io/Taar/ . PR til `main` er åpen: christerandrecederberg-gif/Taar#1.
- **Ved hver endring:** øk `APP_VERSION` i `app.js` og `VERSION` i `sw.js` med 1 (nå: 27 / v27). Commit, push, og be Christer lukke og åpne appen og sjekke versjonsnummeret nederst under Mer.
- Service workeren henter fra nettet først, så oppdateringer kommer ved neste åpning.
- Test med Playwright og Chromium (`/opt/node-tools/node_modules/playwright`, iPhone 13-emulering) mot `python3 -m http.server`. Sjekk at det ikke kommer feil i konsollen.
- Ingen synk eller backend. Det ble valgt bort. GitHub-token-synk ble blokkert av sikkerhetsregler.
- vinmonopolet.no er blokkert av nettverket i skymiljøet.

## Design (Tårs profil)
Farger: Cobalt `#2C438C`, Navy `#0B1240`, Linen `#EDE8DE`, aksenter `#DE906E`, `#B0785F` og `#8A8070`. Alltid lyst tema, uten mørk modus, fordi Christer ville ha det slik. Fonter: Cormorant Garamond (overskrifter og navn), Spectral Light Italic (forklarende tekst) og Inter (tall og knapper). Navnet skrives **Tår**, aldri «Taar».

## Funksjoner (se også README.md)
- **Lager** med kategorier, blant dem Akevitt, Bitters (cocktailbitters) og Bitter/Amaro. Filtermenyen «Vis» og varemottak.
- **«Angre»** på siste bevegelse.
- **«Legg til mange»** (`Navn; Kategori; Størrelse; Pris; Antall; Leverandør`) og **«Varemottak fra liste»** (`Navn; Antall; Pris`).
- **Merker:** ★ Viktig (rødt «Må bestilles», teller på app-ikonet), ↻ Jevnlig sjekk og 🍸 Meny. Siden «Merk flasker».
- **Varselgrense:** standard 0,3 flaske. Verktøy under Mer endrer mange på én gang.
- **Telling:** ↻ jevnlig sjekk (hver 14. dag) og full telling (hvert halvår). Forbruket regnes per flaske. Faktisk pour cost i % regnes bare på full telling.
- **Telling fra tekst (v26, fungerte dårlig i praksis; Christer vil kanskje lære den opp senere):** knappen «🎤 Telling fra tekst» i tellingen. Christer dikterer med mikrofonen på iPhone-tastaturet eller limer inn tekst («Altos Plata null komma åtte, Cynar to»). Bryteren **Baren** setter tallene, mens **Lageret** legger dem oppå det som er talt (er flasken ikke talt ennå, brukes bare lager-tallet). Flasker han ikke nevner, står urørt. Sjekkliste med grønt, gult og rødt før noe lagres. Rettelser huskes i `settings.countAliases`, og «↶ Angre innlesing» angrer siste innlesing.
- **Batcher i telling (v27, erstattet «Prebatcher»):** alle drinker med spec står i feltet «Batcher». Christer skriver ca. antall drinker i cheater bottlene (10, 20, 30 …). Verdien regnes fra specen uten det ferske, det vil si råvarer med sitrus eller juice i navnet; sirup, saft, puré og agave er med. Den vises som egen sum (`count.batches`, `count.batchValue`, eks. mva) i tellingen, historikken og rapporten. Batchene er ikke med i lagerverdien og påvirker ikke flasker eller forbruk.
- **Pour cost:**
  - Drinker har batchstørrelse og ingredienser i cl, g, dash, dråper eller stk. Gram regnes om med tetthet per kategori.
  - Ingredienser som ikke finnes i lageret, kobles til **Råvarer** (pris per l, kg eller stk, 15 % matmoms) på navn.
  - Én felles mva-bryter øverst. Pour cost regnes alltid uten mva.
- **Innebygde lister i `app.js`:** `TAR_MENU_SPECS` (menyen med specs og priser, knappen «Fyll inn Tår-menyen») og `TAR_RAW` (råvarepriser, knappen «Fyll inn Tårs råvarer»). Når Christer gir nye specs eller priser, oppdateres disse listene, og han trykker på knappene igjen. En ny import beholder flasker han har koblet for hånd.
- **Rapport per telling** som PDF eller tekst. Backup (JSON) og CSV deles via delingsmenyen på iPhone.

## Menyen (per november 2026)
- **189 kr:** Thai Basilikum, Venezuela's ånd, Blomsten fra Jerez, Te tid, Christer's Margarita, Siste blomst, Eksperimentet, Bivoks (batch 12), Tiki, Carajillo Old Fashioned (60 ml) og Negroni.
- **129 kr:** Floreale og Vibrante (alkoholfrie).
- **59 kr:** Shakerato.
- Margarita er en cheater bottle på 90 ml (all væske unntatt lime) + 25 ml lime.
- Husamaro (Carajillo) er Lazzaroni 600 ml, Cynar 100 ml og Meletti 100 ml, med 250 g espresso per liter.

## Åpne punkter
- **Shakerato:** mangler spec, så den har ingen ingredienser ennå.
- **Ukjent flaske fra flaskebildene (runde 7):** høy vinflaske med skrukork og fjellandskap og knute-logo («SOG…») på etiketten. Christer har ikke sagt hva den er.
- **Oppskrifts-appen:** Christer lager en egen cocktail-oppskriftsapp i en annen økt. Den kan lese Tårs backup-fil (JSON).
