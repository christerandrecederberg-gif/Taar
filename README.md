# Tår – personlig barlager

En enkel inventar-app for baren, inspirert av Backbar. Den er laget for mobil og kan installeres på hjemskjermen. Alt lagres lokalt på enheten, og appen virker uten nett.

## Funksjoner

- **Lager**: produkter per kategori, med flaskestørrelse, innkjøpspris og beholdning. Med +/− justerer du raskt, og i produktkortet registrerer du varemottak eller svinn.
- **Varsler om lavt lager**: du slår på varsel for de produktene du vil følge og setter en grense. Lavt lager vises på oversikten, som merke på ikonet og som en handleliste du kan kopiere, med «bestill opp til»-nivå.
- **Telling**: du teller fulle flasker og åpne flasker i tideler med en glidebryter. Tellingen er forhåndsutfylt med dagens beholdning, og fremdriften lagres underveis.
- **Forbruk**: mellom to tellinger beregnes forbruket per produkt slik: forrige telling + varemottak − ny telling. Du ser det både i antall og i kroner.
- **Leverandører**: hvert produkt kan ha en leverandør. Lavt lager og handlelisten grupperes etter leverandør, og hver gruppe kan deles for seg.
- **Strekkodeskanning**: skann flasker med kameraet for å finne produktet, koble en strekkode til et produkt eller hoppe rett til produktet under telling. Koden kan også skrives inn for hånd.
- **Faktisk pour cost**: legg inn salget for perioden mellom to tellinger. Appen viser faktisk pour cost (forbruk ÷ salg eks. mva) mot teoretisk (oppskrifter) og avviket per produkt, altså svinn og overpouring.
- **Pour cost**: drinker med oppskrift (cl per ingrediens) og utsalgspris. Appen viser varekost, pour cost i %, fortjeneste per drink og hvilken pris som gir målet ditt. Mva-sats og mål stiller du inn selv.
- **Rapport per telling**: lagerverdi, forbruk, varemottak, faktisk pour cost og avvik for perioden. Deles som PDF (via utskrift → del) eller som kort tekst.
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
