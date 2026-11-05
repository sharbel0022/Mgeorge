# Omtolkning av sparade OCR-observationer

**Omtolkning av sparade observationer, 0 nya OCR-anrop, inte hållprov.**

En enda genomgång kördes 2026-11-05 kl. 21:25:57–21:25:58 UTC mot exakt
`145e310ca2f561764b54606275625d87cbe22002`. De tio redan sparade optiska
observationerna från `68e3cb752d05f825e36f88eab58f925cb056e3e8` gick genom
vardera verklig parser en gång: 20 parseranrop, inga anrop till bildbehandling,
OCR-worker eller Tesseract. Inga produktionsfiler ändrades av detta arbete.

## Resultat

Node och Sites gav samma fältvärden och granskningsnivåer. Tabellen visar
resultatet **per motor**, utan att slå ihop dem eller blanda in stressfallen.

| Åtta normala dokument | TP | FP | FN | Precision | Recall | Helt korrekta dokument |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Alla 13 fält | 94 | 0 | 10 | 100 % | 90,38 % | 3/8 |
| Obligatoriska 10 | 75 | 0 | 5 | 100 % | 93,75 % | 5/8 |
| Obligatoriska 9 från bilden | 67 | 0 | 5 | 100 % | 93,06 % | 5/8 |

Riktningen `supplier` kommer från samma metadata som tidigare och är inte
återvunnen ur bilden; därför redovisas även de nio obligatoriska bildfälten.
Mätningen använder samma oförändrade TP/FP/FN- och dokumentexakthetsfunktioner.
Ett felaktigt värde räknas som både FP och FN. Ett avstått känt värde förblir FN.

De numeriska gränserna 98 % precision och 85 % recall uppnås på denna kända
normalpopulation. Båda stressfallen är fortfarande röda, med sammanlagt
TP 8, FP 1, FN 18 per motor; pixeleringens dokumenttyp är fortfarande fel.
Inga dokument blir gröna: **0 falskt gröna kritiska fall**, 0/8 gröna normala
och 0/2 gröna stressfall per motor. Att stressfallen hålls för granskning
innebär inte att deras fält återvinns korrekt.

### Normal07 avstår från det felaktiga beloppet

| Kontroll, identisk i Node och Sites | Värde |
| --- | --- |
| Tidigare `total_cents` | 7 410 807 700 |
| Efter omtolkning | `null` |
| Oförändrat facit | 540 150 |
| Granskningsnivå | `red` |

Parsern fyller alltså inte i facitets belopp. Totalbeloppet saknas fortfarande
och dokumentet måste granskas. Jämfört med föregående regression försvinner
en FP från normalpopulationen; antalet korrekta fält och FN är oförändrat.

De återstående tio saknade normalfälten per motor är Bankgiro (3), part (2),
organisationsnummer (2), referens (2) och totalbelopp (1). De övriga åtta
fältgrupperna har 8/8 korrekta värden vardera. Alla 13 fält, belägg och
dokumentresultat finns separat i JSON-filen.

## Oförändrad optisk observation och avgränsad källa

Den faktiska statiska lokala importgrafen för worker och båda parsrarna har
samma **28 filer** före och efter. Endast dessa två filer ändrar byte i grafen:

- `src/invoice-extraction.js`
- `sites/lib/invoice-fields.js`

De ändringarna gäller typcensus mot `layout.original` samt att OCR:s
nollutfyllda, icke-noll heltal utan explicit valuta inte tolkas som pengar.
Den nya JSON-filen redovisar före-/efterhash för båda filerna, grafmedlemskap,
separat nedströmsgraf och hash för hela inventeringen av 188 käll- och
beroendemanifestfiler. Varje sådan källfil jämfördes bytevis mot Git-objektet
vid exakt målcommit före parsningen och kontrollerades igen efteråt.

`text`, `method`, faktisk OCR-confidence, `inputSha256` och hela ordbeviset
återanvändes oförändrade. `reusedProcessing` i resultatet innehåller dessa
ursprungliga observationer. Deras tidigare optiska tider är uttryckligen
historiska; nya detalj- och sammanfattningstider mäter enbart parsning.

| Skyddad artefakt | SHA-256 |
| --- | --- |
| Tidigare optiska regressionsresultat | `c992ad8445979a72dac0b01ea3ba486c0c184d3a6f9bc3fd77391f9cc8cd9e41` |
| Första underkända hållresultatet | `91e1bfd75277c0175a4145739e70759fa9f65b900a75d94dcf94e131b5e59c46` |
| Oförändrat facit | `56e4b03f2b90f0d9cb2143376041d2751429d683397459df46a2a1e48d8141d3` |
| Oförändrad metrichelper | `e799e8e7b759f1cc20aeae946d479b7bae4c730fef45fd015a5c809c42cc0ada` |
| Denna omtolknings resultat-JSON | `7df328ba49656c491a7c54ebc8c6eef3b27a6d52f56affbb7631bc28aea9cdc0` |

Alla 18 ursprungligen skyddade bevisfiler, inklusive tio bildfiler, facit,
manifest och första mätkedjan, kontrollerades före och efter. Även föregående
regressionsresultat, rapport och runner skyddades. Inga tidigare resultat
ersattes eller ändrades.

## Reproduktion och kvarstående gränser

Med produktkällan byteidentisk med målcommit och befintliga beroenden:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/reparse-ocr-layout-regression.mjs \
  --source-root . \
  --output /tmp/ocr-layout-reparse-new-result.json
```

Runnern vägrar skriva över en befintlig resultatfil eller acceptera ändrade
observationer, mätfunktioner eller produktkällor. Den sparade körningen gjordes
en gång med Node v24.22.1. Syntaxkontroll och artefakternas integritetskontroller
är utförda; ingen extra OCR- eller bred produkttestomgång ingår.

Detta är regression på tio kända syntetiska bilder. Det första oberoende
hållprovet är fortsatt underkänt och oförändrat. Resultatet visar ingen ny
optisk precision, allmän populationsnoggrannhet, produktionsacceptans eller
automatisk ekonomisk säkerhet.

Den oberoende kodgranskningen har dessutom identifierat två öppna
layoutgeometrifall: ett stort värdes bbox kan låna värde från en okänd
konkurrerande etikett, och vertikalt åtskilda ord kan ge en alltför hög
etikettbox. Dessa fall ingår inte i de tio sparade observationerna och stängs
inte av denna mätning. En kommande layoutfix kräver egen granskning; resultatet
här förblir knutet till `145e310` och får inte märkas om som slutbevis för
senare produktkod.
