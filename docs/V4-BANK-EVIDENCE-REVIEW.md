# V4 – bankoriginal, parser och betalningsbevis

Granskad 28–29 oktober 2026 från `f549293` (main inklusive PR #12 och publicerad Sites-version 30). Denna delrapport beskriver lokal kod och syntetisk verifiering. **EXTERN BLOCKERING – INTE FULLSTÄNDIGT PRODUKTIONSVERIFIERAT.** Inget autentiskt individuellt Swedbankoriginal eller företagsspecifikt MIG-/kanalavtal har tillhandahållits till granskningen.

## Teknisk inventering

| Ansvar | Exakt kodreferens | Verifierbar funktion och begränsning |
| --- | --- | --- |
| Gemensam XML-läsning | `sites/lib/camt-xml.js:27` | Båda befintliga importörerna använder samma begränsade, icke-resolverande XML-läsare. Namnrymder, stödda versioner, canonical message containers, struktur, scalarfält och tvetydigheter kontrolleras. Ingen andra betalningsmotor införs. |
| Referenser från XML | `sites/lib/camt-xml.js:16`, `src/importers.js:118`, `sites/lib/bankgiro-parser.js:4` | Endast uttryckligen stödda remittance-strukturer når referensextraktorn. OCR, fakturadokumentnummer och meddelanden har separata kandidater/källvägar; okända inbäddade OCR-taggar avvisas. |
| Belopp, datum och batch | `sites/lib/camt-xml.js:96`, `sites/lib/camt-xml.js:100`, `sites/lib/camt-xml.js:113` | Individuella beloppsalternativ måste vara entydiga. Bokföringsdatum krävs, tillgängligt valutadatum valideras separat. Deklarerat antal, total, valuta och riktning kontrolleras inom respektive batch. |
| Rapportidentitet | `sites/lib/camt-xml.js:107` | Namespace/profil, meddelande-ID, rapport-ID, skapelsetid, tillgänglig BIC för kontoförande institut, samlingsreferens och valutadatum bevaras separat. Tomma uppgifter fylls inte i. Fälten är originalets uppgifter om avsändare/rapport och autentiserar inte banken. |
| Node CSV och camt | `src/importers.js:85`, `src/importers.js:136`, `src/importers.js:194` | Import av samma befintliga transaktionsformat. CSV utan explicit valuta kan fortfarande granskas, men är inte tillräckligt bankbevis för automatmatchning. XML kräver BOOK, uttrycklig valuta och stöd för strukturen. |
| Node individuell bankidentitet | `src/importers.js:125`, `src/importers.js:176` | EndToEndId används inte som bankens stabila transaktionsidentitet. Flera detaljbetalningar utan unika faktiska bank-ID:n behåller en granskad samlingspost med totalbeloppet en gång. Inga ID:n skapas ur OCR/belopp/radnummer. Ett ensamt detaljbelopp kan använda faktisk samlingsreferens. |
| Node original och verifiering | `src/db.js:205`, `src/db.js:327`, `src/reconciliation.js:21`, `src/reconciliation.js:33` | Exakta originalbytes/hash och API-original bevaras. Före automatik jämförs återhärledda belopp, valuta, datum, namn, OCR/referens och kandidater, bank-ID, organisationsnummer, eget/betalarens BG, samlingsreferens och aggregatflagga med sparade fakta. Ingen hänvisning till oförändrad hash räcker om de härledda fälten har ändrats. |
| Sites förhandsgranskning/original | `sites/lib/bankgiro-parser.js:17`, `sites/lib/bankgiro-parser.js:82`, `sites/lib/bankgiro-service.ts:19`, `sites/lib/bankgiro-service.ts:29` | Samma parser i preview och serverns återläsning av ägt R2-original. Storlek och SHA-256 kontrolleras innan bankfakta används. Befintlig konto-/samlingskoppling och revisionslogik återanvänds. |
| Sites metadata | `sites/lib/domain.ts:8`, `sites/lib/domain.ts:154`, `sites/lib/domain.ts:199`, `sites/lib/domain.ts:208` | Separat `reportEvidence` bevaras i specifikation, godkänd generisk filimport och återverifiering. Rapport-ID/BIC kopieras aldrig till kund-, OCR- eller fakturafält. |

## Reproducerade luckor och åtgärder

Baslinjens importörer laddades från `git show HEAD:<fil>` i minnet med enbart syntetiska original. Baslinjen accepterade följande i både Node och Sites: okänd `.99`-version, främmande namnrymd på betalarfält, en okänd `RfrdDocInf/OCR`-struktur och flera motstridiga individuella beloppsalternativ. Sites accepterade även `TxDtls/RvslInd=1`. Samtliga dessa fall avvisas nu av importörerna.

Den oberoende slutgranskningen fann även en global descendant-sökning som kunde läsa `CdtrRefInf` under `RltdRmtInf/Bogus` och felaktigt ge kandidaten en `RmtInf/Strd`-källväg. Referens- och dokumentnoder hämtas nu enbart från exakta stödda `TxDtls/RmtInf/Strd`-barn; okända `RltdRmtInf`-strukturer avvisas. En legitim `RmtId` utanför remittance-fältet kan inte bli OCR. Regressionen körs i båda importörerna.

Node kunde dessutom skapa ett bank-ID ur samlingsreferens, referenstext och belopp. Den fallbacken har tagits bort. Saknad eller upprepad individuell identitet ger en samlingspost för kontroll. Saknat stabilt API-ID och saknat explicit bank-ID i fil stoppar automatisk bankverifiering.

En giltig originalhash skyddade inte alla härledda matchningsfält. Exempelvis kunde ett ändrat organisationsnummer prioriteras framför en annan betalare i originalet, eller en konfliktkandidat tas bort ur referensanalysen. Den gemensamma originaljämförelsen stoppar nu sådana ändringar. Regressionen med annan faktisk bankbetalare och injicerat fakturakundsorganisationsnummer lämnar fakturan obetald med **0 allokeringar**.

XML-byteavkodning kräver UTF-8. Felaktiga UTF-8-bytes får inte tolkas om som Windows-1252 och därmed ge ett annat betalarnamn. Befintlig Windows-1252-fallback för CSV finns kvar. En uttryckligen annan XML-kodning stoppas tills den har implementerats och verifierats som en separat stödd profil.

## Stödda profiler och externa gränser

De generiska ISO-profilerna är uttryckligen begränsade till camt.053.001.02, camt.054.001.02, camt.053.001.08 och camt.054.001.08, med respektive canonical `BkToCstmrStmt/Stmt` eller `BkToCstmrDbtCdtNtfctn/Ntfctn`. Endast den tolkade delmängden av ekonomiska och remittance-strukturer stöds. Okända/utökade betalningsstrukturer, återföringsinformation, flera beloppsalternativ och främmande namnrymder kräver kontroll. Parsern påstår **inte** att en fil överensstämmer med hela ISO-XSD:n, Swedbanks MIG eller en verifierad avsändarsignatur.

Swedbanks aktuella [MIG-index](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) listar MIG 1.0 och MIG 2.0 med samma camt.054.001.02-namespace. Därför kan namespace aldrig fastställa företagets avtalade MIG. Swedbank Envelope är inte implementerad genom att söka efter ett inbäddat Document. En sådan originalfil stoppas tills dess faktiska kuvertformat och behöriga kanal har verifierats. Företagsavtal, godkänd originalfil, relevant MIG/XSD, konto och bankbekräftad kanal behövs enligt [kanalutredningen](V4-SWEDBANK-CHANNELS.md).

Node AIS-kontots identitet skapas i den autentiserade bankhämtningens valda kontokontext. Vanliga transaktionspayloads innehåller inte alltid mottagarens kontonummer; originalets SHA bevisar då inte självständigt kontokopplingen. Den befintliga autentiserade kontohämtningen och bankmedgivandet förblir källgränsen. Det är inget bevis för tillgång till Bankgirots individuella rapporter.

Rapportens eget ID bevaras som separat metadata i transaktionen; ekonomisk idempotens använder redan existerande originalhash och faktiska banktransaktionsidentiteter per konto. Ingen ny hämtningskanal, fiktiv Swedbankadapter, internetbanksscraping eller betalningsinitiering har införts.

## Kompatibilitet och bevarande

Den striktare grinden kan lämna äldre importer för granskning när de saknar namespace, BOOK, originalvaluta eller verklig bankidentitet, använder tidigare syntetiserat bank-ID eller innehåller äldre annorlunda referensextraktion. Sådana original, rad-ID:n, saldon, tidigare allokeringar och revisionshistorik tas inte bort eller skrivs om av verifieringen. Automatiken granskar om fakta; den gör ingen automatisk historisk återföring. Administratören behöver kontrollera originalet och den befintliga korrigeringsvägen innan en äldre koppling ändras.

En ensam camt-detalj med ett separat individuellt bank-ID tappade tidigare sin faktiska samlingsreferens. Parent-kopplingen bevaras nu även för ett ensamt barn när barnets faktiska ID skiljer sig från samlingspostens. Regressionen använder ett bevarat syntetiskt camt-original tillsammans med API-samlingsposten och verifierar ett ekonomiskt belopp och en fakturaallokering.

Node använder nu den delade rena modulen `sites/lib/camt-xml.js`; en fristående Node-distribution behöver därför inkludera denna fil tillsammans med `src/`. Repositoryts fullständiga checkout innehåller beroendet. Sites-modulen har inga Node-/databas-/nätverksberoenden och följer med Sites-källan.

Inga produktionsdatabaser, R2-original, medgivanden, integrationer eller hemligheter har använts eller ändrats av denna delgranskning. Ingen datamigration behövs för de nya rapportmetadatafälten: Node återanvänder befintligt JSON-bevis och Sites befintligt arbetsyteformat.

## Riktad verifiering

- **312/312 Node-tester**: fullständigt `npm test` från repositoryts rot efter de sista parser-/bevisregressionerna; 0 fel och 0 hoppade över.
- **393/393 Sites-tester**: fullständigt `npm test` från `sites/`; 0 fel och 0 hoppade över.
- Syntetiska API-fixtures går nu genom den verkliga API-normaliseraren, inklusive kandidatbevis. Organisationsnummer och samlingsrelationer testas mot faktiskt bevarade syntetiska CSV-/camt-original där fälten verkligen finns, inte genom extra påståenden på en normaliserad AIS-rad.
- Samma syntetiska angreppsoriginal körs genom båda befintliga importörerna via `sites/tests/helpers/camt-integrity.mjs:14`. Nya testsamlingar: `test/camt-integrity.test.js:1` och `sites/tests/camt-integrity.test.mjs:1`.
- Bevis-/integritetsregressioner och organisationsnummerangreppet: `test/bank-reference-storage.test.js:76`, `test/bank-reference-storage.test.js:98`, `test/bank-reference-storage.test.js:111`, `test/bank-reference-storage.test.js:120`.
- Befintligt verkligt tvåprocessprov körs med syntetisk SQLite och explicit bankvaluta/bankreferens. En importerad betalning ger en allokering även efter omstart och återimport.
- Diffens whitespacekontroll för delgranskningens spårade källor och tester passerade. Fullständiga gemensamma test-/byggresultat redovisas i V4-slutleveransen, inte genom att återanvända äldre V2/V3-resultat.

Samtliga nya exempel är syntetiska. Ingen av ovanstående tester uppfyller acceptanskriteriet om företagets autentiska Swedbankoriginal eller verklig produktionsavstämning.
