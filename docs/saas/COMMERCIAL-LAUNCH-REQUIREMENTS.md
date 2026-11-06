# Krav före kommersiell kundlansering

**Granskat och offentliga källor kontrollerade: 2026-11-05. Beslut: BLOCKERAD för nya verkliga SaaS-kunder.**

Dokumentet konkretiserar [lanseringsgrindarna](COMMERCIAL-LAUNCH-GATES.md). Det är ett beslutsunderlag, inte ett rättsligt godkännande eller ett intyg om efterlevnad. Granskningen omfattar kod, repositorydokumentation och offentliga primärkällor. Kundspecifika avtal, fullmakter, produktionsbehörigheter och återställningskvitton har inte verifierats. Inga bank-, BankID- eller andra produktionsanrop har utförts för detta dokument.

`IMPLEMENTERAT` betyder att ett skydd finns i koden. `EXTERN VERIFIERING` kräver avtal, behörighet eller annan evidens utanför repositoryt. `DRIFTVERIFIERING` kräver acceptans i avsedd miljö för den exakta release som ska aktiveras. Ingen av dessa nivåer ersätter de andra.

## 1. Vad den nuvarande implementationen ger

| Område | Implementerad grund | Vad som återstår för kundlansering |
| --- | --- | --- |
| Företagsisolering | Node använder företagskatalog och separata SQLite-databaser. Sites använder företagets beständiga `storageOwner` för D1/R2. Medlemskap, roller och versioner kontrolleras vid skyddade operationer. | Aktuell A/B/C-acceptans för databas, original, export, cache, callbacks, arbetare och återställning på exakt release. |
| Identitet i Node | HTTPS-inloggningen skapar fortfarande den enda publika identiteten `administrator`; lokal drift använder `local-admin`. Inställningarna anger `single_administrator`. | **Node får inte lanseras som publik tjänst för flera självständiga kunder med denna inloggning.** Separat granskad autentisering, registrering och inbjudningsacceptans behövs för det driftsättet. Flera aktörer i tester etableras genom betrodd test-/operatörsprovisionering. |
| Identitet i Sites | Plattformens autentiserade ChatGPT-`userId` används. En autentiserad användare kan skapa ett separat tomt företag. | Verifiera produktionsingress, sessionsgräns och avsedd kundgrupp. Ett tomt företag eller en ChatGPT-inloggning verifierar inte juridisk företagsidentitet eller rätt till befintliga företagsdata. |
| Befintliga företag | Bindning till äldre data kräver en betrodd operation och verifieringsreferens. Ett nytt tomt företag får inte ta över gamla original eller konton. | En faktisk process för företagskontroll och företrädarbehörighet. Fältet `verified` är lagrad evidensstatus, inte en genomförd kontroll mot ett externt register. |
| Bankanslutning | Serverstyrd aktivering, företags-/aktörsbunden registrering, företagskontext och kontroll av konfigurerad produktåtkomst. | Leverantörens verkliga godkännande och respektive kunds konto-/produktbehörighet. Flaggan ska förbli av tills beslutet är dokumenterat. |
| Medgivandets livscykel | Kända medgivanden återkallas före ersättning. Osäkert skapande eller osäker återkallelse blockerar fortsatt anslutning. Utgången redirect kan förnyas. | Leverantörsstödd avstämning, återställningsrutin och acceptans för timeout, avbrott, återkallelse och ny auktorisering. |

Kod- och kontraktsunderlag: [multitenancy](../integration/saas/multitenancy.md), [publika och betrodda kontrakt](../integration/saas/contracts.md), [säkerhetsacceptans](../integration/saas/security-acceptance.md), [Node-server](../../src/server.js), [Sites företagslagring](../../sites/lib/company-storage.js) och [bankruntime](../../sites/lib/banking/saas-bank-runtime.js). Resultat från tidigare lokala tester är inte aktuella produktionskvitton; se även [tidigare slutrapport](../SAAS-MULTITENANT-BANKID-FINAL-REPORT.md).

## 2. Fastställ den rättsliga AIS-modellen — L01

Finansinspektionen beskriver tillstånd för betaltjänster och möjligheten för den som enbart erbjuder kontoinformationstjänster att ansöka om undantag och bli registrerad betaltjänstleverantör. Undantag innebär alltså inte att verksamheten automatiskt saknar registreringskrav. Ett ombudsarrangemang behöver bedömas och hanteras av den ansvariga leverantören enligt tillämpliga regler. [FI: Betaltjänster](https://www.fi.se/sv/betalningar/sok-tillstand/betaltjanster/).

PSD2:s undantag för vissa tekniska stödtjänster omfattar inte själva betalningsinitierings- eller kontoinformationstjänsten. Att Mgeorge bara läser data, inte hanterar pengar eller använder en licensierad API-leverantör avgör därför inte ensamt gränsdragningen. [PSD2, artikel 3 j, 33 och 67](https://eur-lex.europa.eu/eli/dir/2015/2366/2015-12-23/eng/pdf).

**EXTERN VERIFIERING — affärsansvarig/juridik:** upprätta ett undertecknat ställningstagande för den faktiska kundresan:

- Vem avtalar med slutanvändaren om AIS, inhämtar medgivandet och ansvarar för åtkomsten? Vilken juridisk person är reglerad leverantör?
- Är Mgeorge egen AIS-leverantör, ett godkänt ombud eller en teknisk leverantör under ett dokumenterat arrangemang? Kontrollera faktisk registrering, tjänster och geografisk omfattning i myndighetsregister.
- Om egen registrering/tillstånd krävs: slutför ansökan och utred bland annat tillämplig ansvarsförsäkring, styrning, rapportering och klagomålshantering före aktivering. Om ombudsmodell väljs: bekräfta huvudmannens ansvar och nödvändig registrering/anmälan.
- Låt oberoende juridisk kompetens bedöma kvarstående gränsfall och inhämta FI-förtydligande där det behövs. Följ regeländringar fram till faktisk lansering.

**Okänt:** vilket av dessa arrangemang som är avtalat och giltigt för Mgeorge. Inga marknadsföringspåståenden om FI-godkännande eller tillståndsfrihet kan grundas på kodgranskningen.

## 3. Leverantörsavtal och verkliga bankbehörigheter — L02–L05, T01

### Open Payments

Den offentliga startguiden kräver företagsgodkännande för produktion, ett organisationsspecifikt klientcertifikat, en produktionsapplikation med valda API-produkter och registrerade redirect-adresser. [Open Payments: Get started](https://docs.openpayments.io/docs/getstarted).

**EXTERN VERIFIERING:** granska signerad order och produktbilagor. De ska uttryckligen täcka den planerade tjänsten till externa kundföretag, aktuella länder/banker, eventuell återförsäljning eller white-label, databehandling, avgifter, begränsningar, ansvar, support och avslut. Publik dokumentation visar inte vad Mgeorge har köpt. Produktionscertifikat och en fungerande token bevisar inte detta avtalsinnehåll.

**DRIFTVERIFIERING:** bekräfta produktions-mTLS, certifikatets livslängd, registrerade redirects, bankens företagsflöde och faktiskt beviljade scopes. Dokumentera vem som förnyar certifikat och hemligheter. Begränsa anslutningen till avsedd läsning; betalningsinitiering kräver ett eget beslut och ingår inte i denna lansering.

### Enable Banking

Enable Banking anger att en publik applikation behöver ett signerat avtal och att full produktionsaktivering kräver företagskontroll. Begränsad aktivering genom egna länkade konton är till för utvärdering eller privat icke-kommersiell användning. En sådan anslutning bevisar inte rätt att ansluta kundföretag. [FAQ](https://enablebanking.com/docs/faq/), [begränsad produktionsanvändning](https://enablebanking.com/docs/api/linked-accounts).

**EXTERN VERIFIERING:** inhämta det kommersiella avtal som faktiskt tillåter kundkonton och företagsanvändning, bekräfta KYB och full aktivering samt ansvarsfördelningen för AIS. Den publika kontrollpanelens villkor ger inte i sig rätt till affärsmässig API-användning. [Enable Banking: villkor](https://enablebanking.com/terms/). Granska även appens integritetstext, användarvillkor, dataskyddskontakt, certifikat och redirects enligt [produktionsregistreringen](https://enablebanking.com/docs/api/control-panel/).

### Företrädare, konton och Bankgiro

BankID/SCA visar att en person har genomfört en autentisering eller auktorisering i ett visst flöde. Mgeorges lanseringskrav är därutöver bevis för rätt juridisk person, rätt företrädare, rätt företagskonto och rätt omfattning. Dokumentera bankens eventuella fullmakt, flera godkännare och produktbeställningar för varje målbank. En lyckad privatkontoanslutning räcker inte.

Open Payments beskriver `bankgiroinformation` tillsammans med `accountinformation` för ISO-berikning, samt `corporate` för företagskonton. Det dokumenterar API-kapacitet, inte aktivering för en viss kund. [Scope-definitioner](https://docs.openpayments.io/docs/enums). Det befintliga [leverantörsunderlaget](../integration/saas/provider-capabilities.md) beskriver dessutom separat anslutning och verifiering av ISO/BGI-källan.

**EXTERN VERIFIERING + DRIFTVERIFIERING:** upprätta en täckningsrad per företag, bank, konto och Bankgironummer med:

- avtalad produkt, nödvändig bankbeställning/fullmakt, leveranssätt och leverantörens bekräftelse;
- ett behörigt prov på faktiskt råunderlag: belopp, valuta, datum, individuell betalare/referens när sådant utlovas och stabil identitet för insättningen;
- fördröjning, historiklängd, luckor, paging, avstämning och hantering av saknade fält.

Bankgiroberikning får inte räknas som ytterligare pengar ovanpå samma bokförda insättning. En API-funktion för mottagarkontroll eller utgående ISO-betalningar är inte evidens för inkommande Bankgiro-underlag. Saknade betalarnamn eller referenser ska förbli okända. **Kundspecifik SaaS-rätt, företagskontotäckning och Bankgiro-leverans är ännu inte verifierade.**

## 4. Dataskydd och kundvillkor — L06–L10

**EXTERN VERIFIERING — dataskydd/juridik:** kartlägg roller per behandling. Kundföretaget kan vara personuppgiftsansvarigt för fakturor och avstämning medan Mgeorge behandlar på instruktion. Kontohantering, fakturering av abonnemang och säkerhetsloggar måste bedömas separat. Klassificera även bankleverantörens roll; anta inte att alla parter är underbiträden.

När Mgeorge är biträde krävs bindande biträdesavtal med dokumenterade instruktioner, sekretess, säkerhetsåtgärder, villkor för underbiträden, rättighetshjälp, incident-/DPIA-stöd, granskning och hantering vid avtalets slut. Underbiträden kräver rätt tillstånd och avtalskedja. [IMY: Personuppgiftsbiträdesavtal](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/).

Lanseringspaketet ska innehålla följande konkreta underlag:

| Underlag | Acceptanskriterium |
| --- | --- |
| Behandlingsregister och information | Beskriv ändamål, tillämplig rättslig grund, uppgifter, registrerade, mottagare och information till berörda. Bankmedgivandet ersätter inte denna analys. |
| Leverantörs- och dataflödeskarta | Faktiska parter för plattform, D1/R2, bank, Gmail, OCR, support och loggning; vilka personuppgifter som passerar varje part. Kontrollera lagring och fjärråtkomst samt tillämpliga skydd för tredjelandsöverföring. |
| Bevarande och avslut | Kundbeslutad tidsplan för original, transaktioner, loggar, säkerhetskopior och hemligheter. Export, återlämning och gallring ska fungera per företag. Stäm av lagkrav för bevarande av räkenskapsinformation innan tidsfrister lovas. |
| Säkerhetsbilaga | Verifierbar åtkomstmodell, kryptering och nyckelhantering, loggåtkomst, incidentrutiner, återställning och säkerhetsuppdateringar. Skriv bara kontroller som faktiskt används. |
| Kundavtal | Pris, volymgränser, support, tillgänglighet, datakvalitetsbegränsningar, ansvar, uppsägning och export. Villkoren ska stämma med leverantörsavtalen och den testade tjänsten. |

Gör och dokumentera en bedömning av behovet av konsekvensbedömning, DPIA. Om behandlingen sannolikt innebär hög risk ska DPIA göras innan behandlingen påbörjas. Finansiella uppgifter gör inte automatiskt varje behandling DPIA-pliktig; omfattning, sammanställning, ändamål och risker måste bedömas. [IMY: När krävs konsekvensbedömning?](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/konsekvensbedomning/nar-ska-en-konsekvensbedomning-genomforas/).

Incidentrutinen ska ange ansvarig, kontaktvägar, bevarad evidens och eskalering från biträde till ansvarig utan onödigt dröjsmål. Den ansvarige bedömer anmälningsplikten: utgångspunkten är anmälan inom 72 timmar från vetskap om incidenten, om riskundantaget inte gäller. Hög risk kan även kräva information till berörda utan onödigt dröjsmål. Dokumentera också beslut att inte anmäla. [IMY: Personuppgiftsincidenter](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsincidenter/).

## 5. Bedöm DORA utifrån rollen

**EXTERN VERIFIERING — juridik/säkerhet:** DORA omfattar bland annat leverantörer av kontoinformationstjänster. Om Mgeorge får en sådan roll måste tillämpliga krav på IKT-risk, incidenter, tester och tredjepartsrisk bedömas. En vanlig SaaS-leverantör blir inte automatiskt en finansiell enhet genom att läsa bankdata. Leverans av IKT-tjänster till en berörd finansiell aktör kan däremot kräva avtalsvillkor och evidens för dess skyldigheter, bland annat tillgänglighet, återställning, granskning och exit. Direkt tillsyn som kritisk IKT-tredjepartsleverantör bygger på den särskilda utnämningsprocessen. [DORA, artiklarna 2, 28, 30 och 31](https://eur-lex.europa.eu/eli/reg/2022/2554/oj).

Besluta därför om roll, tillämplighet och avtalskrav tillsammans med AIS-klassificeringen. **Ingen DORA-, ISO- eller annan certifiering har verifierats för Mgeorge i denna granskning.**

## 6. Driftrutin för osäkra medgivanden och nycklar — T01, T03

Den aktuella livscykeln sparar `consentCreation: pending` innan skapandeanropet. Om leverantören hinner skapa ett medgivande men svaret försvinner kan dess ID saknas lokalt. `consent_recovery_required` blockerar då nytt skapande. Äldre ofullständiga poster utan säker skapandeevidens behandlas också försiktigt. Detta skydd löser inte det externa utredningsarbetet. Se [livscykelkoden](../../sites/lib/banking/openpayments-lifecycle.js).

**DRIFTVERIFIERING + EXTERN VERIFIERING — integration/drift/leverantör:** godkänn och öva följande rutin före kundaktivering:

1. Stoppa nya anslutningsförsök för berörd operation. Bevara företag, miljö, tidsfönster, operations-/request-ID och tillgängliga leverantörsreferenser i skyddad logg. Lägg inga token eller kundoriginal i ärendet.
2. Använd leverantörens dokumenterade sök-/avstämningsmöjlighet eller support för att fastställa om POST skapade ett medgivande och vilket ID det fick. Ett nytt request-ID eller ett lokalt timeoutfel bevisar inte att ingenting skapades.
3. Om ett medgivande finns: identifiera det entydigt och slutför tillåten återkallelse/återhämtning. Om inget skapades: spara leverantörens bekräftelse. Utred även osäkra DELETE-resultat; använd bara dokumenterade återförsök och leverantörens bekräftelse på slutstatus.
4. Återöppna först när en granskad operatörsprocedur kan förena lokal och extern status utan att kringgå företags-, medlemskaps- eller versionskontroller. Att radera en spärrpost eller påstå återkallelse utan känt ID är ingen återställningsrutin. **Leverantörens stöd och verktyget/processen för denna återöppning är inte verifierade.**
5. Öva certifikat-/hemlighetsrotation, nödstopp och återauktorisering. Inventera vilka företag varje credential påverkar; återkalla gammal åtkomst, uppdatera betrodd konfiguration och verifiera nya behörigheter. Ny nyckel får inte återuppliva borttagna medlemskap eller arbetarbehörigheter.

Separat acceptans behövs för avbruten/misslyckad SCA, utgången redirect, förlorat svar efter bekräftad återkallelse, omstart och samtidiga försök. Kundgränssnittets meddelande ska motsvara vad som faktiskt är känt hos banken.

## 7. Sista verifiering och beslut — L11, T02–T04

Följande ska ligga i lanseringsärendet med namngiven ansvarig:

- **Engineering/säkerhet:** exakt commit och gröna obligatoriska CI-kontroller; A/B/C- och rollacceptans genom verkliga API-gränser, med callback, återkallat medlemskap, arbetare, original, export och cache. Historiska tester ersätter inte den aktuella releasekontrollen.
- **Drift:** företagsbunden backup/restore med original, nycklar och oberoende kopia; uppmätt RPO/RTO. Återställning får inte ge tillbaka upphävda behörigheter. Verifiera migrering och återställningsplan; en äldre app utan företagsgränser får inte köras mot redan bundna företagsdata.
- **Integration:** godkänd verklig sandboxacceptans och därefter särskilt auktoriserad produktionsacceptans för godkänt kundomfång. Dokumentera scope, konton, utgång, återkallelse och källa till Bankgiro-underlag.
- **Drift/support:** övervakning, larm, felbudget/kvoter och dokumenterade resultat för schemalagda körningar. Ett konfigurerat schema är inte en lyckad körning. Nya företag får inte ärva befintliga Gmail-konton, original eller bankregistreringar.
- **Affär/juridik/dataskydd:** L01–L10 med beslut och privata evidensreferenser; kundvillkor och supportansvar färdiga; inga okända avtals- eller behörighetsfrågor kvar i det omfång som ska öppnas.
- **Releaseansvarig:** uttryckligt beslut för exakt Node-/Sites-release, miljö, kundomfång och serverflagga, inklusive nödstopp och återställning. Separera kodmerge, publicering och öppnande för verkliga kunder.

Varje evidenspost ska ange grind-ID, beslut, granskare, datum, giltighet/omprövning, företag, leverantör, miljö, exakt release och referens i godkänd privat lagring. Personuppgifter, avtal, bankoriginal och hemligheter ska inte läggas i repositoryt. Okänd, utgången eller partiell evidens innebär fortsatt blockering för den berörda funktionen/kunden. Ett begränsat pilotbeslut ska uttryckligen beskriva sitt omfång och ger inget generellt lanseringsgodkännande.
