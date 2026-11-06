# Avgränsad diagnostik av sparat null-usage

Datum: 2026-11-06. Läskälla: publicerad main `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Detta dokument fryses före produktkod och är ett förslag för roots granskning.

## Sakläge

Det tillhandahållna Site 65-kvittot från 2026-11-05 23:50:44 UTC visar ett valt konto: sparat `explicitNull: 1`, aktuellt sessionssvar `omitted: 1`, övriga usage-räknare noll. Kvitto-SHA256: `1e5d3942bf65c70ac01202cf8ad9ba1a49b40c9c8380fa55400ea641c6fc4150`.

Providerkontraktet beskriver usage som en valfri sträng med enum `PRIV`/`ORGA`; det ger ingen null-semantik. SessionAccount beskriver UID och identitetshashar, inte usage. Kontodetaljer finns via GET på konto-UID. En primär identitetshash har annan betydelse än den plurala, delvis icke-unika hashlistan. Detta har kontrollerats i den officiella API-referensen och roots råa OAS 3.1-fil med SHA256 `86ca22c5dda74f8ce5f7a930d9823a3a7642301ac7e5e19a47e198d9d0c40ec0`. YAML-filens felvända ordning i `x-enum-descriptions` används inte för någon tolkning.

Källor: [officiell API-referens](https://enablebanking.com/docs/api/reference/), [rått schema](https://enablebanking.com/docs/api/reference/enablebanking-api.yaml). Någon färsk kontodetalj, faktisk primärhashkontinuitet eller förklaring till det historiska null-värdet har inte observerats.

Den nuvarande `validateEnableConsent` stannar vid usage före primärhashjämförelsen. Usage-kvittot bevisar därför inte att primärhasharna stämmer. `getAccountDetails` finns som avgränsad transportadapter men att den returnerar ett objekt bevisar inte usage eller hashkontinuitet. `readBankAccountEvidence` kräver `connected` och är ingen tillgänglig återhämtningsväg i `reauth_required`.

## Vald väg och auktorisering

Förslaget är en separat diagnostisk del av den redan ägarbundna `bank_revalidate_consent`, endast efter dess eget äkta usage-avslag. Ingen ny publik endpoint eller klientvald kontoidentifierare införs. En statusbaserad genväg genom `readBankAccountEvidence` förkastas eftersom den skulle ändra dess anslutningskrav. Automatisk cacheuppdatering förkastas eftersom färsk usage ännu är okänd.

Den smala läsningen auktoriseras av en **färsk bankbekräftad AUTHORIZED-session för samma befintliga ägare, applikation och redan valda UID**, med oförändrad bank/land/PSU/scope/giltighet och exakt primärhashkontinuitet. Lokal `reauth_required` kvarstår eftersom det sparade kontounderlaget inte uppfyller policyn. Den diagnostiska tillåtelsen kan endast användas för kontodetaljer och får aldrig bli en import-, företags-, betalnings- eller aktiveringsbehörighet. Den påstår inte juridiskt företagsägande.

`validateEnableConsent`, `businessAccountData` och kontobevisläsarens `active()` förblir byteoförändrade. Ingen null tas bort eller ersätts för att få en validator att godkänna input.

## Exakt läsgräns

1. Behåll revalideringens ägar-/adoptionskontroller, befintliga applikationsgeneration och miljö, giltighet, stoppade försök, 15-minutersgräns, lease och persistenta kontoläscooldown.
2. Använd dess befintliga enda färska `getSession`. Endast ett äkta `ACCOUNT_USAGE_INVALID` från samma valideringsinput kan starta diagnosplaneringen. Den oförändrade legacy-valideraren används för bank-/PSU-/scope-/tidsramen och hela UID-inventariet. Inga ändrade inputvärden används för att få godkänt utfall.
3. Den nya rena planen avslutar också alla kontroller som det tidiga usage-avslaget ännu inte hade gjort: bankgiro-scope får inte läsas via AIS; varje redan valt konto måste ha giltig, **närvarande och exakt lika primärhash** i sparad resurs och aktuell sessionsresurs. Saknad, ogiltig eller motsägande primärhash stoppar före details-GET; överlapp i `identification_hashes` reparerar ingenting.
4. Diagnostiken omfattar endast **redan valda resurser med sparat explicit null**. Övriga sparade valda usage-värden måste vara oförändrat tillåtna (utelämnat eller ORGA); varje aktuell sessionsresurs i urvalet måste också ha utelämnat eller ORGA. Sparat PRIV/okänt/fel typ eller ett aktuellt explicit avslag ger ingen detaljläsning.
5. Högst fem null-resurser läses. Om fler än fem skulle behövas läses inga; ingen dold trunkering eller utvidgning till ovala konton. Hela UID-inventariet och identiteten för hela urvalet kontrolleras före första anropet. Läs endast serverns bundna UID:n, en gång var och sekventiellt.
6. Återanvänd `guardedBankRead` med strikt cooldown för varje details-GET. Kontrollera ägare, adoption, applikation/generation, bank, sessionsciphertext, kontociphertext, sparat urval, metadata, status och giltighet mot samma oförändrade försökskontext före/efter varje läsning och före svar. Ingen ny användar-/BankID-resa eller credentialinmatning införs.
7. Ett detaljsvar får räknas först när eventuell svar-UID är exakt begärd UID, dess giltiga primärhash är exakt samma som både sparad och aktuell sessionshash och inga uttryckliga primäridentifierar-/valutakonflikter finns. Fuzzy alias, ordning i namnlistor, gissade kontonummer eller ändrade siffror används inte. Saknad valfri svar-UID kan bindas genom den fasta begärda endpointen och den exakta primärhashen; saknad primärhash kan inte bindas.
8. Det ursprungliga usage-felet kastas fortfarande. Ingen success-gren, cacheuppdatering, anslutningsaktivering, förlängd giltighet eller ekonomisk ändring sker. Endast befintliga operativa lease-/cooldownmarkörer och failed-audit får skrivas. Om ägare/lease/kontext eller failed-audit inte kan styrkas publiceras ingen positiv diagnostik.

## Svarskontrakt

Behåll ursprunglig kod/status/reason och befintlig `usageDiagnostic`. Ett separat privat märkt `usageDetailsDiagnostic` kan tillkomma:

- Fast version `selected-account-usage-details-v1`.
- Status `observed`, `not_read` eller `unavailable` och en fast whitelistrad reason.
- Antal avsedda, försökta och identitetsbundna observationer, var och en högst fem när planen är giltig.
- Endast när hela den avsedda mängden har lästs med intakt kontext: samma sex usage-räknare som tidigare (`omitted`, `orga`, `priv`, `explicitNull`, `otherString`, `wrongType`).

Ingen rå usage, UID, hash, bank-/kontonamn, kontonummer, providertext eller felgetter får serialiseras. En delvis läst mängd ger inte ett komplett observationsresultat. Ett providerfel eller identitetsfel stoppar ytterligare details-anrop, bevarar cooldown och ger endast fast diagnos. Ett observerat ORGA-värde gör fortfarande inte anslutningen grön. Ett utelämnat/null/PRIV/okänt värde är en observation, ingen korrigering av den historiska uppgiften.

Privat felproveniens och indatabindning ska användas hela vägen. Ett äkta policyfel kastat av providergränsen, publika diagnostikegenskaper eller klientargument får inte aktivera läsningen eller ge en kategori från andra data.

## Frysta motprov före produktändring

| Område | Negativa och positiva fall som krävs |
| --- | --- |
| Befintlig spärr | `reauth_required` når fortfarande inte `readBankAccountEvidence`, även om en mockad kontodetalj skulle säga ORGA. |
| Ram och inventarium | Fel bank/land/PSU/status/giltighet/scope; saknade/dubbla/ogiltiga UID:n även utanför urvalet; inga details-GET. |
| Identitet före läsning | Saknad, tom, ogiltig eller ändrad primärhash hos vilket valt konto som helst; fuzzy överlapp hjälper inte; inga details-GET. |
| Minimalt urval | Endast sparat valda null-resurser; ovala konton och redan tillåtna valda resurser läses inte; fem går, sex ger noll. |
| Oförändrat avslag | Färskt ORGA med exakt identitet ger diagnos men fortfarande 409/usage-avslag, oförändrad cache/status/urval/giltighet, inga ekonomiska rader. |
| Färska värden | Utelämnat, null, PRIV, okänd sträng och fel typ redovisas som fasta kategorier först efter korrekt identitet; ingen normalisering. |
| Färsk konflikt | Avvikande UID, saknad/ändrad primärhash, primäridentifierare eller valuta; ingen positiv kategori, inga följande anrop. |
| Samtidighet | Byte av ägare, adoption, appgeneration, session, kontocache, urval, status eller lease före/under läsning stoppar och ger ingen positiv diagnos. |
| Provider/cooldown | 429 med känd/okänd väntetid, timeout, förlorad guard-write; beständiga spärrar bevaras, ingen extra läsning. |
| Förfalskning | Klientkonto-ID, force-argument, publik getter och äkta främmande policyfel får inte välja resurs eller publicera diagnostik. |

Fokuserade Node/Sites-/MCP-prov och före/efter-paritet ska köras isolerat med Node 24. Full integration och produktionsanrop görs av root efter separat granskning. Inga verkliga bankanrop görs under implementationen.

## Vad en senare faktisk observation kan avgöra

- **ORGA + exakt kontinuitet:** kan stödja en separat granskad och historikbevarande uppdatering av det sparade kontounderlaget. Den uppdateringen ingår inte här.
- **Null eller utelämnat:** usage är fortfarande inte uttryckligen företagsklassificerat; ingen konvertering av den gamla uppgiften är motiverad.
- **PRIV:** den aktuella kontoresursen strider mot företagspolicyn och förblir spärrad.
- **Identitets-, sessions- eller behörighetskonflikt:** ingen säker uppdatering av den gamla resursen kan härledas. Ny ägarstyrd auktorisering eller providerutredning kan behövas, beroende på det faktiska felet.

Det nuvarande kvittot bevisar alltså inte att en ny BankID-resa krävs, men ger inte heller skäl att normalisera null eller aktivera anslutningen.
