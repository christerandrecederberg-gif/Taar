# Tår – personlig barlager

En enkel inventar-app for baren, inspirert av Backbar. Den er laget for mobil og kan installeres på hjemskjermen. Alt lagres lokalt på enheten, og appen virker uten nett.

## Funksjoner

- **Varemottak fra liste**: lim inn varer fra en kvittering (`Navn; Antall; Pris inkl. mva`). Hver linje kobles til riktig flaske på navn, du kan rette koblingen, og ukjente varer kan legges til som nye flasker.
- **Lager**: produkter per kategori, med flaskestørrelse, innkjøpspris og beholdning. Med +/− justerer du raskt, og i produktkortet registrerer du varemottak eller svinn.
- **Varsler om lavt lager**: du slår på varsel og setter en grense per produkt (standard 0,3 flaske). Produkter du merker med ★ Viktig havner under «Må bestilles» i rødt, og det er bare de som teller på app-ikonet. Resten havner under «Kan vente». Handlelisten tar med de viktige, og du kan velge å ta med alt. Under Mer kan du endre grensen for mange produkter på én gang.
- **Telling**: to typer. **↻ Jevnlig sjekk** teller bare flaskene du har merket for det (standard hver 14. dag), og **full telling** teller alle (standard hvert halvår). Oversikten minner deg på begge. Du teller fulle flasker og åpne flasker i tideler, tellingen er forhåndsutfylt, og fremdriften lagres underveis.
- **Merker**: hver flaske kan ha ★ Viktig, ↻ Jevnlig sjekk og 🍸 Meny i hvilken som helst kombinasjon. Siden «Merk flasker» (under Lager) lar deg sette merkene for alle flaskene på ett sted, med snarveier som «alle 🍸 → ↻». Under Lager kan du filtrere på hvert merke.
- **Forbruk**: forrige telling av flasken + varemottak − ny telling, i antall og kroner. Full telling regnes mot forrige fulle telling, jevnlig sjekk mot forrige gang flasken ble telt. Faktisk pour cost i % regnes bare på full telling; avvik per flaske også ved jevnlig sjekk.
- **Leverandører**: hvert produkt kan ha en leverandør. Lavt lager og handlelisten grupperes etter leverandør, og hver gruppe kan deles for seg.
- **Strekkodeskanning**: skann flasker med kameraet for å finne produktet, koble en strekkode til et produkt eller hoppe rett til produktet under telling. Koden kan også skrives inn for hånd.
- **Faktisk pour cost**: legg inn salget for perioden mellom to tellinger. Appen viser faktisk pour cost (forbruk ÷ salg eks. mva) mot teoretisk (oppskrifter) og avviket per produkt, altså svinn og overpouring.
- **Pour cost**: drinker med oppskrift (cl per ingrediens) og utsalgspris. Appen viser varekost, pour cost i %, fortjeneste per drink og hvilken pris som gir målet ditt. Mva-sats og mål stiller du inn selv.
- **Rapport per telling**: lagerverdi, forbruk, varemottak, faktisk pour cost og avvik for perioden. Deles som PDF (via utskrift → del) eller som kort tekst.
- **Priser og mva**: alle priser (innkjøp og utsalg) skrives inn med mva. Én felles bryter – øverst til høyre på hver side og under Mer – viser alle beløp med eller uten mva. Pour cost i % blir den samme uansett.
- **Backup og deling**: backup (JSON) og lagerliste (CSV for Excel) deles rett via iPhones delingsmeny (AirDrop, e-post, Filer). På PC lastes filene ned.

## Kjøre lokalt

Appen er bare statiske filer uten byggesteg:

```sh
python3 -m http.server 8000
# åpne http://localhost:8000
```

## Publisere (GitHub Pages)

1. Gå til repoet → **Settings → Pages**.
2. Velg «Deploy from a branch», branch `main` og mappe `/ (root)`.
3. Åpne lenken på telefonen og legg appen til på hjemskjermen:
   - **iPhone**: Safari → Del → «Legg til på Hjem-skjerm»
   - **Android**: Chrome → ⋮ → «Installer app»

## Viktig om data

Dataene lagres i nettleserens lokale lagring på enheten. Ta backup jevnlig under **Mer → Last ned backup**. Den samme filen bruker du for å flytte dataene til en ny telefon.

## Filer

| Fil | Innhold |
| --- | --- |
| `index.html` | Skall og navigasjon |
| `app.js` | All logikk: lagring, visninger, telling, pour cost |
| `styles.css` | Stil etter Tårs profil (Cobalt, Navy, Linen; alltid lyst tema) |
| `vendor/zxing.min.js` | Strekkodeleser (ZXing, Apache 2.0), lastes først når du skanner |
| `logo.svg`, `fonts/` | Logo og fonter (Cormorant Garamond, Spectral, Inter – SIL OFL) |
| `sw.js` | Service worker for offline |
| `manifest.webmanifest`, `icon*` | PWA-installasjon |
