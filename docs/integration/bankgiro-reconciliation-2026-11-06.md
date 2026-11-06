# Bankgiro: originalbevis och betalningsavstämning — 2026-11-06

## Leverans och avgränsning

PR: [#68](https://github.com/sharbel0022/Mgeorge/pull/68). Branch: `feature/95-bankgiro-reconciliation`. Startbas: verifierad main `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`, vars [separata huvudgrensgrind](https://github.com/sharbel0022/Mgeorge/actions/runs/42253201335) hade sex godkända jobb.

**Den verkliga Bankgirokällan är fortfarande `DISABLED / SOURCE_NOT_CONFIGURED`.** Den läsande kontrollen 2026-11-06 22:59:29 UTC gav okänd auktorisering, inget käll-ID, inget lyckat källkvitto och noll köjobb. Källkod, dokumentation och syntetiska tester kan inte ersätta kundens bankavtal, autentiserad rapportleverans eller verifierad kontokoppling.

Arbetet härdar befintlig inläsning och avstämning i Node och Sites. Produktionsfakturor, rapportoriginal och betalningsallokeringar har inte ändrats. Ingen bankkälla, schemaläggning eller deployment har aktiverats. Lästa produktionsuppgifter redovisas enbart som [minimerat kontrollkvitto](evidence/bankgiro-reconciliation-2026-11-06.json); kundnamn, konto-/Bankgironummer, dokument-ID, originalhashar och originalfiler publiceras inte.

## Inventering: befintligt stöd och faktisk gräns

| Källa / funktion | Befintlig implementation | Verifieringsgräns |
| --- | --- | --- |
| Normaliserad HTTPS-rapportkälla | `bankgiro-http-source.js`, betrott källregister, ägar-/företags-/konto-/Bankgirobunden auktorisering, paginering, tidsgränser och återförsök. | `/v1/authorization` och `/v1/reports` är projektets eget transportkontrakt. De är inte påstådda bank- eller Open Payments-endpoints. |
| SFTP | Isolerat paket i `bridge/bankgiro`; autentiserad SSH, pinnad host key, enbart läsning hos leverantören, beständiga original och journal, HTTP på loopback. | Kräver verklig bankkonfiguration, privat beständig POSIX-lagring och godkänd HTTPS-proxy. Paketet är inte en driftsatt eller bankcertifierad anslutning. |
| CAMT XML | Gemensam begränsad parser för `camt.053/.054.001.02` och `.001.08`, namnsökvägar, bokföringsstatus, riktning, belopp, valuta, datum, betalare och referenser. | Generiskt stöd är inte full XSD-, Swedbank-MIG- eller Envelope-validering. Okända strukturer, återföringar och ofullständiga samlingsdetaljer ger spärr eller granskning. |
| Swedbank XLSX | Befintlig rapportprofil, säkert ZIP-innehåll, originalfält och radpositioner, mottagarkonto/Bankgiro, rapportserie och betalningsrader. | Manuell fil visar vad filen innehåller. Hash eller filnamn intygar inte bankens autenticitet eller samma AIS-insättning. |
| CSV | Befintliga uttryckliga kolumnprofiler med separat generell referens och OCR. | Stöd gäller dessa profiler. CSV får inte fylla saknad valuta, betalare eller kontobehörighet genom antaganden. Sites Bankgiro-CSV är en kreditprofil. |
| Open Payments | Dokumenterad AIS-berikning, exakta råsvar, intern `.opbg.json`-behållare, företags- och kontobunden proveniens samt individuella observationer. | Behållaren är ett internt originalformat. Saknade/partiella bankdetaljer förblir granskningsunderlag; Node behåller API-rapporter i granskning. |
| BGMax / okända bankformat | Ingen BGMax-parser införs. | Formatet är uttryckligen ostött. Swedbanks övergångssida anger att stödet för Bankgirots gamla filformat upphörde 1 september 2026. |

Företagsgränsen är också en produktgräns: Node:s befintliga företagsbundna intag accepterar endast profilen `openpayments-bankgiro-v1`; generiska filer får inte ta omvägen via en legacykälla efter företagsanslutning. Om en separat företagsbunden CAMT/SFTP-adapter väljs måste den integreras och granskas mot den avtalade bankprofilen och samma företagsbehörighet. Den kombinationen blir inte stödd genom att en URL eller hemlighet läggs till.

Mer detaljer: [SFTP-paketets driftkontrakt](../../bridge/bankgiro/README.md), [automatisk källberedskap](../BANKGIRO-AUTOMATIC-SOURCE-READINESS.md) och [Open Payments-berikning](saas/bankgiro-enrichment.md). Äldre testantal och produktionsstatus i dessa dokument är daterad historik.

## Rättningar och ekonomisk betydelse

### Exakta Bankgirofält i CAMT

Den gamla Sites-matchningen accepterade varje kontoschema som innehöll texten `BGNR` eller `BANKGIRO`, exempelvis `NOTBANKGIRO`. Node tappade samtidigt explicit Bankgiro på gäldenärs- och borgenärskontona.

Den gemensamma läsaren ska kräva ett entydigt, icke tomt `Cd`- eller `Prtry`-fält och endast känna igen projektets redan stödda exakta alias `BGNR` och `BANKGIRO`. Identifieraren behålls som text. Kredit/debit avgör vilken sida som är det egna kontot respektive motparten. Betalarnamn, generell referens `0599`, datum och 62500 öre kontrolleras separat. Transaktionskoder får inte skapa en kontorelation.

Detta är en härdning av befintligt generiskt stöd. Placeringen av just dessa alias i Swedbanks aktuella kundprofil har inte styrkts genom bankens kredit-MIG/exempel och certifieras inte här.

### Mottagaren måste stämma med aktuell källbehörighet

En intakt fil kan ha en uttrycklig mottagare som strider mot den konfigurerade källans Bankgiro. Båda originalintagen ska jämföra den uppgiften före första import och före återanvändning av en tidigare import. Endast presentationsmellanslag och bindestreck normaliseras; inledande nollor bevaras. Motsägelse ger `ACCOUNT_MISMATCH`; originalet ligger kvar för granskning och importen skapar inga allokeringar.

Ett saknat originalfält fylls inte från auktoriseringen. Övriga kontroller av konto, original, källa, företagsgräns och bankmedgivande gäller fortfarande.

### Samma hash ger inte en ny källauktorisering

Rapportköns tidigare snabbväg sökte identisk hash enbart inom ägaren. Återanvändning ska även kräva samma käll-ID, scope, auktoriseringsgeneration och registreringsbindning. Byteidentiska filer under en annan behörighet måste därför genomgå det aktuella originalintagets kontroller. Befintlig importidempotens hindrar nya ekonomiska rader.

### Aktuell behörighet vid själva allokeringen

Sites slutliga skrivkontroll behöver omfatta registreringsrevision, registreringsbindning och verifierings-/giltighetstid i källraden samt registreringsbindningen i rapportkvittot. En samtidig förändring får inte lämna en sparad allokering eller revisionspost. För ett rent källkvitto prövas även giltigheten med databasens klocka inne i den slutliga transaktionen, inklusive exakt utgångstid utan någon ändrad databasrad. Ett redan spärrat underlag behåller sitt befintliga undantag för uttryckligen granskade manuella allokeringar; det blir inte bankverifierat och dess fält måste fortfarande vara oförändrade. Befintliga ägargränser, AIS-kontomedgivande, originalkontroll och arbetsytans revisionsvillkor gäller samtidigt.

De nya regressionerna prövar det verkliga SQLite-baserade D1-testlagret och det finansiella skrivsteget. Node tar redan ett exklusivt skrivlås före sin läsning och avstämning; motsvarande utelämnade fältlista hittades inte där.

## Deterministisk matchning och manuell granskning

Den befintliga motorn kräver verifierbar bankrepresentation, aktuellt ägt konto, rätt betalningsriktning/valuta, oförändrade original, spårbar rapport-/insättningsrelation, exakta referenser och styrkt faktura-/kundrelation. En möjlig dokumentträff, samma belopp och samma datum räcker inte. Generell betalningsreferens blir inte formell OCR. `0599` och `599` är skilda strängar.

Samlingsinsättningen och dess kompletta barn representerar samma pengar en gång. Barnens antal, valuta, riktning och summa måste vara förenliga med originalets samling. Identiska belopp från olika verkliga betalnings-ID är separata betalningar; enbart namn/belopp/datum används inte som dedupliceringsnyckel.

Delbetalningar, överbetalningar och betalning av flera fakturor har befintliga uttryckliga gransknings-/allokeringsflöden med saldo- och beloppsgränser. Ofördelat belopp blir inte automatiskt en extra fakturabetalning. Återbetalning kräver rätt riktning och befintlig kredit; en återföring kan inte maskeras som vanlig betalning eller kreditåterbetalning. Den här PR:en breddar inte den automatiska matchningen.

Originalintag skapar ingen fakturaallokering. `REVIEW`, `BLOCKED`, källkvitto, felkod, originalhash och separat granskningsbeslut ger revisionsspår. Nya mottagarkonflikter hamnar i befintlig spärrad kö med bevarat original. AI-förslag får inte ändra bankfält eller utfärda bankintyg.

Relevant befintlig täckning: `seven-agent-0599-joined`, `reconciliation-batch-integration`, `reconciliation-manual-provenance`, `manual-multiple-allocation`, `manual-return-allocation` samt fulla Node-/Sites- och SFTP-sviter.

## Obligatoriskt exempel: 0599, 625,00 SEK

Den riktade produktionsläsningen 2026-11-06 22:43 UTC var komplett och aktuell inom sitt avgränsade urval, med `changed=false`.

| Kontroll | Observerat resultat |
| --- | --- |
| Rapports originalintegritet | Godkänd; bevarade byte motsvarar importens SHA-256. |
| Betalaruppgift | Namn finns i rapporten. Det är inte ensamt bevis på kundrelation. |
| Referens | Exakt `0599`; generell betalningsreferens. Formell bank-OCR saknas. |
| Aktuell mottagarkontobehörighet | Blockerad. |
| Samma insättning | Styrkt rapport-/AIS-relation saknas. |
| Faktura och kundrelation | Kräver granskning; ingen registrerad faktura i den här kopplingen. |
| Bankautenticitet / fakturarelation | `bankAuthenticityVerified=false`, `invoiceRelationshipVerified=false`. |
| Automatisk avstämning | `automaticEligible=false`; rapportobservationen räknas inte ekonomiskt. |
| Allokeringar / källkvitton | 0 / 0. |

Detta är ingen bankverifierad betalning av faktura 0599. Kontrollens fakturaförslag är ingen registrering eller ekonomisk skrivning.

De nya syntetiska acceptansfallen använder samma referens och belopp. Saknade eller ändrade originalbyte, utgången källbehörighet och utgånget kontomedgivande stoppar matchning. Återställda exakta testbyte kan åter ge ett beräknat förslag till en enda betalning; en upprepning får inte dubblera den. Testet kontrollerar att anroparens indata, sparad arbetsyta och revisionshistorik är oförändrade. Syntetiska förslag/allokeringar i isolerade testdatabaser säger ingenting om den verkliga betalningens status.

## Verifierade offentliga källor och begränsningar

Kontrollerat 2026-11-06:

1. [Swedbanks MIG-index](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html): uppdatering 2026-08-07, kreditprofilerna 1.0 och 2.0 listar båda `camt.054.001.02`. XML-namnrymden ensam identifierar därför inte avtalad bankprofil. Dokument-/exempellänkarna för kreditprofilerna svarade 403 i granskningen. Ingen full innehålls- eller XSD-verifiering av dem påstås.
2. [Swedbank Anslutning Företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html): direkt SFTP-integration och separat säkerhetslösning beskrivs. Det styrker en erbjuden kanal, inte kundens aktivering.
3. [Swedbanks övergång till ISO 20022](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige.html): äldre Bankgiroformat upphörde hos Swedbank 2026-09-01. Uppgiften generaliseras inte till andra banker.
4. [Open Payments AIS](https://docs.openpayments.io/api/account-information-service-ais) och [schemas](https://docs.openpayments.io/api/~schemas): konton/transaktioner inom medgivandet, separata debtor-/creditor-fält, remitteringsinformation, bankgiroberikning och olika bank-/API-identiteter. `transactionListId` kan kollidera och ersätter inte en stabil källbunden bankidentitet.
5. [Open Payments åtkomsttoken](https://docs.openpayments.io/docs/get_access_token) och [onboarding](https://docs.openpayments.io/docs/getstarted): `bankgiroinformation` kompletterar `accountinformation`; företagskontext, faktiskt kundmedgivande, godkänd produktionsapplikation och organisationsspecifikt klientcertifikat krävs enligt tillämplig anslutning. Projektets `bankgiro_reports:read` är en intern kapabilitet, inte ett påhittat OAuth-scope.
6. [Bankgiro Lookup](https://docs.openpayments.io/api/bankgiro-lookup): mottagaruppslag inför betalning. Det är inte bevis på vem som har gjort en inkommande betalning.

## Exakt återstående leverantörsberoende

| Ansvar | Underlag som saknas / måste verifieras | Acceptans innan aktivering |
| --- | --- | --- |
| Kund och bank / Open Payments | Företagets rapportavtal och aktuell rätt till inbetalningsdetaljer för angivet konto och Bankgiro. | Bevarat auktoriseringskvitto med företag, källa, scope, konto/Bankgiro, generation och giltighet. AIS-behörighet ensam räcker inte. |
| Bankens filsupport | Avtalad CAMT054C-MIG, XML-version, XSD, godkända exempel, eventuell Envelope/signering/kryptering. | Validera verkligt auktoriserade original mot exakt profil och komplettera adapter endast om kontraktet kräver det. |
| SFTP-/driftleverantör | Verifierad värd/port/användare, läsbehörighet, host key, autentisering, katalog, filpubliceringsregler, beständig privat spool och HTTPS-proxy. | Faktisk ändpunkts- och transportacceptans, avbruten överföring/replay/rotation med bevarade original. Inga hemligheter i repositoryt. |
| Open Payments vid API-val | Godkänd applikation/mTLS, relevanta scopes, corporate-kontext, samtycke, faktisk ISO-onboarding och bank-/kontotäckning. | Råa auktoriserade svar med komplett `transactions.bankgiro`-information och kontobindning; inte enbart ett lyckat kontoanrop eller Lookup-svar. |
| Bank / integrationsansvarig | Mottagarkontots identifierartyp, kontoalias, Bankgirorelation och stabila rapport-/betalnings-/insättnings-ID. | Entydig relation mellan rapportoriginal, bokförd AIS-insättning och ägt konto. Datum och belopp används inte som ersättnings-ID. |
| Bank / integrationsansvarig | Individuell betalar- och referenstäckning, fullständighet per samling, krediter/återföringar, sena rapporter och historik. | Granska verkliga fält, bevara saknade värden och styrk att summor och grupper är kompletta. |
| Driftansvarig | Aktuell källa registrerad via den betrodda servervägen och verklig körfrekvens. | Verifiera en faktisk leverans och originalkvitto i ordinarie körning utan testallokering av kundfakturor. En intern intervallinställning skapar inte ett nytt externt schema. |

Fortsättningspunkten är alltså ett leverantörs- och kundbundet acceptansprov. Dokumentation eller gröna testfixturer får inte byta status till en aktiv eller bankverifierad källa.

## Testresultat och granskningsstatus

Denna sektion uppdateras med den slutliga kandidatens verkliga CI-kvitton före leverans. De första testerna ligger i ett separat testcommit så att fel och rättningar kan följas. Inga äldre huvudgrensresultat räknas som test av ny produktkod.

- Första testcommit: `a1e9e3acb581d53078e66be01b59b09ee7ac4968`, [CI 42307643931](https://github.com/sharbel0022/Mgeorge/actions/runs/42307643931). Node 22 och 24: **3015 godkända / 4 fel** av 3019. Sites: **5823 godkända / 8 fel** av 5831. Samtliga dessa sviter hade 0 skip/cancel/todo. Rena installationer, syntax, typer, audit och Sites-bygge passerade; de nya negativa testerna demonstrerar mottagar-/auktoriseringsbristerna. Bridge- och prestandajobb passerade. Browserns slutresultat var ännu inte observerat när nästa testcommit publicerades.
- Andra testcommit: `5066e6b76b4ac3ae0a70089dafe07448995d9aaa`, med delade CAMT-fältprov och separat 0599-original-/käll-/slutskrivningsacceptans. Native resultat är ännu inte avläst.
- Ny lokal, riktad Node-baslinje: 95 godkända, 0 fel/skip/cancel/todo.
- Rotinstallation: godkänd. Ren Sites-installation avbröts med exit 137; ett efterföljande länkat beroendeträd underkändes av integritetsvakten.
- Exekveringsmiljön blev därefter otillgänglig. Lokala Sites-/bridge-körningar saknar verifierat slutresultat.
- Ordinarie PR-CI används för rena installationer, båda Node-versionerna, syntax, säkerhetsaudit, Sites-typer/tester/bygge, SSH/SFTP, prestanda och Chromium.
- Inga workflows, spärrar, befintliga assertions eller beroendepinnar sänks för att få gröna resultat.

Befintlig kvalitetsbedömning 258,5/330 = 7,83/10 lämnas oförändrad. Denna kodförbättring styrker inte produktionsberoende poänghöjning eller kommersiell Bankgiroacceptans.
