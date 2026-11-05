# V2-diagnos och två avgränsade parserrättningar

## Omfattning och oförändrat första resultat

Arbetet utgår från exakt produktionskälla
`571073b8172ab53899a4ce3c2b717c7fe24daee2`. V2-observationerna lästes först
efter förseglingen i `45fd0e9d5f13071129da983996c4a6c33804f62d`.
Den första mätningens resultatfil har fortsatt SHA-256
`13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7`.

**Ingen ny OCR, korpusändring, facitändring eller ändring av första
resultatfilen gjordes.** Första V2 är fortsatt underkänd: per motor
TP 82 / FP 0 / FN 48 för alla 13 normalfält och TP 60 / FP 0 / FN 40
för obligatoriska 10. Dessa är de ursprungliga resultaten, inte en mätning
av den nya koden. Ingen omtolkning av hela V2-korpusen efter fixen ingår.

## Styrkt diagnos

Samtliga tio normaltexter innehåller leverantörens namn, men den tidigare
parsern returnerade inget leverantörsnamn:

| Normalbilder | Observerad struktur | Diagnos |
| --- | --- | --- |
| 01, 02, 04, 06, 07, 08 | Omärkt namn i avsändarhuvud | Den befintliga namnparsern kräver uttryckligt rollunderlag. Position först i texten eller suffixet AB ger ingen ny roll. |
| 03, 10 | Kolonlös rad med uttrycklig leverantörsetikett och ett namn | Den befintliga inlinegrammatiken krävde kolon. Layoutkodens giltiga parning av rubrik och nästa rad kan dessutom producera just denna kolonlösa form. |
| 05, 09 | Leverantör och mottagarrubrik på samma rad, därefter två hopslagna företagsnamn | Rolltillhörigheten saknar tillräcklig evidens i texten och ska förbli olöst. |

Normal-03 innehåller ett fullständigt läsbart momsbelopp efter etiketten
Summa moms utan kolon. Den etiketten omfattades inte av momsregeln vid
radstart. Med kolon fungerade den redan genom den gamla momsregeln.
Normal-04 innehåller ett läsbart totalbelopp efter Fakturabelopp, som
tidigare inte ingick i totalbeloppets etikettcensus.

Normal-01, 03 och 06 granskades även visuellt i de oförändrade, hashkontrollerade
PNG-filerna. Bilderna bekräftar läsbara namn och belopp, en uttrycklig
leverantörsrubrik i 03 och ett omärkt avsändarhuvud i 06. I 01 ligger
summeringsvärdena till höger om etiketterna, medan den sparade OCR-texten
placerar flera värden senare i textströmmen.

### Gräns för geometridiagnosen

Första produktworkern returnerade text, faktisk konfidens och Bankgiro-ordbevis.
Fullständiga OCR-block, ordlistor och bbox sparades inte. Det bekräftades av
mätningens författare; inga sådana data finns i det förseglade resultatet.
De visuella kolumnerna kan därför beskrivas, men en exakt geometrisk
avvisningsorsak i den gamla OCR-körningen kan inte fastställas.

Den nya geometrikedjereproduktionen använder helt nya syntetiska ord och
koordinater, den verkliga oförändrade layoutfunktionen och båda verkliga
namnparsrarna. Den bevisar ett generellt producent-/konsumentproblem utan
att påstå att V2:s saknade originalkoordinater har återvunnits.

## De två rättningarna

### 1. Fullständiga uttryckliga summeringsetiketter

Summa moms utan kolon vid radstart och Fakturabelopp stöds av samma
heltalsöresparser och fulla etikettcensus som de befintliga summeringarna.
Syskongränser och artikelblockens summeringsgränser känner till etiketterna.
Ett motstridigt eller oläsligt extra märkt värde ger fortsatt null.

En rad med explicit tabellstruktur behåller sin artikelkontext även när
beskrivningscellen börjar med en summeringsetikett. En sådan cell får inte
bli ett dokumentbelopp. Ingen saknad summa räknas fram; procenttecken,
siffror, valuta och okända suffix repareras inte.

### 2. Kolonlös uttrycklig leverantörsroll vid radstart

En leverantörsetikett i början av en källrad kan följas av ett namn utan kolon.
Det gäller de befintliga uttryckliga leverantörsrollerna; inga omärkta
avsändarhuvuden införs. Händelsen ingår i samma fulla namn- och rollcensus.
Upprepade oförenliga eller oläsliga leverantörsnamn håller hela fältet.

En konkurrerande roll, okänd kolonetikett eller olöst kolumnseparator får
inte bli en del av det nya namnfältet. En följdrad med en annan roll kan
inte lånas som namn. Rader med flera etiketter får inte gemensamt låna
nästa rad. Strukturen Leverantör Faktureras till följd av två sammanslagna
företagsnamn är ett uttryckligt negativt prov och returnerar null.

Inga geometri-, worker-, confidence-, registrerings- eller betalningsregler
ändras. Endast de två skalärparsrarna och deras två identiska detaljmoduler
ändras i produktkoden.

## Reproducerande tester och grind

Nya fall finns i `sites/tests/invoice-v2-explicit-grammar.test.mjs` och kör
både faktisk Node-parser och faktisk Sites-parser. Alla namn, belopp,
datum och koordinater i reproduktionerna är nya syntetiska exempel.
De hämtar inte värden från V2-facit eller V2-bilder.

På oförändrad 571073b-produktkälla gav de 56 slutliga fallen:
**30 gröna säkerhetskontroller, 26 reproducerade fel**.
Efter rättningen är **56/56 gröna**, utan skips eller försvagade gamla
assertions. Testnamnen omfattar bland annat:

- VAT summary alias och gross invoice amount alias.
- Additional Fakturabelopp remains in the complete census.
- Safe geometry pairing and the actual name consumer must agree.
- Later colonless supplier remains authoritative.
- Role-less or conflicting text cannot become the party.
- Article description is not a document summary.
- A native document cannot become green while ignoring a competing label.
- Damaged percentage text is not repaired.
- Text order cannot associate detached summary values.

Den kombinerade text-/parsergrinden är **290/290 grön**:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  sites/tests/invoice-v2-explicit-grammar.test.mjs \
  test/invoice-evidence-ocr.test.js \
  sites/tests/invoice-evidence-ocr.test.mjs \
  test/invoice-scalar-layout-regression.test.js \
  sites/tests/invoice-scalar-layout-regression.test.mjs \
  sites/tests/ocr-parser-independent-review.test.mjs
```

Trots några historiska filnamn som innehåller OCR använder denna grind
endast syntetisk text/orddata och parsrar, inte någon optisk worker.
Sites-typecheck, `git diff --check` och byteparitet mellan detaljmodulerna
är också gröna. Inga beroenden ändrades.

Första resultatfilen jämfördes åter mot förseglingscommit och känt hash.
Manifestet och samtliga 21 filer i dess korpusinventering verifierades
oförändrade efter arbetet.

## Kvarstående luckor

Sex omärkta avsändarhuvuden behöver starkare rollbevis för automatisk
namnextraktion. Två sammanslagna rollkolumner är fortsatt olösta utan
geometribevis. Etiketter och belopp som skilts åt av andra textblock får
fortsatt inte paras efter ordning. Optiskt skadade procenttecken får inte
gissas till procent. Andra observerade bortfall, såsom punkt efter explicit
valuta och sammanblandade datum-/kontokolumner, ingår inte i dessa två fixar.

Förändringen gör inget nytt hållprovs- eller kvalitetsbetygspåstående.
En senare mätning på V2 ska redovisas som regression på redan observerade
bilder. Oberoende kodgranskning och integrationens fulla grindar återstår.
