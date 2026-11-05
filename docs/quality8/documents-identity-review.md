# Oberoende dokumentgranskning och snäv identitetsrättelse

2026-11-05. Granskad fryst commit: `303285ab1fec047ec0923614d994860c7d7ce6a5`, jämförd med `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Granskningen kördes läsande mot en separat `git archive`-snapshot. Därefter gav root uttryckligt mandat att rätta det identifierade felet. Den ursprungliga dokumentrapporten, mätningen och facit har inte ändrats.

## Review av den frysta commiten

### Strengths

- Momsgrammatiken är avgränsad till uttryckliga summa-/totalt-/belopp-etiketter inklusive eller exklusive moms. Generell summa behandlas inte som verifierat totalbelopp.
- Artikel-/sidmodulen är byteidentisk mellan Node och Sites. Båda parsermotorerna gav samma utfall i granskningens riktade reproduktioner.
- De 32 nya regressionerna passerade på den frysta commiten.
- Rapportens lagrade efterkällhashar matchar filerna i den granskade commiten. Precision/recall räknades om från lagrade TP/FP/FN och stämde i båda motorernas redovisade delpopulationer.
- Rapporten beskriver öppet att normalrasters 97,44 % precision inte når 98 %, att Sites här använder Node-arbetarens OCR-text och att de optiska utvecklingsfallen inte är ett orört blindtest.

### Critical

Ingen faktisk produktionsskrivning eller dataförlust demonstrerades av granskningen. Inga produktionsanrop gjordes.

### Important — P1, mergeblockerande

Den nya obegränsade tomradsskippningen i `grabFull` gällde även identiteter. Ett saknat fakturanummer kunde därför ersättas av en senare rubrik och få grönt parserresultat utan varningar.

Använd det frysta korpusets `existing-label-control`, som använder tidigare stödda `Netto` och `Att betala`, och ersätt:

```text
Fakturanummer: 86140
```

med:

```text
Fakturanummer:

Betalningsuppgifter
```

| Implementation | Fakturanummer | Nivå | Fel |
|---|---|---|---|
| Basen | null | red | Saknat/ogiltigt fakturanummer |
| 303285, Node | Betalningsuppgifter | green | Inga |
| 303285, Sites | Betalningsuppgifter | green | Inga |

Även andra rubriker reproducerade felet. Den omodifierade kontrollen var korrekt grön i alla tre körningar. Form-feed-varianten hölls korrekt. Ett rent alfabetiskt värde efter **ett** radbyte kunde redan före 303285 misstolkas som fakturanummer; den nya ändringen utvidgade felet till styckegap.

### Minor

Inga ytterligare verifierade blockerande fynd. Det ursprungliga testnamnet om att aldrig låna nästa rubrik hade bara ett monetärt exempel och täckte inte identitetsklassen.

### Declined to judge

Granskningen körde inte om hela optiska benchmarken och verifierade inte moln-OCR, webbläsare eller verkliga dokument. Källhashar och mäträkning verifierades, men detta är inte en oberoende full optisk acceptans.

### Mergereadiness för 303285

Inte redo att publicera utan rättelse av det falskt gröna identitetsfallet. Root informerades direkt innan rättelsen påbörjades.

## Levererad rättelse

Endast `src/invoice-extraction.js` och `sites/lib/invoice-fields.js` ändras i produktionen, med samma kod i båda.

- Passage över tomma styckerader tillåts endast för uttryckligt märkta total-, netto- och momsbelopp.
- Fakturanummer, betalningsreferenser, konto-/Bankgirofält och datum får inte hämtas från ett senare stycke. Den tidigare möjligheten till ett direkt angränsande radbyte bevaras.
- Ett rent alfabetiskt fakturanummer som står efter radbyte lämnas obestämt för granskning. Ett numeriskt eller alfanumeriskt värde med siffra på den direkt angränsande raden stöds; ett alfabetiskt nummer på etikettens egen rad stöds också.
- Detta bygger på fälttyp och placering, inte en lista över fyra kända rubriker. Ett numeriskt värde efter ett styckegap hålls också.
- Momsbeloppsstödet, sidgränser, artikelrader, originaltext och befintliga konflikter bevaras.

Avsiktlig avvägning: även ett verkligt alfabetiskt fakturanummer på en separat rad behöver nu manuell kontroll. Parsern kan inte säkert skilja en sådan fristående textrad från en rubrik genom innehållet ensamt. Ingen garanti ges för alla tänkbara dokumentlayouter.

## RED → GREEN och fokusverifiering

De utökade delade testerna gav **6 röda testgrupper av 40** före rättelsen. De nya negativa grupperna prövar två typer av styckegap, godtyckliga alfabetiska rubriker, numeriska/alfanumeriska senare värden samt referens, Bankgiro och datum. Positiva kontroller bevarar angränsande numeriska/alfanumeriska fakturanummer och alfabetiska nummer på samma rad.

Efter rättelsen:

- **40/40** delade summary-/blankradstester passerade, inklusive tidigare moms-, konflikt-, OCR-spärr-, artikel- och sidgränsfall.
- **277/277** riktade befintliga identitets-, datum-, belopps-, exakt-fält- och metadatafall passerade i Node/Sites.
- `git diff --check` passerade.
- Ingen ändring i `document-label-corpus.mjs`, `invoice-details.js`-kopiorna, `documents-evidence.md` eller `documents-measurements.json`.

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test test/invoice-summary-labels.test.js sites/tests/invoice-summary-labels.test.mjs
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test --test-name-pattern='Q8 synthetic|exact invoice field|complete metadata identifier' test/invoice-parser-corpus-q8.test.js sites/tests/invoice-parser-corpus-q8.test.mjs
```

Rättelsen är en separat kodförändring efter den optiskt mätta 303285. Den gamla mätningens källhash och resultat gäller fortsatt den historiska commiten; inga nya OCR-procentsatser eller betyg hävdas här. Root granskar rättelsen och kör integrerade CI-grindar före publicering.
