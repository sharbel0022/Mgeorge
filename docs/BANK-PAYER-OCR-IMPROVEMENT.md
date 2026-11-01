# MGEORGE – verklig betalare och OCR, 1 november 2026

**Kodförbättringarna är verifierade lokalt. Målet 9,5/10 är inte uppnått:** autentiskt individuellt Swedbankoriginal, företagets avtalade rapportprofil och OCR-regler saknas fortfarande. Kodcommit `c031b2e81374df7835c18462e1e32b2c4b5d0d89` finns på main och båda Actions-jobben är godkända i körning 41307488778. **Sites-version 37 är publicerad (succeeded)**. Exakt källa, arkiv, deployment och bevarande finns i `BANK-PAYER-OCR-PUBLICATION.json`.

## Vad som faktiskt var fel

- Node tappade XML-betalarens organisationsidentifierare/adress. Sites kunde lägga `AnyBIC`, kundnummer eller ett ospecificerat `OrgId/Othr/Id` i organisationsnummerfältet. Ett nationellt `COID` utan svensk utfärdare är inte ett svenskt organisationsnummer.
- API-schemat `SEBG` behandlades som generell referens. Ett uttryckligt felaktigt Bankgiro-OCR kunde därför undgå kontrollsifferspärren. XML-OCR fick också en artificiell `$.OCR`-källa, utan verkligt transaktionsindex. Exakt fältråvärde saknades i kandidaterna.
- Bankgiro-CSV tappade referenstypen och avvisade vissa filer med separata referenskolumner. De befintliga Node-/Sites-motorerna återanvänds; ingen parallell betalningsmotor har byggts.
- En betalarrelation i Node kunde skrivas trots att dess revisionshändelse misslyckades. Den ologgade relationen kunde därefter auktorisera automatisk matchning.
- Sites manuella matchningsgräns accepterade uttrycklig återföring/återbetalning som vanlig fakturabetalning. Giltig återbetalning med rätt effekt måste däremot fortsätta fungera.
- Node-mejlgranskning kallade alla referenser OCR och kunde visa manuella namn utan manuell etikett. Allokerade betalningar kunde också visa delbetalningsstatus framför bankkonflikt.
- Oberoende review hittade ytterligare kedjefel: ändrade typade betalar-ID:n för samma bank-ID kunde försvinna; en kompletterad samlingsposts tidigare betalaridentitetskonflikt kunde tappas eller maskeras av lön/refund-text. Dessa har reproducerats och rättats.

## Implementerad kedja

`sites/lib/payer-evidence.js` är en gemensam ren normaliseringsmodell, använd också av Node. Namn, exakt `rawValue`, roll, individuell/samlad omfattning, fältsökväg, namespace, adress och varje identifierares typ/schema/utfärdare lagras separat. `camt-payer.js` läser endast den riktiga relaterade gäldenären vid inbetalning; mottagare, kontohavare och ultimate debtor får inte bli betalare. Svenskt organisationsmatchningsfält kräver uttryckligt `COID` och svensk utfärdare (`SE`); andra ID:n bevaras utan sådan uppgradering. Motsägande uppgifter blir granskningshinder.

Node lagrar modellen i en additiv `payer_evidence`-kolumn. Sites bevarar den i arbetsytans befintliga JSON och vid detaljhämtning. API-projektioner binds till bevarat råoriginal; en ny tolkning får inte legitimera ändrade bankfakta. Återimport jämför identifieraruppsättningar per typ och utfärdare, oberoende av ordning. Oförändrade flera kund-ID:n skapar ingen falsk konflikt.

De identiska `payment-references.js`-filerna bevarar råvärde, typ, schema och verklig källa. `SEBG` och uttrycklig XML `OCR`/`SEOCR` blir OCR; `SCOR`, okända scheman och generella referenser behåller sin betydelse. Inledande nollor finns kvar. Flera referenser bevaras och kontrolleras av befintliga konfliktregler. Modulus-10 är separat från den valfria logiska avtalskontrollen `validateOcrAgreement`; utan uttrycklig regel blir avtalsstatus `unknown`. Ingen företagsregel har antagits eller aktiverats.

`reference-evidence-compat.js` tillåter en äldre referensversion endast om de tidigare faktiska kandidaterna, typerna, källorna, prioriteringen, varningarna och vald referens fortfarande är exakt desamma. Nya OCR-konflikter blir aldrig betrodda genom versionsbyte. Äldre XML med ändrad källsökväg kan behöva återläsning och granskning. Historiska saldon/allokeringar skrivs inte om av denna kontroll.

Betalarrelation och audit sparas nu i samma SQLite-skrivtransaktion. Befintliga `BEGIN IMMEDIATE`, idempotens, beständig import och Sites revisions-CAS behålls. Betalarkonflikt är ett hårt ärvt hinder även efter samlingskomplettering och vid manuell matchning. Återföringar kan inte användas som fakturabetalning. Legitim återbetalning testas som positiv kontroll.

Gränssnittet behåller svartvit design och sex huvudfält. Banknamn, fakturakund, manuella uppgifter och förslag skiljs åt. Tekniska råvärden/fältsökvägar är utfällbara i båda apparna. Fakturaförslag ändrar inga saldon. De begärda förklaringarna för okänd betalare, saknad bank-OCR och overifierat fakturaförslag finns i desktop-/mobilpresentationen.

## Mätmetod och korrigerat facit

Den **första baslinjen skapades före produktionsändringar** på `9d456563a15e9681d8500a0e09f3ef32314c67b1`: 25 original/47 parserkörningar. Den finns oförändrad i `measurements/payer-ocr-initial-before.json`, med dåvarande korpus bevarad som `test/payer-ocr-corpus-v1.js`.

Oberoende review visade att facit för ett `COID` utan utfärdare var för tillåtande. Facit korrigerades och ett positivt fall med uttrycklig `SE` lades till. Tabellen nedan använder **samma korrigerade 26 original och samma runner före och efter**, 49 utvärderingar (26 Node, 23 Sites; API-fallen i denna parsermätning körs i Node). Före kördes på en arkiverad exakt startrevision, efter på de nya filerna. Samma korpushash, källfilhashar, räknare och varje utfall finns i JSON. Resultat har inte uppskattats.

Betalarmåttet är rätt namn **och korrekt separat svenskt organisationsfält**, inklusive att lämna ospecificerat ID tomt. Ett felaktigt organisationsfält är inte detsamma som ett falskt banknamn eller ett produktionsverifierat beslut. Namn ensamt förbättrades inte dramatiskt; den huvudsakliga vinsten gäller rätt identifierarsemantik, proveniens och konfliktspärrar.

| Mätvärde | Före | Efter | Förändring |
| --- | ---: | ---: | ---: |
| Korrekt betalaridentitet när namn finns | 35/42 (83,33 %) | 42/42 (100 %) | +7, +16,67 procentenheter |
| Falska betalarnamn | 0 | 0 | 0 |
| Felaktigt ifyllda organisationsfält | 5 | 0 | −5 |
| Korrekt OCR, recall | 34/37 (91,89 %) | 37/37 (100 %) | +3, +8,11 procentenheter |
| OCR-precision / falska OCR-kandidater | 100 % / 0 | 100 % / 0 | Oförändrat |
| Korrekt fakturanummer, recall | 12/14 (85,71 %) | 14/14 (100 %) | +2, +14,29 procentenheter |
| Fakturanummerprecision | 100 % | 100 % | Oförändrat |
| Misslyckad parserimport i korpus | 1/49 | 0/49 | −1 |
| Genomsnittlig parserbehandling per utvärdering | 0.5097 ms | 0.5749 ms | +0.0651 ms (+12.8 %), extra säkerhetsanalys |

Prestandan är en lokal engångsmätning av 49 små parserutvärderingar; variation mellan körningar och uppstart påverkar tiden. Den mäter inte full import, nätverk eller en produktions-SLA.

Korpusens precision/recall är exakta för detta lilla syntetiska urval, inte en befolkningsskattning. OCR-måttet gäller korrekt extraktion/typ av bankfältet, även om OCR-kontrollsiffran är ogiltig; valideringsspärren mäts separat. Produktionsprecision, bankens fälttäckning och avtalsvaliditet är **inte mätta**.

En separat fryst matchningskorpus kör verklig tillfällig SQLite, bevarade syntetiska original, `reconciliationData`, analys och atomisk `runReconciliation`. Samma 23 scenarier/runner körs före och efter; en felaktig mottagarkontofil avvisas före lagring, varför beslutens nämnare är 22.

| Mätvärde | Före | Efter | Förändring |
| --- | ---: | ---: | ---: |
| Säkra automatchningar (TP) | 5/5 | 5/5 | Ingen förlorad säker täckning |
| Felaktiga automatiska kopplingar (FP) | 3 | 0 | −3 |
| Falsk acceptans av osäker betalaridentitet vid automatisk fördelning | 2/6 negativa identitetsfall | 0/6 | −2 |
| Falsk acceptans av ogiltig/egen OCR vid automatisk fördelning | 1/3 negativa OCR-fall | 0/3 | −1 |
| Automatchningsprecision / recall | 62,5 % / 100 % | 100 % / 100 % | +37,5 / 0 procentenheter |
| Behöver granskning | 14/22 (63,64 %) | 17/22 (77,27 %) | +3 osäkra fall stoppas |
| Rätt scenarioresultat | 20/23 | 23/23 | +3 |
| Extra ekonomiska poster vid återimport | 0 (1 betalning, 1 allokering) | 0 (1 betalning, 1 allokering) | Oförändrat säkert |
| Avbruten motstridig import | 1 avvisad; 0 nya rader | 1 avvisad; 0 nya rader | Ingen partiell ekonomisk import |
| Behandlingstid genom import och avstämning per bankradsförsök | 3.4344 ms | 3.4620 ms | +0.0276 ms (+0.8 %) |

Falsk acceptans mäts vid den riktiga automatiska allokeringsgränsen mot oberoende märkta negativa scenarier. Sex fall saknar eller motsäger säker betalaridentitet; tre fall har ogiltig eller företagets egen OCR. Räknarna avser faktiska felaktiga automatiska fördelningar, inte enbart felaktiga parserkandidater. De är inte produktionsstatistik över bankverifierade identiteter eller giltighet mot företagets ännu okända OCR-avtal.

Behandlingstiden omfattar parsning/normalisering/lagring samt originalkontroll, analys och atomisk avstämning: 22 körda scenarier med 27 inkommande bankradsförsök i vardera revisionen. Databasskapande, faktura-/historikuppsättning, nätverk och det före lagring avvisade kontofallet ingår inte. Flera indata i ett scenario räknas i nämnaren. Detta är en liten lokal engångsmätning; procentförändringen ska inte tolkas som statistiskt säker eller som produktions-SLA.

De tre falska automatchningarna var ogiltig SEBG-OCR, motstridiga COID och ändrat typat betalar-ID vid samma-ID-återimport. Matchningsmätningen avser Node, inte en uppmätt produktions- eller Sites-matchningsgrad. Sites motsvarande regler/proveniens/återbetalningar verifieras av integrationstester, utan att procentsatserna extrapoleras.

Reproduktion:

```powershell
node scripts/measure-payer-ocr.mjs docs/measurements/payer-ocr-after.json
node scripts/measure-bank-matching.mjs --source-root . --output docs/measurements/matching-after.json
# Använd --source-root till en arkivering av 9d45656 för före-körningen.
# Extraktionsrunnern tar även --revision 9d456563a15e9681d8500a0e09f3ef32314c67b1.
```

## Testbevis och alla 25 efterfrågade scenarier

Slutlig fryst lokal kontroll: **570/570 Node**, **858/858 Sites**, noll fel/hoppade; **82 JavaScript-filer** syntaxkontrollerade; TypeScript och produktionsbygge godkända. Den inledande körningen var Node 519/519 samt Sites 782 godkända med två testfiler som föll på testharnessens Windows-fil-URL respektive `Event.returnValue`. Dessa testmiljöfel reproducerades och rättades utan att affärsassertioner togs bort. Full slutkörning omfattar samtliga tester.

| Scenario | Exekverat bevis |
| --- | --- |
| 1. Rätt OCR/betalare | Extraktionskorpus; matchningskorpus `exact-api`; befintlig reconciliation |
| 2. Saknad OCR | Extraktion 02; matchningskorpus; bankgiro-/presentationsfall |
| 3. Saknad betalare | Extraktion 03/25; matchningskorpus |
| 4. Två kunder/samma belopp | `payment-references.test.js`; matchningskorpus |
| 5. Två OCR | Extraktion 05; referenskonfliktregressioner i båda apparna |
| 6. Fel kontrollsiffra | Extraktion 06; nya `payment-reference-sources` och faktisk SEBG-matchningsmätning |
| 7. Inledande nollor | 0594/0599/000018 i samma korpus och UI-/lagringstester |
| 8. Samlingsbetalning/flera betalare | `importers`, `bankgiro`, `bank-state-integrity-q8`, `payer-completion-conflict` |
| 9. Flera fakturor | Extraktion 07/08; båda motorernas referens-/fördelningstester |
| 10. Delbetalning | Matchningskorpus; `reconciliation`, `domain`, UI-/bevarandetester |
| 11. Överbetalning | Matchningskorpus; `reconciliation`, `domain`, betalningsstatus |
| 12. Återbetalning | `manual-return-allocation` med positiv giltig refund och negativa ordinary/reversalfall |
| 13. Dubblettimport | Faktisk replaymätning; `payment-concurrency`; bankgiro-API |
| 14. Två bankkällor | Matchningskorpus; befintliga original-/duplicate-regressioner |
| 15. Motstridiga bank/fakturauppgifter | Båda payer-evidence-sviter; `bank-state-integrity-q8` |
| 16. Fel mottagarkonto | Avvisat original i matchningskorpus; `file-account-evidence` och camt-integritet |
| 17. Skadad XML | Gemensamma `camt-integrity`-tester i båda apparna |
| 18. Flera CSV-referenskolumner | Extraktion 21; nya payer-evidence och importerregressioner |
| 19. Detaljsvar utan individ | `bank-details.test.mjs`; extraktion 25; okänd-schemafall |
| 20. Avbruten import | Faktisk mätning med rollback; abrupt separat process i `payment-concurrency` |
| 21. Samtidig avstämning | Två riktiga Node-processer i `payment-concurrency`; befintliga Sites CAS-/synktester |
| 22. Äldre osäker koppling | `reference-evidence-compat`, `bank-api-original-q8`, `bank-reference-storage` |
| 23. Manuell rättelse/återtag | Befintliga undo-/historikfall; nya atomicitets- och ärvda konflikttester |
| 24. Saknat original | `bank-api-original-q8`, `bank-original-quality-cycle`, Node hash-/originaltester |
| 25. Individuell camt.054/flera referenser | Extraktion 05/07/08; riktiga parsers och bankgiro-API med syntetiska original |

`payer-verification-atomic` visar rollback när audit misslyckas. Åtta verkliga temporära databasfall i `payer-completion-conflict` visar att befintliga pengar bevaras men att betalaridentitetskonflikten fortsätter spärra nya manuella och automatiska fördelningar. Oberoende slutreview fann därefter inget kvarstående publiceringsblockerande fel.

Chromium visar sex huvudfält vid 1440 px och mobilkort vid 390 px utan dokumentoverflow. Mobilens dialog är 370 px, intern scrollbredd 368 px. Enter/Escape och retur till ursprungsknappen verifierades. Bilder och maskinläsbara observationer finns i `screenshots/payer-ocr/`. Webbläsarens filväljare stoppades av avstängd fil-URL-åtkomst i tillägget; ingen säkerhetsinställning ändrades. Ny faktisk filuppladdning i webbläsaren påstås därför inte vara verifierad; parser/API/integrationsfallen kördes.

## Säkerhetsgranskning och produktion

Node full npm audit: 0. Sites produktionsberoenden: 0. Full Sites-audit rapporterar **16 moderate**, **0 high/critical**, i utvecklingsverktygens beroendekedja till minimatch. Den begärda CI-grinden `npm audit --audit-level=high` passerar. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) anger rättning i minimatch 11.0.1. En tvångsnedgradering av ESLint eller ett oprövat major-override ingår inte; detta kvarstår som en avgränsad verktygsrisk, inte ett påstående om noll fulla Sites-fynd.

Läsande bankstatus den 1 november visade ansluten sex-timmarsbank utan rapporterat fel. Backupstatus visade komplett manifestpass, 191/191 original och 63 448 066 byte; API-omfattning 5 kontrollerade kvitton och 113 äldre utan kvitto. Detta bevisar inte individuell rapporttäckning eller ett nytt restoreprov. Arbetsytans revision före publicering är 31. D1-läsverktyget förkortar stora payloadfält, så ingen fullständig saldojämförelse kan hävdas från just det svaret; efterkontrollen jämför revision och konfiguration och redovisas i publiceringskvittot.

## Separat efterbedömning

Poängen behålls konservativt enligt senaste relevanta scorecard, trots uppmätta lokala förbättringar. Produktionsberoende acceptans får inte ersättas av syntetisk precision.

| Område | Före → efter | Förbättring / testbevis | Produktionsbevis | Kvarstående problem |
| --- | --- | --- | --- | --- |
| Verklig betalare | 6,5 → 6,5 | 35/42 → 42/42; typ, råvärde, konto-/roll-/konfliktkedja | Läsande status; inget autentiskt individfacit | Avtalad MIG och behörigt bankoriginal |
| Verklig OCR/fakturareferens | 6,5 → 6,5 | OCR 34/37 → 37/37; invoice 12/14 → 14/14; SEBG, råkälla, konflikter | Ingen verklig bank-OCR/avtalsverifiering | Företagets OCR-regel och autentiska fält |
| Bankgiroimport | 8 → 8 | Multi-CSV, upprepade identifierare, faktiska källvägar; hela sviter | Ny versionspublicering redovisas separat | Rätt bankprodukt/profil/leveranskanal |
| Automatisk matchning | 7,5 → 7,5 | FP 3 → 0; TP 5/5; atomicitet, refund- och ancestorgränser | Inga produktionsallokeringar startade för test | Representativa verkliga matchningsutfall |
| Betalningshistorik | 8 → 8 | Bevarade konflikter/audit och atomisk relation; inga historiska belopp raderas | Ingen testhistorik skapad i produktion | Node har fortsatt global senaste-100-audit, inte full betalningsspecifik paginering |
| Betalningsstatus | 8 → 8 | Konflikt före del-/överbetalningsetikett; historiska pengar hålls åtskilda | Ingen faktisk ny betalning avstämd för test | Verklig saldo- och historikjämförelse |
| Automatisk bankhämtning | 8 → 8 | Samma konto/medgivande/intervall; striktare SEBG-/identitetsprojektion | Befintlig anslutning läst, ingen ny hämtning utlöst | AIS-status ger ingen individuell Bankgirorättighet |
| Användbarhet i betalningsvyn | 8 → 8 | Desktop/mobil/tangentbord; bank/manual/förslag och rådetaljer | Publiceringsrevision bevisas separat | Autentiserat verkligt individflöde och fysisk mobil återstår |

## Verifierad leverans och läsande efterkontroll

Samma befintliga projekt publicerades som version **37**, Sites-källa `306c0856c5f08d7fe19b73aff9b1879f40263e84`, deployment `appgdep_6ae733e12bd88191bbe9dbaf20478a1e`, **succeeded 2026-11-01T12:43:32Z**. Samtliga 27 ändrade Sites-filer matchar main-innehållet. Typkontroll och produktionsbygge kördes även i publiceringskällan. Första paketeringsförsöket stoppade på två saknade lokala byggberoenden; rätt installerare kördes och därefter passerade kontrollerna. Ingen felaktig version publicerades.

Projektidentitet, åtkomstpolicy, auth-konfiguration, DB/R2, runtime-revision **9** och befintliga schema-ID/lägen är oförändrade. Arbetsyterevision är **31 före, efter publicering och efter webbläsarkontroll**, med samma ändringstid. Inga ekonomiska kommandon, bank/Gmail-synkar eller kundutskick utlöstes för kontrollen. Fullt payloadfält lästes inte; påståendet begränsas till oförändrad revision och observerad konfiguration/status.

Den publicerade översikten och banklistan kunde läsas **autentiserat i Chromium**. De sex huvudfälten samt samtliga tre förklaringar (okänd betalare, saknad bank-OCR, overifierat fakturaförslag) verifierades i den riktiga banklistan, utan att öppna bankdetaljer som kan utlösa en detaljhämtning. Inga verkliga kunduppgifter eller produktionsskärmbilder sparades i repositoryt. Detta är begränsad läsande produktionsbevisning, inte ett verifierat individuellt import-/matchningsflöde.

## Nästa externa åtgärd

Bekräfta företagets **Inbetalningar bankgiro**, exakt camt.054/camt.053-produkt/MIG/XSD/Envelope och OCR-avtal. Tillför ett uttryckligen tillåtet, anonymiserat individuellt original med känt facit och motsvarande samlingspost. Importera först manuellt via befintlig Bankgiroimport, jämför källfält/identitet/referenser/konto/belopp läsande och dokumentera utfallet. Automatisk rapportleverans kräver separat avtalad behörig transport och nycklar; vanlig AIS innebär inte denna rättighet. Se den källbelagda `BANK-PAYER-OCR-CHANNELS.md`.

Ingen BankID har kringgåtts, skyddad banksida skrapats, kundmejl skickats eller bankbetalning utförts. Ingen verklig ekonomisk testallokering har begärts. Inget arbete påstås fortsätta i bakgrunden utan en faktisk fortsättningskörning.
