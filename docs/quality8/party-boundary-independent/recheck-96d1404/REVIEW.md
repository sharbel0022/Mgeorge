# Oberoende omprövning — partigränser och ägarcensus

## READY på exakt 96d1404

**Granskad commit:** `96d1404d4b7bb4a791f0313c8cd95a29eec5a8c7`.

**Föregående granskade fix:** `0f550950b99d41d932b91370b458e9b85abf9451`.

**Ursprunglig bas:** `dd968c1fd10b4e21c2479a939df548e390f5c6d6`.

I1 och I2 från den föregående oberoende NOTREADY-rapporten är stängda. Inga kvarstående Critical- eller Important-fynd har verifierats i denna avgränsade omprövning. READY gäller denna exakta parserkandidat och den uttryckliga roll-/företagsformsgränsen med tillhörande ägarcensus. Det är inget generellt löfte om universell namn- eller layoutförståelse och inget kvitto på full CI eller produktion.

## Varför fynden är stängda

### I1: tvetydig namnrad kan inte låna ut den tidigare rollen

`section` sätts nu till `null` när namnspannet är `ambiguous`. Ett efterföljande omärkt organisationsnummer på samma rad eller nästa rad kan därför inte ärva den första rollen. Den negativa namnobservationen bevaras i census; parsern delar inte upp namnen och skapar inte en gissad ny part.

De fyra ursprungliga owner-census-scenarierna, körda i Node/Sites × pdf/ocr, håller nu både namn och oägt organisationsnummer som `null`. Detta omfattar motsatta roller, upprepad recipient och ett inline-organisationsnummer.

En självständig explicit ägaretikett används fortfarande genom organisationseventets egen roll. De frysta fallen kräver att dessa uttryckligen märkta nummer bevaras även när namnet är tvetydigt. De nya extra proven verifierar dessutom att ett explicit nummer för den motsatta parten inte doneras till vald recipient, att ett annat oägt nummer fortfarande deltar i konflikten och att ett identiskt oägt nummer endast kan bekräfta ett redan självständigt ägarmärkt värde.

### I2: avslutande parentes eller hakparentes döljer inte företagsformen

Företagsformsgränsen hanterar nu avslutande parentes/hakparentes och kräver fortfarande en separat roll efter formen. Det tidigare gröna sammansatta namnet `Independent North (AB) supplier Independent South AB` hålls nu i samtliga fyra motor-/metodkombinationer. Namnet blir inte grönt och delas inte upp i påhittade parter.

Extra prover täcker `[AB]`, `North(AB)`, `(AB.)` och `[AB],` före en barroll. En enda namnsträng med ett vanligt rollord och en avslutande bracketform, `Original supplier [AB]`, bevaras samtidigt. Den befintliga positiva kontrollen `AB Customer Service` och de övriga legitima rollordsnamnen förblir gröna i PDF-läget och gula i OCR-textläget.

## Faktiska egna körningar

Alla körningar använder Node `v24.22.1` från `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`, `NODE_ENV=test`, repositoryts isolationpreloader, type stripping och testkonkurrens 1.

| Egen körning på exakt 96d1404 | Tester | Pass | Fail | Cancel/skip/TODO | Exit | Tid ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Samma frysta oberoende korpus | 164 | 164 | 0 | 0/0/0 | 0 | 859.170497 |
| Gamla recipient40 + namngrammatik48 + företagsformsgräns56 | 144 | 144 | 0 | 0/0/0 | 0 | 2140.312121 |
| Åtta nya konkreta punctuation-/ägarscenarier × fyra kombinationer | 32 | 32 | 0 | 0/0/0 | 0 | 565.425404 |
| **Summa** | **340** | **340** | **0** | **0/0/0** | | |

Producentens tidigare 308-resultat har inte använts som eget resultat; motsvarande 164+144 har körts oberoende i den nya snapshoten. Den tidigare egna 164-körningen gav 144 pass och 20 fail på 0f550950. Samma oförändrade fall och assertions ger nu 164/164. De tolv ursprungliga recipient-regressionerna är fortsatt stängda.

De nya extra 32 fallen är separata från den frysta korpusen. Inga gamla fall eller assertions har redigerats. Alla fyra motor-/metodkombinationer används även i de nya proven.

## Fryst korpus och bevarande

Den ursprungliga fallfilen och testadaptern har inte kopierats eller ändrats för själva körningen; samma filer från den första granskningen körs med `PARTY_REVIEW_REPO` riktad till den nya exakta snapshoten.

| Artefakt | SHA256 |
| --- | --- |
| Frysta `probes/cases.json` | `8f72fc82b369d015c60dc24d06d6803e659d7159a8c3bce86ccdb8f3d7c420f3` |
| Frysta `probes/independent-boundary.test.mjs` | `bc468a7bced8bd59ba8c054bb3721a2b9e384962d1e72eb4aa97960f063d1daf` |
| Båda produktfilerna `src/invoice-details.js` och `sites/lib/invoice-details.js` | `db76b24ff1e68701f624b395588627b634767f9034289b163855dbc3b9226255` |

Alla **30 filer** i föregående granskningsmanifest har kontrollästs och matchar fortfarande sina ursprungliga hashar. Den gamla NOTREADY-rapporten, alla RED-loggar, råobservationer och det transparent dokumenterade första Bankgiro-fixtureförsöket är intakta. Inga nya fixturekorrigeringar gjordes i denna omprövning.

## Källgranskning och omfattning

En separat snapshot skapades från exakt 96d1404. Sju relevanta käll-/testfiler har verifierats byte för byte mot committen. Node och Sites produktfiler är byteidentiska med varandra. Wrapperfilerna `src/invoice-extraction.js` och `sites/lib/invoice-fields.js`, liksom de tre gamla testfilerna i 144-populationen, är oförändrade mot 0f550950.

Den nya produktdiffen innehåller endast en ändrad företagsformsgräns och villkorad rensning av den aktiva sektionsrollen i båda speglade parserfilerna. Den introducerar inget splitsteg, ingen ny ägargissning och inga namn-/fixtureundantag. Jag har läst diffen tillsammans med omgivande namnevents-, organisationsevents- och unassigned-censuslogik.

Den positiva populationen bevarar bland annat `Original supplier AB`, `Synthetic customer AB`, `North Customer Support AB`, `Kund AB`, rollfragment och två separat kolonmärkta roller. Den negativa populationen håller tvetydiga rollföljder och bevarar originaltexten utan att tillverka andra godkända identiteter.

## Begränsningar

Bedömningen gäller den stödda explicita grammatik som den här förändringen avser. Den garanterar inte förståelse av varje tänkbart företagsnamn, bolagsform, skiljeteckenföljd eller dokumentlayout. Det konservativa beteendet vid uttrycklig tvetydighet är fortsatt att lämna fält för manuell kontroll.

Alla anrop använder syntetisk text. `method:'ocr'` anger parserläge; inga bilder eller optiska anrop används. Ingen full CI, bred banksvit, produktionskontakt, bankkontakt, V3-läsning, produktändring eller poängändring har gjorts av granskaren. B-granskarens separata moms-censusfråga bedöms inte i detta kvitto. Inga transportavbrott eller körhinder inträffade i denna omprövning.

## Artefakter

- `evidence.json`: exakta kommandon, resultat, källor och hashmanifest.
- `source-preservation.json`: exakt källverifiering, oförändrade wrappers/tester och kontroll av tidigare 30 manifestfiler.
- `product.diff`: den granskade förändringen från 0f550950 till 96d1404.
- `logs/frozen-independent-164.tap`: oförändrade egna fall.
- `logs/retained-regression-144.tap`: befintliga fall utan assertionsändringar.
- `extra-owner-punctuation.test.mjs` och `logs/extra-owner-punctuation-32.tap`: nya avgränsade motprov och kontroller.
