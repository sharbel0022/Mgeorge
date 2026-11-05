# Oberoende OCR-kodgranskning — 2026-11-05

## Slutbesked

**Godkänd inom den granskade avgränsningen på `502697253056399c33105944ca7884cf414a4ac4`.** Den versionen innehåller även parserfixen `dfc49d588a5f6324fce5d6bd638bb76e3fece5b5`. Inga kvarvarande Critical, Important eller Minor identifierades i den riktade återgranskningen. Samma tio frysta geometri-/censusfall gick från **7/10 till 10/10**. Slutkörningen gav **101/101 godkända, inga skips**, på 1 464,735 ms.

Granskaren ändrade endast tester och denna evidens. All produktionskod lästes ur exakta commits och provades i separata git-arkiv. Nya optiska OCR-körningar i granskningen: **0**. Bildfiler, facit, tidigare mätresultat och poäng har inte ändrats. Root ansvarar för full integration, eventuell publicering och det separata oberoende bildprovet.

## Granskade versioner

| Version | Omfattning och utfall |
| --- | --- |
| `aec3a1902fea76681e917802c0d2b336d471613b`, förälder `13b6473` | Datumseparator, kollapsad artikelrubrik och ny nummerbaserad typinferens. Important: fem tydliga andra dokumenttyper blev falskt gröna i båda parsrarna. |
| `e3d7f6c8ae526595981af0fd062278b491b6da3b` | De tio falskt gröna fallen stängda. Minor kvar: negativ typcensus läste tabellfiltrerad text. |
| `41b5ced19ae3d72609ceb82863b88d5ac139a784` | Explicit syskonetikett efter ett helt Bankgirovärde. Inget fynd i den avgränsade läsgranskningen. |
| `dfc49d588a5f6324fce5d6bd638bb76e3fece5b5` | Full bevarad typcensus och avstående från tvetydigt nollutfyllt OCR-heltal. 44/44 egna parserfall godkända. |
| `68e3cb752d05f825e36f88eab58f925cb056e3e8` | AUTO och geometrisk rekonstruktion. Viktiga associations-/geometrifall underkända: egna 7/10, trots befintliga 31/31. |
| `502697253056399c33105944ca7884cf414a4ac4` | Etikettförankrad räckvidd, blockerande census även för okända etiketter och gemensamt y-band per rå rad. Samma egna 10/10 samt totalen 101/101 godkända. |
| `d52bfd985a6a1324703b9b1c8a6b11a7ba76b31c` | Läs- och aritmetikgranskning av sparad utvecklingsregression på 68e3cb7, separat från slutkodens acceptans. |

## Stängda parserfynd

### Falskt grön dokumenttyp

En syntetisk fakturakropp med `Fakturanummer: REG-942` och någon av rubrikerna `Dokumenttyp: Offert`, `Dokumenttyp: Påminnelse`, `Leveransbekräftelse`, `Bekräftelse` eller `Offertnummer: Q-417` var `other/red` på 13b6473 men blev `invoice/green` på aec3a19. Det reproducerades i både Node och Sites.

Den ursprungliga oberoende 14-fallsmatrisen gav **4 godkända / 10 underkända** före rättning och **14/14** på e3d7f6c. Native dokument får inte längre den nya nummerbaserade typen. Provisorisk OCR-inferens behåller konfidens högst 0,85 och granskning. En uttrycklig native `Faktura` förblir en positiv grön kontroll.

### Konkurrerande typ efter tabell

På e3d7f6c tog `invoiceScalarText` bort `Dokumenttyp: Offert` när etiketten följde en kollapsad artikelrubrik och artikelrad. Den nya typcensusen missade därför etiketten och gav `invoice/yellow`, med `table_status=incomplete`. Ingen falsk grön skapades, men den uttryckliga negativa typcensusen var ofullständig.

Samma sex oberoende fall — vanlig avslutande etikett, etikett efter ofullständig tabell och etikett efter visningsgränsen, i båda parsrarna — gav **4/6** före och **6/6** efter dfc49d5. Fixen läser `layout.original` för den negativa typen medan positiv inferens fortfarande kräver ett validerat fakturanummer.

### Beloppsavstående och bevarad grammatik

De 24 egna beloppsfallen på dfc49d5 kontrollerar nollutfyllda positiva och negativa OCR-heltal, tusentalsmellanslag, 0, vanliga heltal, decimaler, explicit kr/SEK och native PDF-paritet. Ett senare tvetydigt belopp får inte döljas av ett tidigare uttryckligt belopp. Resultatet är **24/24**. Råa siffror bevaras även när fältet blir null; inget korrekt belopp gissas fram.

Den portabla testfilen `sites/tests/ocr-parser-independent-review.test.mjs` bevarar samma 14 + 6 + 24 beteendefall. Den historiska baslinjejämförelsen genomfördes separat i oförändrade arkiv; CI-filen behöver ingen tillfällig checkout eller Git-historik.

Tolv tidigare negativa datum-/tabellkontroller på aec3a19 identifierade inget ytterligare fel: okända datumtillägg förblev ogiltiga och motstridiga eller oläsliga nettosummor kunde inte ersättas med ett bekvämt tidigare värde.

## Stängda layoutfynd

### Värdet till en annan kolumn blev styrkt Bankgiro

Det frysta motprovet innehåller tre separata OCR-rader, alla med ordkonfidens 96:

| Ord | x0–x1 | y0–y1 |
| --- | ---: | ---: |
| `BG:` | 0–24 | 10–30 |
| `Avtalsnr:` eller `Kundkonto:` | 30–102 | 10–30 |
| `482-7654` | 30–210 | 50–110 |

Råtexten har dubbla radgap och inget styrkt BG-värde. På 68e3cb7 vidgade värdets stora höjd x-toleransen. Den okända uttryckliga etiketten direkt över värdet räknades inte som konkurrerande ägare. Resultatet blev `BG: 482-7654` och verklig collect/bind/assess gav `OCR_BANKGIRO_WORDS_SUPPORTED`. Orden ändrades inte; den felaktiga associationen var själva fyndet. Detta var inget demonstrerat grönt ekonomiskt dokument.

### Vertikalt motsägande ord bildade en etikett

En rå rad `Att betala` med `Att` på y0–20 och `betala` på y180–200 fick en hög sammanlagd bbox. Därigenom kunde en summa på y250–270 paras trots att orden inte hade ett gemensamt vertikalt band. Originalets starka radgap försvann och ett belopp tilldelades utan sammanhängande etikettgeometri.

### Rättningen och positiva kontroller

5026972 förankrar både x-tolerans och vertikal räckvidd i etikettens minsta verkliga ordhöjd. Även okända, uttryckliga kolonetiketter och etiketter med flera kandidater deltar i den blockerande ägarcensusen. Deras horisontella utsträckning kan blockera en koppling; de kan inte skapa en ny koppling. Ord i samma rå OCR-rad måste dela ett positivt y-band.

Den egna filen `test/review-ocr-layout-boundaries.test.js` är **byteidentisk** med den som frystes före rättningen. SHA-256:

`428e99102babf61f783fee2d334b403205dde1ccd1de6b31f65e05286692f0c7`

Matrisen innehåller de tre underkända fallen och sju kontroller: känd konkurrerande etikett, legitimt större vänsterjusterat värde med konfidens 89/90/96, överlapp mellan rader, konflikt efter 50 000 tecken och en källrad som saknas i ordobservationerna. Varje fall kontrollerar även att källan inte muteras och att varje exakt originalord finns kvar en gång. Gränsen 90 för Bankgiro och sidans befintliga OCR-konfidens ändras inte.

## Verifiering

| Körning | Resultat |
| --- | ---: |
| Tidigare oberoende typmatris på aec3a19 | 4/14 godkända |
| Samma typmatris på e3d7f6c | 14/14 godkända |
| Samma sex typcensusfall, e3d7f6c → dfc49d5 | 4/6 → 6/6 |
| Samlad egen parserreview på dfc49d5 | 44/44, 0 skips, 2 159,506 ms |
| Bankgiro-syskonfix 41b5ced, fryst fokus | 124/124, 0 skips, 15 890,780 ms |
| Befintlig layout/browser på 68e3cb7 | 31/31 |
| Egen fryst geometrimatris, 68e3cb7 → 5026972 | 7/10 → 10/10 |
| Slutkod 5026972: 31 befintliga layout/browser + 16 fixregressioner + 10 egna geometri + 44 egna parser | **101/101, 0 skips, 1 464,735 ms** |

Direkt runtime: Node v24.22.1. Installerad Tesseract.js 6.0.1 exponerar PSM.AUTO som `3`; båda verkliga konsumenterna sätter denna parameter före igenkänning och använder samma layoutfunktion. Browserintegrationen använder en syntetisk worker för adapterkontraktet och kontrollerar även avslutning vid konfigurations-/igenkänningsfel.

Reproducerbart slutkommando från repositoryroten:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node   --import ./scripts/saas-test-isolation.mjs --test-concurrency=1 --test   test/ocr-layout.test.js   test/ocr-layout-geometry-boundaries.test.js   test/review-ocr-layout-boundaries.test.js   sites/tests/ocr-layout-integration.test.mjs   sites/tests/ocr-parser-independent-review.test.mjs
```

Den tidigare rootrapporterade breda 802-körningen hör till aec3a19 före senare fixar. Den återanvänds inte som bevis för e3d7f6c, dfc49d5 eller 5026972.

## Kontroll av den sparade utvecklingsregressionen

Rapporten i d52bfd9 gäller uttryckligen **68e3cb7**, åtta då redan utvecklingskända normalbilder och två separata stressbilder. De två parsrarna använder samma optiska observation per bild. Det finns tio bilder och tjugo parserutvärderingar.

Oberoende läsning och hashkontroll gav:

- Resultatfilens SHA-256: `c992ad8445979a72dac0b01ea3ba486c0c184d3a6f9bc3fd77391f9cc8cd9e41`.
- Alla 188 redovisade källhashar matchar den angivna källcommitten.
- Alla 18 skyddade tidigare filer matchar, inklusive första underkända hållresultat, facit, manifest, bildfiler och ursprunglig mätkod.
- Egen omräkning från varje sparat expected/actual-fält ger samma utfall för vardera parsern: alla 13 fält **94 TP / 1 FP / 10 FN**, obligatoriska 10 **75 TP / 1 FP / 5 FN**, obligatoriska bildfält utan tillförd riktning **67 TP / 1 FP / 5 FN**.
- Dokumentexaktheten är 3/8 över alla 13 fält och 5/8 över de tio obligatoriska. Båda stressfall är röda och avstår från totalbelopp, referens och Bankgiro. Inget av de tio dokumenten är grönt.

Den ursprungliga felaktiga summan för normal-07 är kvar i just denna historiska mätning. Parseromtolkning på nyare kod och senare layoutfix är separata evidenssteg. Dessa siffror överförs inte till 5026972 eller det kommande oberoende bildprovet. Full aritmetikkontroll finns i `ocr-independent-review-arithmetic.json`.

## Praktiska gränser

Reviewn styrker att de reproducerade parser- och associationsfelen är stängda, samt att de granskade käll-/ord-/konfidensspärrarna och positiva kontrollerna består. Den lilla syntetiska geometrimatrisen mäter inte bildkvalitet, allmän OCR-precision eller hur ofta verkliga layouter måste avstå. Striktare geometri kan ge fler avståenden; bildmätningen måste få visa den effekten. Full CI, browser-QA, produktionsdrift och oberoende V2-acceptans hanteras separat.
