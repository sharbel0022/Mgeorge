# Bank- och Bankgiroåterhämtning — 2026-11-06

## Resultat och bevisgräns

Bankdelarna från öppna PR #45 och #46 har granskats som del av integrationen av PR #49 med aktuell `main`. Konfliktlösningen bevarar både den senaste huvudbranchens begränsade kontodiagnostik och återanslutnings-/transportskydden från PR #45. Ett ytterligare konfigurationsfel har rättats: strängvärden kan inte längre uppfylla kontroller som kräver listor över aktiverade tjänster och länder.

De fem fokuserade slutkörningarna gav **826/826 godkända testfall**, noll fel, skip, avbrutna testfall eller TODO. Detta är summan av olika testfiler i denna delrapport. Flera ingår också i huvudleveransens fullsviter; antalet ska därför **inte** adderas en gång till till huvudrapportens total. Provideranropen är isolerade testdubblar; flera flöden använder riktig lokal SQLite/D1-liknande lagring, kryptografi och faktisk parserkod. Ingen verklig bankhämtning, BankID-signering, medgivandeförnyelse, bankkonfigurationsändring, produktionstransaktion eller betalning utfördes i denna deluppgift.

**Verklig bankåtkomst är fortfarande inte återställd eller verifierad.** Root-agentens skrivfria inventering i denna körning observerade `connected=false`; Bankgiro visade `SOURCE_NOT_CONFIGURED`, `DISABLED` och okänd auktorisering. Testframgång ändrar inte dessa driftstatusar. Den befintliga bankblockeringen får inte kringgås med en databasåterställning eller antagen `ORGA`-klassning.

## Integrationsunderlag

| Underlag | Exakt identifiering | Bedömning |
| --- | --- | --- |
| Aktuell main vid start | `cde9178c0f8e8e386329ed8feaa4201e87b5a78f` | Innehåller senare PR #56–#60 och deras säkerhetsgränser för diagnostik. |
| PR #49, integrationshuvud | `03f84afd61bb1020e73c17c3cde332a1b07f55a0` | Innehåller bland annat bank-/Bankgiroleveranserna; äldre grön CI återanvänds inte som bevis för den nya kombinationen. |
| PR #45, bankhuvud | `ac1abdc5469248eba212496af4a4573864908ace` | Återanslutning, servervald callback, status, begränsade transporter och Open Payments-livscykel behålls. |
| PR #46, Bankgirohuvud | `7d3bcb5ef533c39c9e23714e61709c924384ffb8` | Separata dokumentnummer, originalkrävande referensstatus och ägarbunden proveniens behålls. |

De fokuserade testerna kördes på den sammanförda **arbetskopian** medan `HEAD` fortfarande var main-SHA ovan och merge ännu inte var committad. De tillskrivs inte ett senare commit-ID retroaktivt. [Maskinläsbart kvitto](evidence/bank/verification.json) innehåller kommandon, resultat, komprimerade loggars SHA-256 och en uttryckligen efterföljande källfilssnapshot. Huvudleveransens fullkörning/CI binder den slutliga committade integrationen till sitt eget SHA.

## Rättningar i den sammanförda koden

### Två diagnostikgränser måste överleva samma avslag

Huvudbranchen har ett offentligt, begränsat kontrakt för kontoomfångsfel, exempelvis `ACCOUNT_USAGE_INVALID`. PR #45 tillför mer precisa lagrade diagnoser, exempelvis `SAVED_ACCOUNT_USAGE_INVALID`. Den ena får inte ersätta den andra eftersom senare kontodetaljdiagnostik också kräver en privat bindning till exakt fel, exakt indatasnapshot och identifierade konton.

`bank-consent-policy.js` bevarar därför de separata privata `WeakMap`-registren. Samma verkliga policyavslag får både sitt kompatibla offentliga skäl och en tillåten lagrad diagnos. Feltext, publika felattribut, getters eller ett förfalskat prototypobjekt ger inte diagnostisk behörighet. Publika `Error.reason` kan muteras som presentationsdata, medan serialisering och diagnostik läser de privata posterna. Den begränsade läsplanen kan aldrig godkänna medgivandet eller reparera den avvisade sparade kontosnapshoten.

Servicegränsen bevarar aktuell ägare, företag, applikationsgeneration, medgivande, kontoidentitet, deadline och lease före och efter väntan. Privata usage-/detailobservationer exponeras bara för det ursprungliga avslaget och det autentiserade sammanhang som utförde valideringen. Det ursprungliga avslaget kvarstår även när en diagnostisk läsning lyckas.

Fyra nya tester i `sites/tests/final95-bank-diagnostic-integration.test.mjs` binder ihop dessa kontrakt: lagrad explicit null, manipulerade publika fält, bortvalt/saknat konto och försök att skapa läsrätt genom en publik felkonstruktor.

### Felaktiga metadatalistor stoppas före provideranrop

PR #45:s statuskontroll använde `.includes()` direkt på lagrade `services` och `countries`. Även strängarna `"AIS"` respektive `"SE"` har denna metod och kunde därför passera en kontroll avsedd för arrayer. `connectionHealth` kräver nu `Array.isArray()` före medlemskontroll. Applikationen bedöms som konfigurationskrävande om metadata har fel typ.

Fem nya preflight-regressioner verifierar att redan inaktiva, främmande eller feltypade applikationsmetadata ger **noll** provideranrop, inga missvisande diagnostik-/auditposter och ingen ändrad anslutning. Fem befintliga fall för ändrade metadata efter ett sessionssvar behåller sina ursprungliga assertions; deras ändring injiceras nu under det tillåtna sessionsanropet. Därmed testas både den nya tidiga spärren och huvudbranchens senare spärr. Inga tester togs bort och inga assertions försvagades.

### Befintliga PR-rättningar som granskats och bevarats

Återanslutningen använder serverkontrollerad canonical callback och den redirect som binds till flödet. Klientens Host eller godtycklig URL kan inte flytta callbacken. Applikationsregistrering, aktuella åtkomstroller, utgångstid, state/callback, sessionsrotation, företagsscope och dispatch efter samtidiga ändringar ingår i banksäkerhetssviten. En framtida utgångstid gör inte ett avvisat eller återkallat medgivande aktivt.

Transporterna har avgränsad svarsstorlek och väntetid, säkra felprojektioner och försiktig hantering av okänt utfall vid muterande provideranrop. Ett timeoutat förnyelse-/avslutningsanrop återförsöks inte som om leverantören säkert avvisat det. Open Payments-kontoläsning stoppar blockerade/raderade konton och okända åtkomstvärden; aktuellt företag och kontoomfång kontrolleras innan användning.

Bankgiroprojektionen håller `referredDocumentInformation.number` separat från OCR, generisk referens och fakturanummer. Originalets checksumma och ankomstkvitto måste styrka referensen innan referenssteget får godkänd status. Proveniensvyn visar ägarbunden sparad historik och anger uttryckligen att historikens närvaro inte bevisar bankautenticitet eller rätt fakturarelation. Förändrad arbetsyterevision, andra dokument med samma hash och ofullständig historik får inte döljas.

## Kontroll mot officiella kontrakt

Följande primärkällor lästes eller söktes på nytt den 2026-11-06. De beskriver leverantörernas API, inte denna kunds aktuella rättigheter.

| Källa | Verifierat kontrakt och konsekvens |
| --- | --- |
| [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) | Sessionsstatus `AUTHORIZED` ger kontoåtkomst; väntande, avvisade, stängda, utgångna och återkallade sessioner får inte likställas med denna status. Callback återför state och kod eller fel. Kontots primära identitet och kontoresurs behandlas separat från lokal valtillhörighet. `GET /accounts/{id}/details` är en läsning, inte ett nytt medgivande. |
| [Enable Banking FAQ](https://enablebanking.com/docs/faq/) | Transaktionspagination fortsätter när `continuation_key` finns, även efter en tom sida; övriga frågeparametrar ska vara oförändrade. Förnyad teknisk token ersätter inte kundens medgivande. |
| [Open Payments access tokens](https://docs.openpayments.io/docs/get_access_token) | Applikationstoken använder `client_credentials`. Företags-AIS använder `accountinformation corporate`; ytterligare `bankgiroinformation` ger ISO-berikning av Bankgirotransaktioner. Interna `bankgiro_reports:read` är applikationens eget intagskrav, inte ett leverantörs-OAuth-scope. |
| [Open Payments consent](https://docs.openpayments.io/docs/create_consent) | Företagets och användarens identitet måste ingå i rätt kontext. Medgivande skapas/auktoriseras separat från token. Aktiva användaruppgifter och bakgrundsåtkomst får inte blandas ihop; frekvensen måste följa avtalad åtkomst. |
| [Open Payments AIS](https://docs.openpayments.io/api/account-information-service-ais) | Kontolistan är begränsad av kundmedgivandet. Sidkedjan ligger under `transactions._links.next`; konto, datum och scope måste bevaras. ISO-fallback förutsätter särskilt onboardade konton. Ett dokumenterat API är inte bevis för kundspecifik Bankgirotäckning. |
| [Open Payments scheman](https://docs.openpayments.io/api/~schemas) och [juni 2025-ändringen](https://docs.openpayments.io/docs/changelog/2025-06) | Schemat beskriver `referredDocumentInformation.number` som sträng med separata typ-/datumfält. Remittance-arrayer kan även representera kreditnotor. Dokumentnummer får inte automatiskt bli betalningsreferens eller OCR. Schemaavsnittet bekräftades genom officiellt indexerat sökresultat när sidans fullständiga hämtning timeoutade. |
| [Open Payments produktionsåtkomst](https://docs.openpayments.io/docs/getstarted) | Faktiskt produktionsgodkännande, rätt API-produkter, klientcertifikat, produktionsuppgifter och registrerade redirect-URL:er behöver finnas före verklig aktivering. |

Ingen ny fullständig granskning av Swedbanks kundspecifika CAMT054C MIG/XSD/Envelope genomfördes här. Tidigare rapport dokumenterar att aktuella PDF-hämtningar nekades. Parserns generiska CAMT-stöd är inte ett påstående om godkännande av varje banks specialprofil. Länkarna `/docs/bankgiroinformation` och `/docs/transactions` kunde inte hämtas och används inte som verifierad kontraktskälla.

## 0599 / 625 SEK och bevarat bevisvärde

Bankgiro-/Open Payments-sviterna använder isolerade syntetiska original. De verifierar att `0599` behåller sin inledande nolla och skiljer sig från `599`; dokumentnummer blir inte bank-OCR. Två faktiska fältangivna betalare i testunderlaget och delbeloppen 125 + 500 SEK kan ingå i en samlingsinsättning på 625 SEK utan att skapa två ekonomiska insättningar. Samma underlag kan återspelas idempotent. Andra bankidentiteter med samma belopp/referens får inte felaktigt slås ihop.

Hash, exakt original, fångst-/importkvitto, sidkedja, aktuell konto-/företagsbehörighet, betalarfält, insättningsrelation och fakturarelation är separata bevis. Felaktigt eller saknat original ger granskningsstatus; ingen betalare fylls från fakturans kund. Referens/belopp/datum ensamma bevisar inte att den verkliga fakturan 0599 är betald.

Denna delagent hämtade eller kopierade inga verkliga kundoriginal. Tidigare faktisk skrivfri kontroll i [PR #46:s rapport](../integration/bankgiro-95.md) kvarstår som historisk observation, inte som ett nytt produktionskvitto. Huvudleveransens aktuella read-only-inventering ska användas för den senaste sparade evidensstatusen.

## Fokuserad verifiering och öppet redovisade fel

Miljö: Linux, Node `v24.22.1`, låsta beroenden installerade av root. Alla slutkörningar använde `NODE_ENV=test` och projektets `saas-test-isolation.mjs`. Kommandon och fullständiga komprimerade loggar finns i [verifieringsmanifestet](evidence/bank/verification.json).

| Slutkörning | Pass / totalt | Fel / skip / avbrutna / TODO | Logg |
| --- | --- | --- | --- |
| Consent-/usage-/detailpolicy, fem testfiler | 198 / 198 | 0 / 0 / 0 / 0 | `policy-final.tap.gz` |
| Hela `banking-security.test.mjs` | 349 / 349 | 0 / 0 / 0 / 0 | `security-final.tap.gz` |
| Nya integrerade diagnostikkontrakt | 4 / 4 | 0 / 0 / 0 / 0 | `integration-final.tap.gz` |
| Tio Sites transport-/Open Payments-/Bankgiro-/proveniensfiler | 221 / 221 | 0 / 0 / 0 / 0 | `contracts-final.tap.gz` |
| Fyra Node transport-/reconnect-/datum-/Bankgirofiler | 54 / 54 | 0 / 0 / 0 / 0 | `node-final.tap.gz` |

Tidiga misslyckanden sparas också:

- En första policykörning utan `NODE_ENV=test` nekades av isoleringspreloaden i fem testfiler; den verifierade ingen produktfunktion.
- Första korrekt startade policykörningen gav 197/198. En gammal readonly `reason` gjorde att PR #45:s negativa manipulationstest kastade före sin säkerhetsassertion. Publika presentationsdata och privat proveniens separerades enligt ovan; efterföljande körning gav 198/198 och fyra ytterligare privata-bindningsregressioner passerade.
- Första hela servicekörningen gav 341/344. Tre fall väntade sig ett provideranrop trots att den nya tidiga metadatakontrollen korrekt stoppade det. Testuppställningen delades tidsmässigt enligt ovan, det verkliga arraytypfelet rättades och fem nya nollanropsfall lades till. Alla 349 passerade därefter.
- En oavsiktlig omkörning av den äldre servicekoden avbröts med exit 130 efter att en filredigering från fel arbetskatalog misslyckats. Dess ofullständiga logg sparas, men räknas inte som en fullkörning eller som godkänt testresultat.

Fullständigt produktionsbygge, TypeScript, fulla Node/Sites/bridge-sviter, browseracceptans och exakt commit-CI hanteras i huvudleveransens verifiering. Denna fokuserade bankrapport ersätter inte dessa grindar.

## Exakta externa steg för verklig bankåterhämtning

1. Bekräfta rätt produktionsmiljö, applikations-ID, aktuellt certifikat/nyckel, serverkonfiguration och den faktiskt registrerade canonical callbacken. Hemligheter ska förbli i godkänd serverlagring.
2. Låt behörig användare initiera **Förnya anslutningen** och genomföra verklig bank-SCA/BankID. Ett testdubbelanrop eller ett framtida utgångsdatum är inte användarens godkännande.
3. Validera den nya auktoriserade sessionen, bank/land, exakta konton, nuvarande företagsbehörighet och explicit valt SEK-konto. Ett sparsamt svar får inte kompletteras med antagen kontoidentitet eller användningstyp.
4. Efter uttryckligt godkännande: gör en avgränsad read-only-hämtning, kontrollera hela sidkedjan, tidsintervall, rate limit och dubblettskydd, och bind kvittot till aktuell release och konto-/företagsscope.
5. Om det gamla explicita null-värdet fortsatt blockeras: använd en godkänd begränsad diagnos på den granskade/publikationsverifierade versionen eller begär leverantörens förklaring. Null får inte skrivas över till `ORGA` och felstatus får inte återställas för att få en grön indikator.

Den exakta bakomliggande orsaken till leverantörens sparade null-värde är fortfarande okänd. Tidigare rapport visar en lokal scopevalidering och otillräcklig detaljdiagnostik; det räcker inte för att påstå en viss banksystemdefekt, certifikatsdefekt eller verkligt återkallat samtycke.

## Exakta externa steg för en riktig Bankgirokälla

För Open Payments behövs separat godkänd Bankgiroprodukt/täckning, kundavtal, företags-/kontoonboarding, relevanta scopes och giltigt produktionscertifikat. För Swedbank SFTP behövs ett faktiskt bankavtal, read-only-användare, godkänd endpoint/port/katalog, oberoende verifierad SSH-värdnyckelfingerprint, privata nycklar/lösenord i hemlighetslagring och godkänd originalprofil inklusive MIG/XSD/Envelope där det krävs.

Den befintliga källregistreringen aktiveras först när följande verkliga underlag finns:

| Konfiguration | Nödvändigt underlag |
| --- | --- |
| `BANKGIRO_SOURCE_CONFIG`, version 1 | Monoton revision, stabil källa, exakt owner/companyId och bankbekräftat Bankgiro. |
| Scope/generation | Aktuell auktoriseringsgeneration; tidigare återkallad generation får inte återanvändas. |
| `https-v1`, base URL, `tokenSecret` | Godkänd HTTPS-transport och separat serverhemlighet, inga browservalda URL:er eller inbakade credentials. |
| Profil och format | Faktisk godkänd profil. Generiska rapporter kan använda `csv`, `xml`, `xlsx`. Den separata profilen `openpayments-bankgiro-v1` kan använda `allowedFormats: ["json"]` och enbart `*.opbg.json`, med exakt konto-/IBAN-identitet och företags-/berikningsscopes. Generisk eller blandad JSON aktiveras inte. En transport som kan behålla andra filer bevisar inte att parsern stöder dem. |
| Entitlement | Verifierad leverantörsauktorisering med evidens-ID, kontrollerad tid, utgångstid och intern rätt `bankgiro_reports:read`; färsk remote auktorisering måste matcha företag, profil, scope och generation. |
| SFTP-brygga | Dedikerad POSIX-tjänst, privat beständig spool/SQLite, pinning av värdnyckel, godkänd HTTPS-proxy och kontrollerad read-only-SFTP. Befintlig brygga raderar eller flyttar inte bankens filer. |
| Acceptans | Verkligt original och hämt-/importkvitto, rätt kontorelation och bankstyrkt insättningsidentitet; fullständiga betalningsrader, sena leveranser, replay och avbrott måste provas enligt avtalet. |

Aktiveringsgränser och driftsinstruktioner finns i [källberedskapen](../BANKGIRO-AUTOMATIC-SOURCE-READINESS.md) och [bryggans guide](../../bridge/bankgiro/README.md). Ett kortare konfigurerat intervall skapar inte ett nytt molnschema och bevisar inte körning. Fram till faktisk aktivering och acceptans är `SOURCE_NOT_CONFIGURED` korrekt och det produktionsberoende Bankgiroområdet har ingen ny 9,5-evidens.
