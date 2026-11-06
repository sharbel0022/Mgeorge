# Verklig bankåteranslutning och Open Payments — PR 65

Datum: 2026-11-06. Branch: `feature/95-bank-recovery`. Bas: verifierad main
`f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`.
[PR och slutliga CI-kvitton](https://github.com/sharbel0022/Mgeorge/pull/65).

## Leverans och faktisk bankstatus

Leveransen rättar tre avgränsade återanslutnings- och säkerhetsfel i den befintliga
integrationen och lägger till regressionsprov i ordinarie acceptans. Den använder
befintliga användarflöden, företagsgränser, kryptering, transport och lagring.
Ingen ny bankleverantör, manuell BankID-tjänst eller betalningsfunktion införs.

Verklig Swedbank-åtkomst är fortfarande **inte verifierad**. Den publicerade
tjänstens lokala status är `connected=false`, `connectionStatus=reauth_required`,
`syncAllowed=false` och `BANK_RECONNECT_REQUIRED`. Ett framtida sparat
`valid_until` ändrar inte den bedömningen. Ingen bankstatus, giltighetstid,
företagsattest eller kontoanvändning har skrivits om för att få grönt resultat.

[Sanerade observationer](observations.json) skiljer färska lokala driftläsningar
från historiska providerresultat. Produktionsversionen var Site 69 under
kontrollen. Detta arbete publicerar ingen ny Site-version och ändrar ingen
driftskonfiguration. Slutlig kodverifiering gäller PR-kandidaten, inte automatiskt
den redan publicerade versionen.

## Rotorsak: vad som är känt och vad som saknas

Den [bevarade incidenten](../saas/evidence/2026-11-05/bank-incident.json) visar att
den schemalagda hämtningen den 5 november 2026 kl. 14:04 UTC avvisades med
`BANK_ACCOUNT_SCOPE_INVALID`. Anslutningen spärrades trots att den sparade
sluttiden låg i framtiden. Den dåvarande lagrade feltexten tappade den specifika
medgivandediagnosen.

Det ursprungliga providersvaret finns inte kvar. Därför går det inte att fastställa
vilket enskilt villkor för kontoidentitet eller kontoscope som föll. Senare
rapporterad saknad/null `usage`, en kontodetaljdiagnos eller det senare generiska
`BANK_CONSENT_INVALID` får inte användas som bevis för den ursprungliga orsaken.
En felaktig kontotyp får inte fyllas i som `ORGA` och saknad företagsbehörighet får
inte härledas från BankID eller en företagsinloggning.

De tre nya kodfelen nedan är reproducerbara med syntetiska data. De utgör inte
bevis för att just de orsakade den historiska driftincidenten.

## Inventerade integrationer och befintliga skydd

| Område | Implementerat kontrakt och relevanta kod-/testspår |
| --- | --- |
| Enable Banking, Node och Sites | Befintlig start, callback, aktuellt sessionsprov, uttryckligt kontoval, förnyelse och frånkoppling. `src/server.js`, `src/bank.js`, `sites/lib/banking/service.ts`, `banking-security`, `bank-consent-api`, `consent-reconnect-95`. |
| Företags- och kontobehörighet | Serverbestämt företag, aktuell roll/medlemsversion, bankens konto-/sessionsdata och separat betrodd företagsattest. `bank-consent-policy`, `bank-company-authority`, company-/owner-isolation-tester. |
| State, callback och SCA | Tidsbegränsat, engångsbundet state; browser/användare/företag/applikationsgeneration; strikt callbackformat och återkontroll efter väntande providerarbete. Banken/leverantören utför SCA. |
| Hemligheter | Krypterade serverlagrade sessions-/kontodata, serverstyrda applikationsnycklar och skyddade tokenkontexter. Inga nycklar eller kundtoken i webbläsarens konfiguration eller nya testdata. |
| Open Payments | Separat befintlig SaaS-livscykel med giltigt AIS-medgivande, uttryckligt kontoval, revisions-/idempotensspärrar och företagsbundna resursreferenser. `openpayments-lifecycle`, `openpayments-provider`, `saas-bank-runtime`. |
| Produktionstransport | Faktisk Node mTLS eller Workers certifikatbindning; fasta tillåtna värdar/rutter, certifikatgiltighet, konfigurationsgeneration, deadlines och svarsstorlekar. Ingen vanlig fetch som produktionsreservväg. |
| Token och samtidighet | App-token skiljs från kundmedgivande. Befintlig cacheidentitet och beständig koordinator skyddar samtidiga företag/processer. Aktiverings-, företags- och revisionskontroller kvarstår vid asynkrona gränser och ekonomisk commit. |
| Transaktioner och pagination | Enable continuation_key, även efter tom sida; Open Payments transactions._links.next med konto-/värd-/periodkontroll. Begränsade sidor/rader/tid, atomisk hantering av komplett hämtning och bevarade original/källreferenser. |
| Återförsök och dubbletter | Providerkvoter/cooldown skiljs från återauktorisering. Inga blinda återspelningar av tvetydiga consent-skrivningar. Stabil kontoidentitet, transaktionsidentitet och lagringsspärrar skyddar mot dubbelimport och sessionsbyte. |
| Flera företag/konton | Befintliga company sync-, SQL-gräns-, roll-, lease-, token- och 1/10/100-företagstester ingår i CI. Syntetisk skalning bevisar inte bankens produktionskvoter eller kontotäckning. |

Den detaljerade [consentmodellen](../integration/saas/bank-consent.md),
[Open Payments-adaptern](../integration/saas/openpayments-adapter.md),
[livscykeln](../integration/saas/openpayments-consent-lifecycle.md) och
[Workers-transporten](../integration/saas/openpayments-workers-transport.md)
beskriver befintliga gränser. Äldre driftsuppgifter i dessa dokument är historik;
de färska, avgränsade observationerna för denna leverans finns här.

## Ändring 1: statussidan tål gamla auktorisationsförsök

Sites validerade även ett historiskt `bank_auth_flows`-objekt med aktuella
hanteringsrättigheter när användaren bara läste status. Ändrad medlemsversion,
läsrollen viewer/accountant eller skadad/främmande flowkontext kunde därför få
hela statusanropet att kasta. Ett ogiltigt slutdatum kunde dessutom visas som
ett fortfarande väntande försök.

Status fångar nu en ogiltig historisk kontext i läsprojektionen och visar
`CONSENT_RESTART_REQUIRED`. Flow-ID och länkad anslutningsidentitet lämnas inte ut
från den ogiltiga kontexten. Ett ogiltigt datum bedöms som utgånget. Aktuell
företagsrätt och anslutningens egen behörighet kontrolleras fortfarande separat.

Callback, start, synk och lagrade medgivandens actor-/medlemsbindning behåller
sina strikta kontroller. Ingen databasrad ändras av statusläsningen. Sju nya
integrationstester verifierar läsroller, gammal/främmande/skadad kontext,
ogiltig expiry, främmande slutfört flow, oförändrade rader, noll provideranrop
och fortsatt nekad callback utan kodutbyte.

## Ändring 2: kontoval sparar verifierat återanslutningskrav

Node stoppade ett kontoval när ett företagsmedgivande inte längre var giltigt,
men sparade bara återanslutningsstatus för den äldre felkoden
`renewal_required`. Företagslägets autentiserade policyfel kunde lämna raden
som `pending_account` eller `connected`.

Kontovalets felhantering använder nu samma fem tillåtna medgivandediagnoser som
befintlig synk: ogiltigt/utgånget medgivande, ändrat kontoscope, saknat
transaktionsscope och indragen företagsattest. Klassificeringen kommer från
`consentDiagnostic` och dess privata WeakMap, inte från godtyckliga felsträngar
eller providersvar. Kravet sparas under befintlig lease och sessionskontroll.

Testerna kontrollerar både en tidigare ansluten rad med verkligt syntetiskt
synkcheckpoint och rader som väntar på kontoval. Krypterad session, kontodata,
medgivandemetadata, valt konto, synktid och sluttid bevaras. Nya val-/synkförsök
gör inga ytterligare provideranrop efter det sparade avslaget. Separata negativa
prov verifierar att HTTP 401 för appbehörighet och HTTP 500 med förfalskad
medgivandefelkod inte blir en påhittad återkallelse.

## Ändring 3: Open Payments avstängning når fångad Node-transport

Node kontrollerade `SAAS_BANK_ENABLED` när mTLS-transporten skapades men inte i
dess fångade certifikat-/konfigurationskontroll. En redan skapad transport kunde
därför fortfarande användas direkt efter att bankfunktionen stängts av.
Ordinarie runtime och synk har ytterligare spärrar; fyndet bevisar inte att en
vanlig användare kunde kringgå hela kedjan.

Flaggan ingår nu också i kontrollen före och efter transportanrop. Den
befintliga felvägen återkallar transportens token-cacheidentitet. Ett senare
återställande av konfigurationen återupplivar inte en redan återkallad identitet;
en ny transport måste skapas och verifieras.

Fyra tester täcker avstängd/saknad flagga, noll socketförsök vid redan avstängd
transport, permanent återkallad cacheidentitet och avstängning under ett
pågående syntetiskt GET-anrop med verklig lokal loopback-mTLS. Det sistnämnda
är ett TLS-integrationsprov mot en lokal testserver, inte Open Payments.
Avstängningen sker innan det native svaret lämnas tillbaka; provet täcker inte
varje möjlig tidpunkt under efterföljande strömmad läsning.

## Exakta externa hinder

| Observerat eller ännu inte verifierat | Åtgärd och nödvändigt bevis |
| --- | --- |
| Den verkliga anslutningen är spärrad. Senaste lyckade synk: 2026-11-05 08:05:14 UTC. | Genomför ordinarie nytt medgivande efter att driftkraven nedan är uppfyllda. Kräv aktuell auktoriserad session/valid consent och uttryckligt kontoval. |
| Aktuell konfiguration använder den nya callbacken; cachad Enable-registrering har den gamla. | Behörig operatör verifierar aktuell leverantörsregistrering och registrerar exakt `https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site/api/bank/callback` om den saknas. Cache är inte ett färskt providersvar. Normal start gör även leverantörens preflight. |
| `BANK_COMPANY_AUTHORIZATIONS` finns inte i lästa driftsvariabler. Äldre anslutning saknar consentmetadata. | Hämta och kontrollera verklig bank-/providerattest för rätt företag, lagringsägare, bank och stabila kontonycklar. Konfigurera verifierad källa med begränsad giltighet. Syntetiskt bevis eller användarens egen uppgift räcker inte. |
| Inga Open Payments-/SaaS-bankinställningar observerades och ingen SaaS-bankrad fanns. | Verifiera godkänt produktionskonto/avtal, produktionsappens client credentials, AIS-produkt och corporate-context; konfigurera serverns generation, registreringar och verifierade bank-/PSU-/företagsuppgifter. Aktiveringsflaggan är ingen ersättning för dessa rättigheter. |
| Faktiskt produktionscertifikat och mTLS-bindning har inte verifierats. | Node behöver godkänt certifikat med skyddad privat nyckel; Workers behöver en riktig provisionerad mTLS-bindning samt matchande certifikatreceipt. Jämför faktisk bindning, publikt certifikat/fingeravtryck, giltighet och generation. En textvariabel med ett bindningsnamn räcker inte. |
| Swedbanks företagsbehörigheter har inte verifierats för den aktuella användaren och kontona. | Kontrollera Internetbanksavtal Företag. Företagets behörighetsadministratör ger Open Banking-behörighet per användare och konto under Användare och behörigheter; ändringen signeras med BankID. Verifiera att rätt person och rätt företagskonton omfattas innan kundflödet startas. |
| Användarens aktuella bankbehörighet och BankID/SCA saknar nytt kvitto. | Behörig företagsrepresentant genomför bankens autentisering själv. Avbrutet/nekande svar, en lyckad retur till appen eller en app-token är inte ett giltigt kundmedgivande. |
| Verklig kontotäckning, pagination, kvoter och import har inte provats. | Efter giltigt medgivande: begränsad läsacceptans av uttryckligen valda företagskonton, aktuell kontobehörighet, kompletta sidor, oförändrade resultat vid återspelning och säker frånkoppling/förnyelse. |

Frånvaro av konfiguration är verifierad i den lästa driftsrevisionen; det bevisar
inte att ett avtal eller certifikat saknas hos organisationen på annan plats.
Databasen hade tokenkontrolltabellerna, men närvaro är inte ett prov av
produktionskoordination eller migrationens funktion.

Open Payments-konfigurationen använder `SAAS_OPENPAYMENTS_CONFIG` och
`SAAS_OPENPAYMENTS_REGISTRATIONS`. Produktions-Node kräver
`SAAS_OPENPAYMENTS_MTLS_CONFIG`; Sites kräver
`SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG` och den faktiska mTLS-bindningen.
`SAAS_BANK_ENABLED=true` sätts först när dessa drifts- och behörighetskrav är
verifierade. Följ det länkade adapter-/transportkontraktet för respektive schema.

Bankgiro är en separat produkt-/källbehörighet. AIS eller
`accountinformation corporate` etablerar inte Bankgirotäckning. Aktivera endast
den ytterligare produkten när dess avtal, konto-/företagsbindning och källa är
styrkta. Ingen paymentinitiation-behörighet behövs för denna leverans.

## Avsett kundflöde efter att externa krav är uppfyllda

1. Kunden loggar in och väljer det företag där användaren har hanteringsrätt.
2. Kunden väljer bank och startar Anslut/Förnya. Servern kontrollerar aktuell
   konfiguration, stöd, callback och företagskontext.
3. Kunden följer leverantörens godkända flöde och genomför själv BankID/SCA.
4. Callback verifieras en gång. Servern läser aktuell consent/session,
   kontoidentitet, lässcope, giltighet och separat företagsbehörighet.
5. Kunden bekräftar endast tillåtna konton. Därefter kan första begränsade
   transaktionshämtningen ske. Återkallat/utgånget medgivande stoppar fortsatt
   hämtning och leder tillbaka till Förnya.

Decoupled-only SCA-stöd får inte antas där den aktuella adaptern bara stöder
redirect. PKCE exponeras inte av det använda adapterkontraktet; leveransen
påstår inte egen PKCE som saknar dokumenterat providerstöd.

## Verifiering och källbindning

Nya tester skrevs först och publicerades före respektive produktionsrättning.
[Verifieringsunderlaget](verification.json) innehåller de observerade
utvecklingsstegen och länkar till CI. Den slutliga PR-beskrivningen anger exakt
head, testade merge-källor, jobbutfall och antal från de slutförda körningarna.
Tidigare grönt eller förväntade testantal räknas inte som ett nytt körresultat.

Ordinarie `.github/workflows/payment-control-ci.yml` verifierar låsta
installationer, Node 22.23.4 och 24.22.1, syntax, kompletta syntetiska sviter,
beroendegranskning, Sites typkontroll och produktionsbygge, Bankgirobrygga,
Chromium och 1/10/100-företagsprestanda. Separat säkerhetsacceptans inkluderar nu
även de nya Node-recovery- och transporttesterna.

### Fryst GREEN-kvitto för den granskade produktionskoden

Källa: `090ae0a4ef9f2fe7ce6dd8b282622f93d9e21939`; testad PR-merge:
`f2ac5612644a079c98933857bf86e87fa213dfb1`, mot basen ovan.
[Full kvalitets-CI](https://github.com/sharbel0022/Mgeorge/actions/runs/42308985247)
och [säkerhetsacceptans](https://github.com/sharbel0022/Mgeorge/actions/runs/42308985277)
slutfördes utan misslyckat jobb.

| Kontroll | Observerat resultat |
| --- | --- |
| Full Node 22.23.4 | 3 025/3 025; syntax, låst installation och båda beroendegranskningarna godkända. |
| Full Node 24.22.1 | 3 025/3 025; samma obligatoriska kontroller godkända. |
| Full Sites | 5 827/5 827; typkontroll, verifierade installationer, beroendegranskning och produktionsbygge godkända. |
| Bankgiro SFTP-brygga | 47/47 syntetiska integrationstester samt syntax och beroendegranskning godkända. |
| Chromium | Syntetisk onboardingacceptans godkänd. |
| Företagsprestanda | Verifierad syntetisk körning för 1, 10 och 100 företag. Ingen extern bankprestanda uppmätt. |
| Separat säkerhetsacceptans | Node 396/396 och Sites 1 232/1 232. |

TAP-sviterna ovan hade noll fail/cancel/skip/TODO. Säkerhetssviterna överlappar de
fulla sviterna och Node-versionerna kör samma tester; antalen summeras därför
inte till ett påstått antal unika scenarier.

En separat kodgranskning av samma källa fann inga Critical/Important eller
bekräftade Minor-fynd. Den kontrollerade de tre produktionsrättningarna,
policyfelens proveniens, bevarade lease-/sessionsspärrar, de nya testfixturerna,
tokenidentitetens permanenta återkallelse och native svarsstädning. Den gjorde
inga verkliga bankanrop och gav inget produktionsacceptansbesked.

Den sista uppdateringen fryser dokumentation och kvitton. Exakta blob-SHA för
samtliga ändrade kod-/testfiler finns i verifieringsfilen; de ska vara oförändrade
mot den granskade GREEN-källan. PR-beskrivningen anger även resultat för den
slutliga dokumentationsrevisionens egna obligatoriska kontroller.

Lokalt passerade basens fyra fokuserade Node-bankfiler 49/49 före ändringarna.
En första start utan NODE_ENV=test avvisades av isoleringsskyddet.
Sites-fokuskörningen gav 127 godkända tester och två SIGKILL-processfel; ett
begränsat omförsök gav fyra godkända och ett SIGKILL. Exekveringsmiljön blev sedan
otillgänglig. Dessa lokala försök räknas inte som godkänd Sites-verifiering.
Arbetet fortsatte genom normala GitHub-commits och isolerad CI. När miljön återkom
hämtades de två ursprungliga RED-arkiven; SHA-256 matchade Actions-kvittona och
rå TAP bekräftade exakt de sju Sites-felen respektive fem Node-policyfall plus
deras föräldratest och fyra transportfel. [Bevarade felutdrag](red-observed.json)
innehåller källor, hash och faktiska diagnoser. Ingen ny lokal eftertestning påstås.

Alla nya bankdata, certifikat och svar i testerna är syntetiska. CI-spärren
tillåter lokal testtrafik och stubbar providergränserna. Godkända tester bevisar
kodens testade beteende; de bevisar inte kundens BankID, bankbehörighet, aktuellt
avtal, ett Open Payments-handshake eller en verklig företagskontohämtning.

Ingen verklig bankbegäran, betalning, produktionsmutation eller
certifikat-/miljöändring utfördes. Inga kvalitetspoäng höjs genom denna PR.

## Aktuella officiella kontrakt

Följande primärkällor lästes den 6 november 2026. Villkor för organisationens
faktiska avtal och bankprodukter behöver dessutom verifieras vid aktivering.

- [Swedbank: Internetbanken Företag, Open Banking-frågor](https://www.swedbank.se/foretag/digitala-tjanster/internetbanken-foretag/vanliga-fragor-och-svar.html):
  Internetbanksavtal Företag samt administratörens Open Banking-behörighet per
  användare och konto under Användare och behörigheter, signerad med BankID.
- [Enable Banking API](https://enablebanking.com/docs/api/reference/):
  /auth, /sessions, aktuellt sessionsstatus, bankens maximala consenttid och
  continuation_key.
- [Enable Banking FAQ](https://enablebanking.com/docs/faq/):
  ett medgivande kan upphöra före den lagrade sluttiden.
- [Open Payments production onboarding](https://docs.openpayments.io/docs/getstarted):
  godkänd organisation, separat produktionsapp, produktscope, whitelisted callback
  och organisationsspecifikt klientcertifikat.
- [Open Payments app-token](https://docs.openpayments.io/docs/get_access_token):
  client_credentials, accountinformation corporate och samordnad token per
  PSU-context. App-token ersätter inte kundmedgivande.
- [Open Payments consent](https://docs.openpayments.io/docs/create_consent) och
  [authorisations](https://docs.openpayments.io/docs/authorisations):
  konsekvent bank-/PSU-/företagskontext och verklig SCA.
- [Open Payments AIS](https://docs.openpayments.io/api/account-information-service-ais)
  och [felkatalog](https://docs.openpayments.io/docs/error_messages):
  giltigt consent, kontobundna sidor och skilda fel för åtkomst, kvoter och drift.
  Ingen expired-consent ISO-fallback aktiveras.
