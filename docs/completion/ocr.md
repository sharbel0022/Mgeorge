# OCR och Gmail: slutföranderättning och verifieringsgräns

Datum: 2026-11-06. Utgångspunkt: PR 61, `30dfaa97bb7ce2118b4756205347d4a96e8be6ab`. Slutlig produktkod i detta delarbete: **`a5d8ad81f4bb0e177a119108cff89ad8c830e259`**. Arbetsbranch: `work/completion-ocr`; integration, fullständig slut-CI och publicering ägs av huvudspåret.

**Resultat:** fyra tidigare saknade, korrekta obligatoriska fält återvinns i den kända utvecklingsmängden, från **70/100 till 74/100**, utan falska eller förlorade korrekta fält. Köåterhämtningen bevarar nu sparade resultat under tillfälliga lagringsavbrott. Gmail-status skiljer ett tillåtet försök från historisk hämtningshälsa. **Oberoende OCR-acceptans med 85 % recall och 98 % precision är fortfarande inte uppnådd.**

Inga produktionsdokument, bankuppgifter, medgivanden, providerinställningar eller scheman ändrades i detta delarbete. Alla skrivtester använde isolerade syntetiska underlag. V3 lästes eller kördes inte.

## Rättningar

### Slutna valuta-, datum- och summaceller

Två tidigare lokala, opublicerade produktcommits granskades och portades från `80a6d79` och `17ce7cb`. Den nya testmatrisen kördes först mot PR 61 utan produktfixarna: **146 fall, 92 pass och 54 fail**. Samma matris passerade **146/146** efter portningen.

- En komplett ISO-valuta följd av exakt en sluten, känd OCR-betalningsinstruktion kan läsas, exempelvis `SEK. Ange OCR vid betalning.`. Instruktionen skapar inte ett referensvärde. Riktiga skadade eller motstridiga referenser och valutor på samma rad ingår fortfarande i hela fältkontrollen.
- Layoutplaneraren känner igen de redan stödda datumetiketterna `Faktureringsdatum`, `Betalas senast` och `Oss tillhanda senast`. Hela etiketten och en ensam geometriskt ägd datumcell krävs. Okänd grannroll, konkurrerande etikett, ytterligare värde, trasigt datum eller avlägsen cell stoppar kopplingen.
- En komplett horisontell sammanställning med netto, moms och att betala kan koppla tre rubriker till exakt tre separata tryckta beloppsceller. Extra mängder, alternativa värden, skadade belopp, överlappning och andra rubriker i värdekorridoren blockerar kopplingen. Ingen saknad moms eller totalsumma räknas fram.
- Varje ursprungligt OCR-ord, dess ruta och dess faktiska confidence bevaras exakt en gång. En skadad momssats förblir skadad text och blir inte en påhittad korrekt momssats eller ett sammanslaget belopp. OCR-resultat får fortsatt inte automatiskt grön status på grund av hög nominell confidence.

Egna separata motprov kontrollerar skalning/förskjutning, sidgräns, källtext som inte matchar ordobjekten, överlappande rutor, skadad referens efter instruktion samt uttryckligt respektive otillräckligt partsägande: **24/24**. Dessa är syntetiska regressioner, inte en blind bildkorpus.

### Återhämtning under tillfälligt lagringsavbrott

Ett konkret nytt fel reproducerades i `sites/lib/document-processing.ts`: om sista OCR-försökets resultat redan hade sparats men den avslutande tillståndsskrivningen avbrutits, fångade återhämtningen alla felläsningar av originalet. Även ett tillfälligt R2- eller strömfel följdes av `lease_expired`, raderad lease och ett misslyckat jobb. Det förstörde bindningen som krävs för att återanvända det bevarade kvittot.

Rättningen skiljer på påvisat integritetsfel och tillfällig läsotillgänglighet. Vid ett tillfälligt fel behålls resultat, försökstal, utgången lease och original. En jämför-och-skriv-uppdatering sätter endast `error_code=original_unavailable`, en beständig 60-sekunders väntan för nästa originalkontroll och uppdateringstid. Den använder exakt ägare, dokument, tillstånd, försökstal, lease, extraktion och tidigare deadline. Aktuell källa och avsaknad av registrering kontrolleras vid skrivningen.

Högst två återhämtningskandidater granskas per pass. De uppskjutna kandidaterna väljs inte igen före sin väntetid; en senare frisk kandidat kan därför återhämtas. Efter en ny lyckad kontroll av original och kvitto går resultatet till mänsklig granskning. Inget nytt OCR-försök, ingen automatisk registrering och inga ekonomiska poster skapas. Ändrat/saknat original, felbundet kvitto, återkallad källa och konkurrerande registrering godtas fortsatt inte.

Den nya korrigerade RED-körningen gav **40/43 pass, tre avsedda produktfel**. Samma svit gav **43/43** efter rättningen. Fallen omfattar objekt- respektive strömavbrott, omstart med bevarad väntan, senare återhämtning, en frisk tredje kandidat samt konkurrerande lease och manuell registrering. Första testförsöket hade dessutom ett ofullständigt syntetiskt registreringsrecord; det felet och dess rättade fixtur redovisas i råloggarna.

### Gmail: hälsa och rätt till ett nytt försök är olika observationer

`fetch_ready` behåller sin tidigare betydelse: en nyligen verifierad lyckad hämtning. En gammal eller ännu inte verifierad hämtning får därmed fortfarande `fetch_ready=false`. Den flaggan ska inte användas som ett generellt förbud mot ett annars tillåtet synkförsök.

Det additiva statusfältet `sync_eligibility` innehåller:

```json
{
  "eligible": true,
  "reason": "eligible",
  "next_eligible_at": "en observerad ISO-tid eller null"
}
```

Fasta negativa skäl är `not_configured`, `disconnected`, `mailbox_mismatch`, `paused`, `reconnect_required`, `blocked`, `running`, `lock_expiry_unknown`, `retry_after` och `minimum_interval`. Statusen kontaktar inte Gmail och ändrar varken anslutningen eller ett lås. Ingen token, lease eller rå feltext lämnas ut. Det verkliga synkanropet kontrollerar fortfarande aktuell auktorisering, konto, medgivande, pauser, väntetider och SQL-lås; en statusobservation är ingen behörighetsbiljett.

Huvudspårets granskning hittade en ytterligare defekt: en korrupt låsdeadline kunde vara lexikalt senare än nu enligt SQL men ogiltig för `Date.parse`. Det gav `RangeError` i statusläsningen. Tre frysta regressioner gav **124/127 pass** före rättningen. Endast en exakt kanonisk ISO-deadline får nu bli en nästa-försökstid. Okänd deadline ger `eligible=false`, `lock_expiry_unknown` och nulltid, utan att statusläsningen fallerar eller ett lås ändras. Slutlig Gmail-svit på produkt-SHA ovan: **127/127**.

Detta bevisar inte att den externa automationen dispatchar ett verktygsanrop. En manuell direktkörning, en heartbeat och en konfigurerad timkadens är fortfarande olika slags bevis. Återkommande schemapass behöver verkliga externa körkvitton kopplade till appens `gmail.automatic.invoked` och tillhörande resultat.

### Begränsade testmoduler

Följdcommits `85c80e0` och `234379d` ersätter nästlade source-kodade data-URL:er i Gmail- och reconciliation-fixturer med tillfälliga filer vars namn är SHA-256 av modulbytesen. Identisk modultext behåller sin identitet; varje fixturs globala nyckel, databas och miljö är fortfarande separata. Bytesen kontrolleras vid återanvändning och katalogen städas efter testerna. Inga produktfunktioner eller befintliga affärsassertions ändrades av dessa två harnessfixar.

## Ny mätning på bevarade utvecklingsobservationer

Bas och slutkod läste exakt samma tolv bevarade råobservationer från den tidigare verkliga optiska körningen `optical-v2-known-01`. Tio är normala utvecklingsbilder och två är stressbilder. Originalresultatets SHA-256 är `d6db21532448fb8f8bb4a103c35f1b61cc44132392ca7ba12a0ed4a98c58c1dc`; original, rådata, facit, metadata, skript och källfiler binds i replaykvittona. Hasharna kontrollerades före och efter.

**Denna jämförelse gjorde noll nya optiska anrop och 24 parseranrop per kandidat.** Upprepade återspelningar när källan frystes är inte nya bilder eller nya oberoende observationer. Node och Sites använder samma tio normalbilder och får inte räknas som tjugo bilder.

| Population och fält | PR 61 | Slutkod | Felvärden | Kommentar |
| --- | ---: | ---: | ---: | --- |
| Normal, obligatoriska 10 fält | 70/100 | **74/100** | 0 → 0 | 74 % uppmätt recall |
| Normal, samtliga 13 fält | 93/130 | **97/130** | 0 → 0 | 74,62 % uppmätt recall |
| Stress, obligatoriska 10 fält | 8/20 | 8/20 | 0 → 0 | Separat stresspopulation |
| Stress, samtliga 13 fält | 10/26 | 10/26 | 0 → 0 | Oförändrad |

Båda motorerna är överens. Fyra unika fält återvinns: netto och total i normal-07, förfallodatum i normal-08 och valuta i normal-10. Inget tidigare korrekt fält förloras. Ingen bild blir grön. Den uppmätta fältprecisionen i denna lilla, kända mängd är 100 %, vilket **inte** är bevis för 98 % precision på en oberoende population.

Fullständiga komprimerade före-/efterresultat och ett kompakt fältkvitto finns i [evidenskatalogen](ocr-evidence/manifest.json) och [utvecklingssammanställningen](ocr-evidence/development-summary.json). Råobservationernas tidigare arkivlocator finns i `docs/final95/ocr/raw-capture-location.json`.

## Kvarstående tekniskt OCR-arbete

26 obligatoriska fält saknas fortfarande: **6 partsnamn, 9 organisationsnummer, 8 momsbelopp samt 1 fakturanummer, 1 fakturadatum och 1 förfallodatum**. Minst elva ytterligare korrekta obligatoriska fält behövs för att nå 85/100 även i denna redan kända mängd. Det är produkt- och utvärderingsarbete, inte ett bankavtalsberoende.

De sex saknade namnen är omärkta brevhuvuden. De nio organisationsnumren finns i sådana block, blandade kolumner eller fristående sidfötter. Ett uttryckligt mottagarblock och endast ett annat företagsnamn bevisar inte att det andra namnet är fakturautställare: det kan tillhöra exempelvis ett ombud eller factoringbolag. En korrekt kontrollsiffra eller känd avsändaradress tillför inte den saknade källrollen. De nya motproven bevarar därför följande gräns: ett uttryckligt sammanhängande leverantörsblock äger sitt organisationsnummer, men ett omärkt huvud eller föräldralös sidfot gör det inte.

Nästa säkra kontrakt behöver en verifierbar utställarroll och en sluten namn-/adress-/organisationsregion, med negativa fall för ombud, mottagare, flera juridiska personer, främmande sidfot och konkurrerande kolumner. Om en identifierad header endast kan erbjudas som förslag behöver den en egen synlig osäkerhetssemantik och får inte ge ett verifierat motpartsfält eller automatiskt registreringsbeslut. Den osäkerheten har inte dolts genom att ändra nuvarande facit eller confidencegränser.

De saknade momsvärdena innehåller bland annat faktiskt observerade skadade procentsymboler eller blandad läsordning. Ingen text som `25 Yo`, `25 90` eller `25 960` rättas till en momssats utifrån förväntat facit. Vidare arbete kräver bättre dokumenterade optiska observationer eller ett verifierat cellkontrakt som bevarar hela den negativa kontrollen. Kvarvarande datum-/nummerfall behöver säkert separerade grannceller utan att okända adress- eller identitetsfragment försvinner.

En ny slutkandidat behöver därefter ett fryst, förregistrerat och oberoende förstaprov enligt projektets utvärderingsprotokoll. Det här delspåret förbrukade ingen V3-körning. Ingen poäng på 9,5 eller kommersiell OCR-acceptans följer av dessa resultat.

## Verifiering och källbindning

| Körning | Källa | Resultat |
| --- | --- | --- |
| Nya slutna fält/celler, RED | PR 61 + endast nya tester | 92/146 pass, 54 avsedda fel |
| Samma fält/celler, GREEN | portade produktfixar | 146/146 |
| Egna gräns-/proveniensprov | `5c903fb` | 24/24 |
| Köåterhämtning, korrigerad RED | före `d3cea70` | 40/43, tre avsedda fel |
| Köåterhämtning, GREEN | `d3cea70` | 43/43 |
| Bred Node-fokus | `5c903fb` | **848/848**, 64,717 s |
| Bred Sites-fokus inklusive ändrade reconciliation-fixturer | `5c903fb` | **706/706**, 64,427 s |
| Lockdeadline, RED | `5c903fb` + endast tre tester | 124/127, tre avsedda fel |
| Slutlig Gmail | `a5d8ad8` | **127/127**, 25,884 s |
| Skyddad `npm run check`, syntax och diffkontroll | `a5d8ad8` | PASS |
| Utvecklingsreplay | exakt PR 61 respektive `a5d8ad8` och filhashar | Resultat enligt tabellen ovan |

Alla avslutade testkörningar i tabellen har noll skip, cancelled och TODO. Delmängder och omkörningar ska inte summeras som unika tester. Den breda fokusens SHA föregår endast den senare Gmail-lockfixen; den är inte ett fullständigt testkvitto för hela den slutliga integrationen. Huvudspåret ska köra hela projektets föreskrivna CI på exakt den kod som ska mergas och publiceras.

Första Gmail-testförsöket för det nya statusfältet hade tre fixturfel eftersom automatiken inte hade initierats. Fixturerna initierades via den riktiga befintliga `processingSettings`-funktionen; produktens pausgräns och alla assertions behölls. De tidiga råloggarna är bevarade. Första försöket med en `/usr/bin/time`-wrapper stoppades innan tester startade eftersom kommandot saknades. Första typkontrollen stoppades korrekt av backportskyddet mot en symlänkad beroendekatalog; en fysisk kopia med samma låsfiler användes därefter och den ordinarie skyddade kontrollen passerade. Skyddet kringgicks eller försvagades inte.

### Reproducerbara fokuskommandon

Från repositoryroten, med installerade låsta beroenden:

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 --test-reporter=tap test/completion-ocr-boundary-review.test.js test/final95-*.test.js test/invoice-extraction.test.js test/invoice-reliability.test.js test/invoice-evidence-ocr.test.js test/ocr-layout*.test.js test/review-ocr-layout-boundaries.test.js test/ocr-bankgiro*.test.js test/sites-ocr-*.test.js test/cloud-ocr-trigger.test.js test/gmail*.test.js
```

Från `sites/`:

```sh
NODE_ENV=test node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 --test-reporter=tap tests/invoice-reliability.test.mjs tests/invoice-evidence-ocr.test.mjs tests/ocr-*.test.mjs tests/document-queue-recovery.test.mjs tests/quality-regressions-ocr-recovery.test.mjs tests/cloud-ocr.test.mjs tests/gmail*.test.mjs tests/reconciliation-preview.test.mjs tests/manual-multiple*.test.mjs
NODE_ENV=test node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 --test-reporter=tap tests/gmail.test.mjs
npm run check
```

Replayverktyget i evidenskatalogen tar tre absoluta argument: källcheckout, katalogen med det bevarade `optical-v2-known-01`-resultatet och en ny resultatfil. Det utför ingen OCR och ingen nätverksåtkomst. Källbindning, alla råloggarnas SHA-256 och båda beroendelåsen finns i `ocr-evidence/manifest.json`.
