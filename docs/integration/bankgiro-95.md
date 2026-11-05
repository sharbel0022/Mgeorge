# Agent 2 — Bankgiro och verifierad betalningsreferens

Datum: 2026-11-05. Branch: `feature/95-bankgiro`. Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.

## Leveransens omfattning

Målet är en spårbar betalningskedja där bankens faktiska betalare och betalningsreferens hålls åtskilda från fakturans mottagare och nummer. Den granskade basen innehåller redan BankgiroReportSource, Open Payments-berikning, CAMT-/XLSX-/CSV-import, SFTP-brygga, sparade original och försiktig avstämning. Den här branchen bygger vidare på dessa implementationer och skiljer nya rättningar från befintlig funktionalitet.

Leveransen är kod, isolerade tester, dokumentation och PR mot `main`. Produktionsoriginal har endast lästs genom befintliga autentiserade evidensverktyg. Ingen bankhämtning, import, fakturaregistrering, källregistrering, allokering, sammanslagning eller driftsättning har utförts som del av uppdraget.

**9,5/10 är inte styrkt i produktion.** Ett korrekt tolkat original och gröna syntetiska tester ersätter inte aktuell leverantörsbehörighet, mottagarkontobevis, en bankstyrkt koppling till AIS eller verifierad fakturarelation. Bankgirobetyget behålls på **8,5/10** och den befintliga totalen på **255/330 = 7,73/10**.

## Inventering: källor, parsers och lagring

| Del | Kod och ansvar | Verifierad avgränsning |
| --- | --- | --- |
| `BankgiroReportSource` | `sites/lib/bankgiro-source.js`, `bankgiro-source-registry.js`, `bankgiro-ingest.js`, `bankgiro-ingest-store.js`; Node-adapter `src/bankgiro-ingest.js`, Sites-adapter `bankgiro-ingest-service.ts` | Transportkontrakt, aktuell ägar-/företags-/källbehörighet, generationsspärr, kö, hash, återförsök, dubbletter och importkvitton. En konfigurationspost är inte i sig bankens tillstånd. |
| Normaliserad HTTPS-källa | `sites/lib/bankgiro-http-source.js` | Låst profil, källidentitet, tillåtna format, avgränsade svar och dokumenterade ankomstkvitton. Ingen godtycklig nedladdnings-URL följs. |
| SFTP-fallback | `bridge/bankgiro/src/bridge.js`, `main.js`, `bridge/bankgiro/README.md` | Separat brygga med SSH-värdnyckelkontroll, privata hemlighetsfiler, beständig spool och normaliserad lokal transport. CAMT054C-vägen behålls. Verkligt bankavtal, server och behörighet måste finnas. |
| CAMT/XML | `sites/lib/bankgiro-parser.js`, `camt-xml.js`, `camt-payer.js` | CAMT.053/.054 enligt parserns accepterade namnrymder; uttryckliga bokförda poster, SEK, riktning, rapport-/post-/detaljidentitet, typade referenser och betalarfält. DTD, felaktiga entiteter, motstridiga finansiella singletonfält, återföringar och ofullständiga summor stoppas. Det är inte ett generellt stöd för varje banks alla XML-varianter. |
| Swedbank XLSX | `sites/lib/bankgiro-xlsx.js` | Den identifierade profilen för insättningsuppgifter, med rapport-/löpnummer, betalningsrader och cellproveniens. Textreferenser och uttryckligt nollformat bevaras. Ett numeriskt `General`-fält får inte rekonstrueras till en gissad referens. Formler, okända blad, dolda underlag, makron och ogiltiga arkiv stoppas. |
| CSV | `sites/lib/bankgiro-parser.js` | Namngivna svenska kolumner, uttrycklig valuta, avgränsade datum/belopp, separat OCR/fakturanummer/generisk referens och betalare. Det är en strikt importprofil, inte ett påstående att valfri redigerad CSV är ett autentiskt bankoriginal. |
| Open Payments JSON | `sites/lib/bankgiro-openpayments.js`, `bankgiro-openpayments-capture.js`, `banking/openpayments-provider.js` | Dokumenterad AIS-transaktionsläsning och separat `transactions.bankgiro`. `.opbg.json` bevarar exakta råsvar, sidkedja, hash, fångsttid och företags-/kontokontext. Källbehörighet kontrolleras separat från hash. Rå JSON omtolkas inte till ett påhittat CAMT-original. |
| Företagsbunden integration | `sites/lib/banking/openpayments-company-enrichment.ts`, `src/openpayments-company-bank-sync.js` | Befintlig originalfångst och Bankgiro-intag används med aktuell kontobindning, medgivande, roller, kvot och generationskontroll. Rapportobservationer skapar inte en andra ekonomisk insättning. |
| Visning och avstämning | `sites/lib/payment-presentation.ts`, `payment-verification.ts`, `domain.ts`, `payment-references.js`, `payer-evidence.js` | Faktiska bankfält med råvärden och sökvägar; betalare, referens, original, konto, insättning och faktura bedöms separat. Manuell underlagsrelation ersätter inte bankidentitet eller fakturaallokering. |

### Fältens betydelse

OCR, generisk betalningsreferens och fakturanummer är olika uppgifter. En referens som `0599` lagras som text och får inte bli `599`, tilldelas en kontrollsiffra eller etiketteras som OCR enbart för att den är numerisk. Betalarnamn och eventuell organisationsidentifierare hämtas ur det individuella bankfältet. En mottagaradress i rapportens sidhuvud eller en fakturakund blir aldrig bankens betalare.

Belopp räknas i heltalsören; datum behåller sin dokumenterade roll. Ett rapportdatum, valutadatum och bokföringsdatum är inte automatiskt samma sak. Mottagarens Bankgiro, avsändarens Bankgiro och mottagarkonto är separata fält. Ett fullständigt organisationsnummer får endast visas när underlaget faktiskt innehåller en stödd typad identifierare.

För en samlingsinsättning behövs hela gruppen: individuella belopp, förväntat antal/summa, kontokontext och uttrycklig bankidentitet. Identiska belopp, datum och referenser får inte slå ihop olika verkliga betalningar. Saknade syskon, partiella sidor, motstridiga identiteter eller ett annat konto stoppar automatisk koppling och ekonomisk omräkning.

## Rättat: referensstatus kräver verifierat original

En reproducerad statusbrist gjorde att en lagrad referens kunde få `passed` trots att ankomstkvitto saknades eller originalets kontrollsumma inte stämde. Betalarsteget hanterade redan detta som osäkert. Referenssteget kräver nu samma lyckade originalkontroll för att passera. Ett bevarat värde visas exakt, men får `review` och texten **Referens kräver originalkontroll** när originalbeviset brister. Det särskilda fältet för formell bank-OCR markeras inte som styrkt i det läget.

Saknad referens förblir `missing`. Motstridiga referenser, ogiltig OCR och fel i ett använt detaljoriginal förblir blockerade. Ett separat problem med aktuellt kontomedgivande tar däremot inte bort en korrekt läst referens ur ett intakt original. Referensens fältnärvaro/integritet, aktuell kontoåtkomst och rätt fakturarelation är fortfarande olika kontroller.

Två syntetiska tester reproducerade först den felaktiga godkända statusen. Efter rättningen passerar hela verifierarens 76 tester. Ett tredje nytt test skiljer intakt, saknat och overifierat underlag från kontobehörigheten; tillstånd, fakturasaldo och allokeringar förblir oförändrade.

## Nytt: dokumentnummer i Open Payments remittance-arrayer

Den dokumenterade strängen `remittanceInformationStructuredArray[].referredDocumentInformation.number` extraheras nu till separat `referenceEvidence.documentNumbers` med exakt värde, råvärde och källsökväg. `0599` och `599` förblir olika dokumentnummer. De dokumenterade metadatafälten `typeCode`, `typeProprietary`, `typeIssuer`, `number` och `relatedDate` kan följa med som avgränsade strängar. Godtyckliga extra fält och objekt återfinns endast i det bevarade råoriginalet.

Dokumentnumret blir inte automatiskt fakturanummer, OCR eller betalningsreferens. Den nya projektionen skapar inga matchningskandidater och ändrar inte `payerReference`. Ett dokument kan exempelvis vara en kreditnota, och leverantörens otydliga creditor-reference-objekt tolkas inte genom gissade fältnamn. Den befintliga granskningsspärren för strukturerade arrayer behålls. Uppgifterna blir tillgängliga för granskning genom rapportens befintliga `referenceEvidence`-fält.

Originalbytes, råa metadata, gränser för antal/längd, felaktiga numeriska värden, opaka syskonfält, okända dokumenttyper och kreditnotor täcks av nya syntetiska capture-/replay-tester. Vanliga äldre skalära referenser får ingen ny tom metadataegenskap som skulle ändra deras tidigare sparade evidensrepresentation.

## Nytt: läsbar original- och importhistorik

`retained_report_evidence` har nu en separat `provenance`-projektion för det exakt valda, ägda dokumentet. Den innehåller originalets lagrade byteantal/tid, importer, källkvitton med försök och tidpunkter, sparade rapportobservationer, allokeringshistorik och uttryckliga underlagsrelationer. Varje tillämplig kontrollsumma jämförs med originalets checksumma; motstridiga historikuppgifter döljs inte av att originalet självt är intakt.

Historiken binds genom sparade dokument-, import- och transaktions-ID:n. Samma hash, belopp, datum eller referens hos ett annat dokument skapar ingen ny relation. En saknad faktura redovisas som saknad. Återtagna allokeringar och länkar behåller sin historiska status; ett sparat beslut framställs inte som korrekt eller aktivt av det skälet att det finns.

Svaret anger uttryckligen `verificationScope: retained_history_only`, `bankAuthenticityVerified: false` och `invoiceRelationshipVerified: false`. Detta är gränsen för historikprojektionens bevisvärde. Originalets befintliga integritetskontroll, aktuell bankbehörighet och fakturakontroll fortsätter att vara separata.

Historikens `historyOffset` och `historyLimit` är oberoende av rapportens betalningsradssidor. Standard är 10 och högst 20 poster per historiklista. Totalt antal, nästa offset, `complete` och `snapshotCurrent` visar om mer återstår eller om underlaget ändrades under läsningen. För stora svar behåller totalerna och begär en mindre historiksida. De får aldrig tyst kapa en referens eller hävda en komplett kedja. Frågan är läsande och exponerar inte konton, hemligheter, behörighetsbindningar eller fria administrativa anteckningar.

De nya isolerade testerna använder faktisk SQLite/D1-liknande lagring och R2-stubbar som förbjuder skrivningar och bankanrop. Den gemensamma testfixturen återanvänder den kompilerade modulstrukturen men skapar ny databas och nytt objektlager per test; detta undviker att Node behåller en stor ny data-URL-modulgraf för varje test.

## Open Payments och verklig åtkomst

Officiell dokumentation, kontrollerad 2026-11-05:

1. [Åtkomsttoken och scopes](https://docs.openpayments.io/docs/get_access_token): `accountinformation`, `bankgiroinformation`, `corporate` är de relevanta läsomfången. Applikationens interna `bankgiro_reports:read` är ett separat intagskrav, inte ett påhittat OAuth-scope.
2. [Produktionsåtkomst](https://docs.openpayments.io/docs/getstarted): produktionsgodkännande, rätt applikation/API-produkter och organisationsspecifikt klientcertifikat krävs. Befintlig AIS-åtkomst bevisar inte att denna kunds Bankgiroleverans är aktiverad.
3. [AIS API](https://docs.openpayments.io/api/account-information-service-ais): transaktioner läses från `GET /psd2/accountinformation/v1/accounts/{account-id}/transactions` i medgivandets konto-/bank-/företagskontext. Sidkedjan måste vara fullständig. ISO-fallback gäller konton som är särskilt onboardade för den tjänsten.
4. [Fältscheman](https://docs.openpayments.io/api/~schemas) och [ändringen av remittance-arrayer i juni 2025](https://docs.openpayments.io/docs/changelog/2025-06): `referredDocumentInformation.number` är ett dokumentnummer. Det inkommande `creditorReferenceInformation.reference` beskrivs som ett objekt utan dokumenterade medlemmar i den läsbara schemavyn. Ingen gissad `.value`, SCOR-mappning eller omklassificering av dokumentnummer till OCR får användas. Äldre skalärfält finns för bakåtkompatibilitet; okända eller motsägande strukturer måste behållas för granskning.
5. [Swedbanks implementeringsguider](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) och [bankintegration](https://www.swedbank.se/foretag/betala-och-ta-betalt/bankintegration-med-affarssystem.html): CAMT054C och SFTP är dokumenterade alternativ. Guidernas index kunde läsas, men de försökt hämtade aktuella MIG-/Envelope-PDF:erna svarade HTTP 403. Därför påstås ingen ny fullständig verifiering mot dessa PDF:er eller något kundspecifikt avtal.

Den publika dokumentationen styrker inte den här kundens avtal, mandat, kontotäckning, certifikat eller rätt till historiska Bankgirodetaljer. De måste verifieras med leverantören före aktivering. Inga kundspecifika hemligheter eller verkliga original läggs i git.

## Obligatoriskt fall — faktiskt sparat original

Skrivfri kontroll 2026-11-05 kl. 17:13–17:14 UTC, arbetsyterevision 52. Kontrollen använde de autentiserade verktygen `payment_evidence`, `retained_report_evidence` och `bankgiro_source_status`; inga syntetiska fixtures användes som bevis. Dokument-, transaktions-ID:n, kontrollsummor och privata betalaruppgifter återges inte i detta offentliga gitdokument.

| Kontroll | Observerat resultat |
| --- | --- |
| Mottagarens Bankgiro | `5819-7013` finns i det sparade XLSX-originalet. |
| Referens | Exakt `0599`, med ledande nolla. Generisk betalningsreferens; fältet är inte styrkt som formell OCR. |
| Belopp och datum | `625,00 SEK` / `62500` öre och datum `2026-10-26` i den valda rapportobservationen. Datumets rapportroll och eventuell profilbaserad valuta är fortfarande relevanta kontrollgränser. |
| Original | Ägt sparat original kunde återläsas; byteantal/hash och parseromspelning passerade. Detta bevisar lagringsintegritet och de faktiskt lästa fälten, inte ensamt bankens autenticitet eller aktuell åtkomst. |
| Betalare | Individuellt namn finns i rapporten med cellproveniens. Organisationsnummer saknas. Kundrelationen är inte verifierad. |
| AIS | Separat sparad ekonomisk AIS-insättning finns för belopp/datum. Den har inte individuell betalare eller referens `0599`. Företagets eget Bankgironummer i AIS får inte behandlas som OCR. |
| Rapport ↔ AIS | Gemensamt bankutfärdat insättnings-ID saknas. Ingen verifierad automatisk koppling finns. Belopp/datum räcker inte. |
| Konto | Aktuell verifierad mottagarkontokoppling/behörighet saknas i kontrollen. |
| Faktura | Ett separat sparat fakturaunderlag med nummer `0599` hittas, men någon motsvarande registrerad faktura finns inte. Dokumentförslaget är ingen registrering eller betalningsallokering. |
| Ekonomi | En AIS-insättning räknas ekonomiskt, rapportobservationen räknas inte en andra gång. Noll allokeringar i det valda fallet; automatisk avstämning är blockerad. |
| Automatisk rapportkälla | `DISABLED`, `SOURCE_NOT_CONFIGURED`, behörighetsstatus `UNKNOWN`; tom kö. |
| Sökningens täckning | Den exakta originalrapportens läsning var komplett och oförändrad under kontrollen. Den bredare referenssökningen angav `complete: false` och `referenceSearchComplete: false`; den beskrivs inte som en fullständig inventering av alla möjliga underlag. |

Det obligatoriska fallet är således verifierat som **läsning och korrekt åtskillnad av verkligt sparade underlag**, men **inte som slutförd bankverifierad fakturaavstämning**. Denna branch är inte driftsatt; nya historikfält eller rättningar har inte tillskrivits den befintliga produktionen.

## Testmatris

Alla automatiska skriv-/import-/banktester använder isolerade syntetiska uppgifter. Namn som liknar verkliga format eller referensen `0599` gör inte ett testoriginal till produktionsbevis.

| Risk/fall | Förväntat resultat | Relevanta tester |
| --- | --- | --- |
| `0599` jämfört med `599` | Skilda originalvärden; ingen numerisk normalisering som tappar nollan | `bankgiro.test.mjs`, `bankgiro-xlsx.test.mjs`, `openpayments-bankgiro.test.mjs`, företagets referenspolicytester |
| OCR med fel kontrollsiffra | Granskning/spärr; fakturanummer får inte reparera OCR | `bankgiro.test.mjs`, `payment-verification.test.mjs`, referensmotorns tester |
| Fakturanummer och OCR skiljer sig | Behåll typ och källa; använd endast företagets uttryckliga referenspolicy | `company-bankgiro.test.mjs`, `openpayments-ingest.test.mjs` |
| Flera referenser/flera fakturor | Ingen automatisk betalning av den första träffen | `bankgiro.test.mjs`, `payment-verification.test.mjs` |
| Eget Bankgiro i ett referensfält | Inte individuell OCR eller betalningsreferens | `bankgiro.test.mjs`, `payment-evidence-status-final.test.mjs` |
| Saknad betalare eller samlingsnamn | Okänd/granskning; fakturamottagaren fyller inte luckan | `openpayments-bankgiro.test.mjs`, `payment-verification.test.mjs` |
| Annan betalare eller obestyrkt tredje part | Ingen automatisk kundrelation/allokering | `bankgiro.test.mjs`, `bankgiro-links.test.mjs`, betalarevidenstester |
| Saknat/annat organisationsnummer | Behåll originalets faktiska typ, nummer och källa; gissa inte | `bankgiro.test.mjs`, `payment-verification.test.mjs` |
| Decimaltal, tusentalsavskiljare, unsafe integer, fel valuta | Exakta heltalsören eller avvisat original | `bankgiro-xlsx.test.mjs`, `openpayments-bankgiro.test.mjs`, `camt-integrity.test.mjs` |
| Beloppet stämmer men fel faktura | Beloppet skapar ingen fakturarelation | `bankgiro.test.mjs`, `payment-verification.test.mjs` |
| Summa eller antal avviker i samlingsinsättning | Gruppen hålls för granskning; ingen delmängd ersätter hela insättningen | `camt-integrity.test.mjs`, `bankgiro.test.mjs`, `openpayments-bankgiro.test.mjs` |
| Ofullständig API-sida eller saknat syskon | Ofullständig täckning, ingen komplett grupp | `openpayments-bankgiro.test.mjs`, `openpayments-capture.test.mjs` |
| Dokumentnummer i ny remittance-array | Exakt separat dokumentmetadata; ingen gissad OCR/fakturatyp eller automatisk matchning | Ny `openpayments-document-numbers.test.mjs` |
| Oklart creditor-reference-objekt, kreditnota, extra privata fält | Granskningsspärr kvarstår; endast dokumenterade strängfält projiceras | Ny `openpayments-document-numbers.test.mjs` |
| Äldre skalär API-referens | Tidigare evidensrepresentation bevaras utan ny tom metadata | Ny `openpayments-document-numbers.test.mjs` |
| Samma datum/belopp men annat bank-ID/konto | Kandidat får visas; ingen bankstyrkt koppling | `bankgiro-links.test.mjs`, `bankgiro-authority.test.mjs`, `bankgiro-readiness-joined.test.mjs` |
| Återleverans av samma original eller child-ID | Idempotent; inget extra ekonomiskt belopp | `bankgiro-ingest.test.mjs`, `openpayments-bankgiro.test.mjs`, Node `openpayments-bankgiro-ingest.test.js` |
| Olika riktiga ID:n med samma synliga data | Bevaras som olika betalningar | `openpayments-bankgiro.test.mjs` |
| Samma ID men ändrade originalfakta | Identitetskonflikt; ingen tyst ersättning | `openpayments-bankgiro.test.mjs`, `bankgiro-ingest.test.mjs` |
| XLSX numerisk referens i `General` | Avvisas eftersom borttappade nollor inte kan återställas | `bankgiro-xlsx.test.mjs` |
| XLSX text eller uttryckligt nollformat | Exakt referens och rå cellinformation bevaras | `bankgiro-xlsx.test.mjs`, `bankgiro-xlsx-integration.test.mjs` |
| XML-dubblett, fel namespace, DTD, felaktig entitet, återföring | Avvisning/granskning före ekonomiskt intag | `camt-integrity.test.mjs`, Node `camt-integrity.test.js`, `bankgiro.test.mjs` |
| Saknat, främmande eller manipulerat original | Ingen intakt-originalstatus; råvärden kan visas endast med tydlig spärr | `payment-verification.test.mjs`, `bankgiro-retained-preview.test.mjs`, `mcp-evidence-read.test.mjs` |
| Referens finns men ankomstkvitto/hash brister | `review`, inte `passed`; exakt `0599` bevaras och formell OCR är inte styrkt | Tre nya regressioner i `payment-verification.test.mjs` |
| Utgånget/återkallat medgivande eller källgeneration | Ingen import/berikning med gammal behörighet | `bankgiro-authority.test.mjs`, `openpayments-capture.test.mjs`, `openpayments-company-sync.test.mjs` |
| Manuellt sammanbundna original | Separat manuellt beslut; inget automatiskt bank- eller fakturabevis | `bankgiro-links.test.mjs`, `payment-verification.test.mjs` |
| Exakt dokumenthistorik | Import/källkvitto/observation/allokering kan följas; inga nya relationer | Ny `mcp-report-provenance.test.mjs` |
| Annan ägare eller annat dokument med samma hash/data | Ingen läcka och ingen implicit sammanslagning | Ny `mcp-report-provenance.test.mjs`, `mcp-evidence-read.test.mjs` |
| Motstridiga historikhashar eller borttagen faktura | Avvikelsen visas; originalintegritet bedöms separat | Ny `mcp-report-provenance.test.mjs` |
| Historiken ändras under läsning | `snapshotCurrent: false`, ofullständigt svar | Ny `mcp-report-provenance.test.mjs` |
| Stor historik eller för stort svar | Stabil pagination, bevarade totaler, aldrig falskt komplett | Ny `mcp-report-provenance.test.mjs` |
| Läsning av evidens | Oförändrad databas/R2, inga bankanrop eller allokeringar | `mcp-evidence-read.test.mjs`, ny `mcp-report-provenance.test.mjs` |
| SFTP-värdnyckel, privata filer, omstart, dubblett, HTTP-intag | Transport/intag håller behörighets- och originalgränser | `bridge/bankgiro/test/*`, `bankgiro-sftp-e2e.test.mjs` |

## Kvarstående aktiverings- och acceptansgränser

1. Bekräfta rätt Open Payments-produkt/Bankgirotäckning, kundavtal, produktionscertifikat, kontoonboarding och separat läsbehörighet. För SFTP krävs motsvarande verkligt Swedbankavtal och konfiguration.
2. Återställ eller verifiera aktuellt företagsmedgivande och bankutfärdad relation mellan rapportens mottagarkonto/Bankgiro och valt AIS-konto.
3. Hämta ett verkligt bankoriginal som uttryckligen binder rapportens insättning till AIS-postens bankidentitet. Referens, datum och belopp är inte ersättningsbevis.
4. Granska och registrera rätt faktura i ett separat godkänt verksamhetsflöde samt verifiera kundrelationen mot bankens betalare. Saknat organisationsnummer får inte konstrueras.
5. Kör den behöriga leverantörskedjan med verkliga original efter godkänd aktivering. Bekräfta dubblettfri hämtning, rätt betalare/referens, komplett insättning och spårbar original–faktura-relation. Endast denna faktiska acceptans kan stödja en högre produktionspoäng.

## Verifieringskvitto

Fryst kodkandidat: `5642be6`. Lokal miljö: Linux, Node `24.22.1`, npm `11.9.0`. PR-flödets tre ordinarie jobb använder Node 22 och kör hela slutkandidaten med rena installationer. Exakt leveranshuvud, körningslänk och slutligt CI-resultat redovisas i PR:ns checks och leveranskvitto; nedanstående lokala körningar ges inte en annan omfattning än de faktiskt hade.

| Kontroll | Faktiskt lokalt resultat |
| --- | --- |
| Root installation | `npm ci --ignore-scripts` godkänd. |
| Sites ren installation | `npm run install:ci` godkänd i en separat tom katalog med exakt `package.json`, låsfil och installationsskript från `5642be6`: 719 paket, lyckad postinstall och exakt minimatchkontroll. |
| Bryggans installation | `npm ci --ignore-scripts` godkänd. |
| Root syntax | `npm run check`: 170 JavaScript-filer godkända på slutkandidaten. |
| Sites typer och bygge | `npm run check` och `npm run build` godkända efter sista parserändringen, med Cloudflare-fjärrhämtning avstängd. |
| Root fullsvit före sista parserändringen | 1 899/1 899 godkända, 0 fel/skip/cancel/TODO. Detta är ett lokalt integrationskvitto före den sista additiva metadataändringen. |
| Sites fullsvit under implementation | 3 756/3 756 godkända, 0 fel/skip/cancel/TODO. De nya filerna läggs därefter till i slutkandidatens ordinarie CI-svit; denna tidigare körning påstås inte omfatta dem. |
| Slutliga Node Bankgiro-/Open Payments-flöden | 67/67 godkända i fyra testfiler, med isoleringspreload och syntetiska original. |
| Slutlig parser-/capture-/intagskontroll | 217/217 godkända i åtta testfiler, med isoleringspreload; sex nya dokumentnummerfall ingår. |
| Evidens, provenance och verifieringsvisning | 145/145 godkända i sex testfiler, med isoleringspreload; 8 nya historikfall och 3 nya verifierarfall ingår. Den enskilda verifierarsviten har 76/76 och de två MCP-evidensfilerna 42/42. Dessa delantal överlappar och summeras inte som ytterligare unika tester. |
| SFTP-brygga | Syntax och fullsvit: 47/47 godkända, 0 fel/skip/cancel/TODO. |
| Beroendegrindar | Root `npm audit --audit-level=high`: 0 fynd. Sites samma grind: godkänd, 8 befintliga moderate utvecklingsfynd, inga high/critical. Brygga `npm audit --omit=dev --audit-level=high`: 0 fynd. |
| Installerad minimatch-mitigering | `--check --require-target`: en målversion, noll ändringar, `verified`. Inga paket- eller låsfiler ändras. |
| Diffkontroll | `git diff --check` godkänd. |

Den slutliga parserkontrollen kördes från `sites` med `NODE_ENV=test` och:

```bash
node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types \
  --test --test-concurrency=1 \
  tests/openpayments-document-numbers.test.mjs tests/openpayments-bankgiro.test.mjs \
  tests/openpayments-capture.test.mjs tests/openpayments-ingest.test.mjs \
  tests/bankgiro.test.mjs tests/camt-integrity.test.mjs \
  tests/bankgiro-xlsx.test.mjs tests/payment-references.test.mjs
```

Den oberoende kodgranskningen av `4ad205b..5642be6` gav **READY**, utan Critical/Important-fynd inom granskad omfattning. Den omfattade faktisk originalläsning/bytehash, ägarfilter, lagrad historik, snapshotkontroller, MCP-gränser, referensstatus, parsermetadata och regressionsdesign. Granskaren körde inte tester själv; körkvittona ovan kommer från implementationens faktiska körningar. Granskningen är inget certifikat för en verklig leverantör eller ett bankoriginal.

### Tidigare misslyckade miljöförsök

Två tidiga Sites-installationer avslutades med exit 137 under resursbelastning. En samtidig tidig Node-svit stötte då på en ofullständigt installerad `sites/node_modules/xlsx` och räknas inte som grön. En exakt låsfilmotsvarande befintlig beroendekopia användes för återupptagna kontroller; senare lyckades den separata rena installationen enligt tabellen. Installation och testläsning hålls därefter åtskilda.

Den första utökade MCP-testfilen kunde även nå Nodes heapgräns genom en separat stor data-URL-modulgraf per test. Testfixturen rättades till en återanvänd kompilerad graf med ny isolerad databas/objektlagring per test. Slutliga MCP- och evidenskörningar passerade med 512 MiB heapgräns. Inga felande eller avbrutna försök rapporteras som lyckade tester, och inget av dessa miljöproblem medförde produktionsändringar.
