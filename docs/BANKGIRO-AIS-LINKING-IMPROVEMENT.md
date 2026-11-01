# Swedbank AIS och Bankgirooriginal — säker underlagskoppling

Datum: 1 november 2026. Baslinje: `1b017c0a34821bdc04aa9ca3002765f78b2888b6`.

## Reproducerat problem och leveransgräns

Senaste main dubbelräknade **inte** den syntetiska insättningen på 625 kr. Sites gav två synliga rader men bara **en ekonomisk post, 62500 öre, ett granskningsunderlag och noll allokeringar**. Node sparade samma osäkra XLSX i befintliga `import_jobs`, utan en andra banktransaktion. Det reproducerade felet var en saknad, spårbar originalrelation och en presentation som såg ut som två insättningar. Antalet rättade, faktiskt reproducerade ekonomiska dubbelräkningsfel är därför **0**. Den befintliga spärren mot dubbelräkning bevaras.

Lösningen utökar de befintliga applikationerna med en uttryckligen **manuell underlagskoppling**. Den är separat från bankverifierad identitet, motpartsrelation och fakturaallokering. Originalen och deras bankfält skrivs inte om. En osäker rapport förblir ett icke ekonomiskt granskningsunderlag även efter den manuella relationen. En faktura blir inte betald av denna åtgärd.

## Datamodell och kontroll

| Begrepp | Node | Sites | Ekonomisk betydelse |
| --- | --- | --- | --- |
| Bokförd banktransaktion | `bank_transactions`, bevarad API-JSON och SHA | `transactions`, `bankData` och versionsbundet ankomstkvitto | Insättningen räknas en gång |
| Bankgirots samlingsinsättning | Befintlig aggregate-/föräldraidentitet | Befintlig batch-/föräldraidentitet | Befintlig strikt ersättning med komplett individgrupp bevaras |
| Individuell Bankgirobetalning | Återtolkad observation ur originalet | `specificationStatus:'review'` eller strikt bankkopplad individ | Reviewrader ger inga pengar |
| XLSX-original | `import_jobs` med BLOB/SHA | Ägt dokument i R2 samt import-/hashreferens | Separat spårbart original |
| Manuellt verifierad originalrelation | Additiv relation med ägare, rapportidentitet, notering och återtag | `State.bankgiroLinks`, snapshots och återtag | Endast metadata och presentation |
| Fakturakoppling | `allocations` | `allocations` | Endast denna separata gräns ändrar fakturasaldo |
| Granskningsförslag | Kandidat från bevarad rapport | `bankgiroLinkCandidates` | Ändrar inga saldon eller bankfält |

Bekräftelsen kräver oförändrat AIS-original, återläst och omtolkat ägt rapportoriginal, komplett antal och rapportsumma, exakt belopp i heltalsören, SEK, uttryckligt mottagarkonto som motsvarar valt konto samt aktivt ägt bankmedgivande. Användaren måste kontrollera båda originalen och kontot samt dokumentera kontrollen. Datumskillnad tillåts högst tre kalenderdagar och kräver en separat förklaring; skillnaden används aldrig som automatisk identitet. En rapportgrupp får inte kopplas till två olika bankhändelser.

Sites behåller relationen i befintligt arbetsyte-JSON och använder samma ägargräns, revisions-CAS och atomiska audit. Link/återtag undantas från automatisk avstämning och meddelandeförberedelse. Node använder skrivtransaktion och additiv relationstabell med audit. Återtag raderar varken relationens historik eller originalen och ändrar inga tidigare allokeringar.

Vid en enda rapportbetalare kan den ekonomiska huvudraden visa rapportens avsändare och exakta betalningsreferens med etiketten **manuellt verifierad underlagskoppling**. Flera individuella betalare visas som en komplett detaljgrupp. En generell betalningsreferens blir aldrig OCR genom kopplingen. Projektionen används inte av den automatiska fakturamatchningen. Ändrade snapshots eller återtagen relation återställer separat presentation.

## Samma syntetiska korpus före och efter

Runner: `scripts/measure-bankgiro-ais-linking.mjs`. Resultat: `docs/measurements/bankgiro-ais-linking-before.json` och `bankgiro-ais-linking-after.json`.

Korpus: **15 scenarier, 13 strukturellt giltiga XLSX-filer och 2 felaktiga filer**. Samma original uppladdat igen ger sammanlagt **16 filförsök**, varav **14 lyckade importförsök**. Tre giltiga filer har avsiktligt fel/saknat konto eller för stor datumskillnad. De och två avvisade filer utgör fem negativa relationsfall. Tio fall har en relation som får bekräftas manuellt; ett av dessa återtas därefter. Inga verkliga kundoriginal eller kontouppgifter ingår.

Korpus-SHA-256: `b12046a67374a354b48b1f9262e31a1beec78f7e709c7bb122cbaeb11525f6d1`. Båda JSON-resultaten innehåller samma runnerhash, basrevision, kandidatens HEAD och uppgift om ändrad arbetskopia. Kandidatens HEAD under en smutsig körning är **inte** ett påstående om färdig kodcommit.

| Mått och nämnare | Före | Efter | Tolkning |
| --- | ---: | ---: | --- |
| Scenarier med ekonomisk dubbelräkning / 15 | 0 | 0 | Befintlig ekonomispärr bevarad |
| Felaktigt bekräftade relationer / 5 negativa | 0 | 0 | Fel konto, saknat konto, fyra dagar och felaktiga original godtas inte |
| Korrekt manuellt bekräftade rapportrelationer / 10 | 0 | 10 | Ingen automatisk bankidentitet påstås |
| Ekonomiska poster, hela korpusen | 16 | 16 | Två skilda AIS-insättningar med lika datum/belopp finns kvar |
| Bevarade individuella rapportrader | 14 | 14 | Inga underlag raderas för att dölja rader |
| Bevarade rapportimporter | 13 | 13 | Upprepad fil ger inget extra originalregister eller pengar |
| Synliga rader för 8 enskilda huvudinsättningar | 16 | 8 | Manuellt kopplade reviewunderlag finns i detalj i stället |
| Tillgängligt faktiskt rapport-/bankavsändarnamn / 8 enskilda fall | 2 | 8 | Två AIS-original hade redan känt namn; sex får rapportens namn separat projicerat |
| Exakt generell betalningsreferens synlig / 8 enskilda fall | 0 | 8 | Inledande nollor bevaras; ingen visas som OCR |
| Felaktigt skapade automatiska allokeringar / 15 | 0 | 0 | Även kundskillnad och tvetydig referens håller saldon kvar |
| Oförändrade befintliga allokeringar / 15 | 15 | 15 | Inkluderar en delbetald och en helt betald faktura |
| Korrekt oförändrat fakturasaldo / 15 | 15 | 15 | Samma fakturafacit före/efter |
| Korrekt oförändrad ekonomisk totalsumma / 15 | 15 | 15 | Rapportens reviewbelopp summeras inte som insättning |
| Manuella bekräftelsebeslut | 0 | 10 | Bekräftelsekapacitet i syntetisk domän, ingen produktionsgranskning |
| Lyckade återtag / 1 planerat | 0 | 1 | Historik och original bevarade |
| Total behandlingstid, 16 filförsök | 136,4359 ms | 129,4918 ms | Engångsmätning utan SLA; ingen hastighetsförbättring sluts av skillnaden |
| Tid per inkommande filförsök / 16 | 8,5272 ms | 8,0932 ms | Inklusive negativa filer, import, länk/återtag och domänavstämning |

Mätningen använder faktisk XLSX-parser, Sites domänimport, relationskommandon, presentationsfunktioner och befintlig avstämningsmotor. Den omfattar **inte** autentiserad API-kontroll, aktivt bankmedgivande, live R2/D1, SQLite-lås, originaluppladdning, nätverk eller produktionssaldo. Startregister och fixturer skapas före tidtagningen. Node och backendgränser kräver separata integrationsprov. En syntetisk korrekt avsändare är inte verklig bankverifiering.

## Begärd testmatris

Tabellen pekar ut täckningen. Slutligt körkvitto och browser-/produktionsgränser redovisas separat; en testfil på disk är inte i sig ett godkänt körresultat.

| Nr | Fall | Kontroll och evidens |
| ---: | --- | --- |
| 1 | Samma insättning AIS + XLSX | Mätkorpus `single-ais-xlsx`; båda nya relationssviterna |
| 2 | Två insättningar med samma datum/belopp | `two-independent-equal-amount-ais`; rapport får inte återanvändas till annan bankpost |
| 3 | Samlingsinsättning, flera betalare | `complete-two-payer-group`; komplett gruppantal/-summa och bevarade individreferenser |
| 4 | XLSX utan stabil bankidentifierare | Alla nya XLSX-fall; endast explicit manuell relation, aldrig automatisk allokering |
| 5 | Verifierad stabil identifierare | Befintlig strikt CAMT-/CSV-gruppkoppling i `sites/tests/bankgiro.test.mjs` och Node bankbevistester; XLSX saknar sådan identifierare |
| 6 | Samma fil två gånger | `same-original-twice`; befintliga XLSX API-tester samt relationsidempotens |
| 7 | XLSX och CSV av samma rapport | Befintlig review-/överlappsspärr och ekonomiskt undantagna reviewrader; ingen stabil individidentitet hittas på |
| 8 | Fel konto | `wrong-recipient-account`; nya domän/API-/Node-relationsprov |
| 9 | Fel totalsumma | `incorrect-declared-total`; parseravvisning samt gruppkontroll |
| 10 | Fakturakund skiljer sig från avsändare | `different-invoice-customer`; noll ny allokering, kundpost oförändrad |
| 11 | Redan delbetald faktura | `existing-partial-allocation`; allokering och återstående saldo oförändrade |
| 12 | Redan helt betald faktura | `existing-full-allocation`; ingen ny allokering eller överskjutande betalning |
| 13 | Flera fakturor med liknande referens | `ambiguous-invoice-reference`; befintliga exakta referens-/motpartsspärrar |
| 14 | Manuell bekräftelse | Tio positiva korpusfall; separat metod, anteckning och originalkontroller |
| 15 | Återtag | `manual-link-then-revoke`; nya relations- och API-prov bevarar pengar/original |
| 16 | Samtidiga importer/bekräftelser | Befintliga XLSX-importprov; nya Sites CAS- och Node skrivtransaktionsprov |
| 17 | Avbrott/lost response | Befintlig atomisk import; nya kvitto-/retryprov, ingen extra relation/audit |
| 18 | Förlorad bankanslutning | Nya API-/Node-prov för frånkopplad/utgången/ovalda konton |
| 19 | Ofullständig specifikation | `incomplete-declared-count`; domängrupp får inte bli delvis kopplad |
| 20 | Motsägelsefullt original | Nya SHA-/ankomstkvitto-/omtolknings-/snapshotprov |
| 21 | Rätt totalsumma på startsidan | 15/15 ekonomiska totalsummor; befintlig Dashboard-/ekonomisvit behöver passera slutgrinden |
| 22 | Rätt fakturasaldo | 15/15 fakturafacit; separata allokeringssviter |
| 23 | Ingen dubbelräknad historik | Inga nya betalningsrader/allokeringar; separat originalrelationsaudit och återtag |
| 24 | Mobil och desktop | Nya renderingsprov; faktiskt browserprov och dess skärmbredd anges i slutkvittot |
| 25 | Ägarisolering/revisionsspår | Nya autentisering-/Origin-/ägarkonto-/CAS-/auditprov i båda applikationerna |

## Slutgrindar och drift

Den ursprungliga rena baslinjen kördes: **578/578 Node och 912/912 Sites**. Fryst slutkod: **593/593 Node och 949/949 Sites**, inga fel eller hoppade tester, **89** syntaxkontrollerade filer, TypeScript och produktionsbygge godkända. Rena installationer gjordes i denna cykel; package-/lockfiler är oförändrade därefter. Rotens audit och Sites produktionsaudit har noll fynd; full Sites-audit behåller16 moderate utvecklingsfynd och0 high/critical. Obligatorisk high-grind passerar. Två kompletterade äldre testharnessar behövde realistiskt aktivt syntetiskt medgivande när den nya kontospärren infördes; befintliga affärsassertioner ändrades inte.

Oberoende granskning gav verkliga röda regressioner och rättningar för fullständigt AIS-ankomstbevis i Node, återtag av stale relation, bibehållen verifierad/delbetald status, förfalskade nästlade rapportuppgifter och komplett rapport efter en tidigare delrapport. Metadata går inte via allokering/utkast. Öppning av detalj startar inte längre ett implicit skrivande provideranrop. Aktuellt kontomedgivande kontrolleras även innan äldre pendingrapporter får bli automatiskt ekonomiska individer.

Sista samlade granskningen reproducerade även två olika giltiga XLSX-layouter av samma rapport kopplade till varsin oberoende AIS-insättning. En semantisk komplett rapportnyckel spärrar nu återanvändning över olika originalhashar/rad-ID:n. Originalen bevaras; verkligt skilda rapportsekvenser med samma belopp tillåts. Domän- och riktig API-regression var röda före rättningen och passerar efteråt. Slutlig omkörning av hela Sites-sviten:949/949; TypeScript och produktionsbygge godkända. Granskaren fann inga ytterligare betydande fel inom granskad omfattning. Verklig samtidighet med bankens egen återkallelse och autentisk bankidentitet ingick inte i granskarens verifiering.

Riktig Chromium-kontroll av de faktiska list-/granskningskomponenterna med isolerat syntetiskt minnestillstånd:1440×1000 och390×844; bekräftelse ger en huvudrad med rapportnamn/referens, återtag visar originalraderna igen. Under båda åtgärderna en ekonomisk625kr-post och noll allokeringar. Ingen horisontell dokumentoverflow. Detta ersätter inte autentiserad produktionsimport eller full appkedja.

Behörig läsning av hela `/api/state` i den befintliga webbläsarsessionen fann **ingen faktura med exakt nummer0599**. Den berörda AIS625kr-raden saknar versionsbundet ankomstkvitto; rapporten är review. Inget av detta ändrades. Betalningen får därför inte allokeras till en påhittad faktura eller etiketteras bankverifierad. Den nya bekräftelsen för detta fall spärras tills tillräckligt intakt AIS-underlag och kontorelation finns. Syntetiska matchningsutfall säger inget om den verkliga fakturakunden.

Förpublicering: befintligt projekt/Sites39, policy/auth/DB/R2 och tre schemans lägen lästa; arbetsyterevision35. Komplett backupmanifest191/191 original,191 verifierade kopior; bevarad JSON-kvittokontroll omfattar5 API-poster med kvitto och113 utan. Ingen återställning eller ny backupkörning gjord. Återgång är återpublicering av tidigare Sites39 samt normal Git-revert av kod; ingen destruktiv databasmigrering behövs i Sites och Node-tabell/kolumn är additiva. Exakt kodcommit/Actions och publiceringskvitto kompletteras efter faktisk leverans.

Extern begränsning: rapportens löpnummer, generiska referens, datum och belopp är inte en gemensam stabil AIS-identitet. Automatiskt bankverifierad XLSX/AIS-koppling påstås inte färdig. Saknat eller motsägelsefullt AIS-ankomstkvitto får inte repareras genom att beräkna en ny historisk hash. Sådana fall ligger kvar som granskningskandidater med blockerande orsak. Autentiskt bank-/avtalsbevis och faktiskt tillåtet produktionsutfall återstår tills de verifierats separat.
