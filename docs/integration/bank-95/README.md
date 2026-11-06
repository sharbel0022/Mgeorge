# Agent 1 — verklig bankanslutning, 2026-11-05

Branch: `feature/95-bank`. [PR #45 mot main](https://github.com/sharbel0022/Mgeorge/pull/45). Ursprunglig inventerad main-bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5` (PR #44). Under slutkontrollen tillkom PR #48; även main `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` inventerades och integrerades. Uppdraget omfattar befintlig Swedbank/Enable Banking- och Open Payments-kod, isolerade regressioner och PR mot main. Produktionsaktivering, nya medgivanden och betalningar ingår inte i genomförda åtgärder.

## Verkligt nuläge och förklaringen till `connected=false`

[Färskt skrivfritt statuskvitto](observed-status.json), avläst 2026-11-05 18:21 UTC, visar fortfarande `connected=false`, senaste lyckade hämtning 08:05:14 UTC och senaste försök 14:04:35 UTC. Inga provideranrop, BankID-signeringar eller produktionsskrivningar gjordes för denna kontroll.

Det tidigare incidentkvittot på main anger `BANK_ACCOUNT_SCOPE_INVALID` och `reauth_required`, trots ett sparat slutdatum 2027-01-25. Det exakta underkända kontopredikatet sparades inte; det går därför inte att i efterhand fastställa om det gällde kontolista, valt konto, kontoanvändning eller identitetskonflikt. Ett framtida slutdatum visar en yttersta lagrad giltighet, inte att banken fortfarande medger läsning. Enable Banking beskriver uttryckligen att sessioner kan upphöra tidigare och att kontoåtkomst kan nekas efter ett lyckat sessionsstatusanrop [E1, E2].

PR #43 hade redan rättat en reproducerad kompatibilitetsregression för äldre anslutningar: ett tidigare valt konto A får behållas när ett annat, inte valt, cachat konto B lämnar det aktuella medgivandet. Den avgränsningen bevaras. Nya företagsmedgivanden behåller strikt validering av hela den godkända kontomängden. Den historiska produktionsorsaken får inte ersättas med en gissning om att den redan rättade regressionen var den enda orsaken.

En separat, verifierad återanslutningsrisk finns i baskoden: Sites hade returadressen hårdkodad till den tidigare domänen `mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site`, medan rapporterad aktuell driftdomän är `mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site`. Cachad registreringsmetadata från 27 oktober innehöll den gamla adressen. Detta styrker ett konfigurationsfel i återanslutningsvägen; det bevisar inte att returadressen orsakade det redan pågående medgivandets kontofel. Aktuell registrering hos leverantören måste verifieras före ny SCA.

## Inventering av befintlig arkitektur

| Del | Befintliga huvudfiler | Ansvar och bevarad gräns |
| --- | --- | --- |
| Enable Banking i Node | `src/bank.js`, bankdelarna av `src/server.js`, `src/bank-consent.js` | Signerad server-JWT, appkontroll, SCA-start, engångscallback, krypterad session, explicit kontoval och synk. |
| Enable Banking i Sites | `sites/lib/banking/service.ts`, `enable-banking.ts`, `store.ts`, `runtime-config.ts`, `security.ts` | Serverägda hemligheter, D1-flöden och lease, ägar-/företagskontroller, callback och schemalagd/manuell läsning. |
| Gemensamt medgivande | `sites/lib/bank-consent-policy.js`, `sites/lib/bank-company-authority.js` | Aktuell medlemskapstillhörighet, lässcope, slutdatum, godkända konton och separat bankstyrkt företagsrelation. |
| Open Payments | `sites/lib/banking/openpayments-provider.js`, `openpayments/{config,http,token,authorization}.js` | Fasta ursprung, corporate AIS-scope, tokenlivslängd, mTLS-gräns, resursbundna krypterade handtag, SCA och pagination. |
| Beständig Open Payments-livscykel | `openpayments-lifecycle.js`, `saas-bank-runtime.js`, Node-/Sites-adaptrar | Revision/CAS, engångsstate, osäkra utfall, återkallelse och företagets aktuella behörighet. |
| Synk och original | `sync-periods.ts`, `transactions.ts`, kontoläsningsskydd, företagskoordinatorer och befintliga importmotorer | Begränsade perioder/sidor, varaktig kvot, stabil kontoidentitet, atomisk import/checkpunkt, original och konfliktspärrar. |
| Driftstatus | `service.ts`, Node-bankendpoints, befintliga statusprojektioner | Lokal status är sparad evidens. Ett lyckat test eller en framtida giltighetstid får inte skapa bankauktorisation. |

Enable Banking-koden används mot Swedbank via leverantören. Det införs ingen parallell direktintegration med Swedbanks svenska PSD2-endpoints eller betalningsfunktion.

## Förbättringar och avsedd funktion

### OAuth, återanslutning och behörigheter

Returadressen hämtas från `ENABLE_BANKING_REDIRECT_URL`, med serverägd `APP_ORIGIN` plus `/api/bank/callback` som kompatibel alternativkälla. Båda inställningarna måste stämma överens om båda finns. Endast en kanonisk HTTPS-adress med exakt callback-sökväg godtas. Adressen kontrolleras mot färsk leverantörsregistrering och binds exakt till det sparade anslutningsförsöket. Startbegäran måste dessutom komma till samma origin, så att webbläsaren kan återlämna den värdbundna cookien. Begärans Host/Origin väljer aldrig konfigurationsvärdet. En redan startad callback använder sin sparade adress även efter en konfigurationsändring.

Befintliga engångsstate/cookie-, företags-, medlemskaps-, appgenerations- och commitkontroller bevaras. Medlemskapsversionen kontrolleras igen efter asynkront arbete. Förnyelse skapar ett nytt medgivande och validerar nya konto-ID:n innan en tidigare anslutning ersätts. Att förnya en server-JWT eller Open Payments access token förnyar inte kundens medgivande [E1, E2, O1, O2].

Syntetiska utgångna, avbrutna och felaktiga återanslutningar ska bevara tidigare ekonomiska uppgifter och kräva relevant ny SCA eller konfiguration. Ingen status återställs med en administrativ SQL-uppdatering.

Den misstänkta spärren mot att förnya ett utgånget medgivande visade sig inte vara ett kodfel: SQL-predikatet avser det nya medgivandets giltighet. Kontrollen behålls och täcks nu av en regression. Däremot rättas Node-synkens felklassning: fem kanoniska medgivande-/kontobehörighetsavslag blev tidigare `error`, och blir nu `renewal_required`. Nästa försök stannar före provideranrop; tidigare session och checkpunkt bevaras.

### Integration med den nya main-versionen

PR #48 landade under slutkontrollen och innehöll bland annat callbackinformation för gränssnittet och en uttrycklig återvalidering av ett kvarhållet legacy-medgivande. Den funktionen bevaras: endast en färsk, godkänd providersession med de redan valda kontona kan återställa operativ status. Ett utgånget eller återkallat medgivande kan inte förlängas genom återvalidering; en ny SCA-resa krävs då. Företagsanslutningar får inte kringgå företagets behörighetsmodell genom legacy-vägen. Ingen sådan verklig återvalidering har körts i detta uppdrag.

Vid sammanslagningen förenades callbackreglerna i `runtimeBankRedirectUrl`. Den äldre exporterade konstanten behålls som kompatibilitetsreferens, men används aldrig som konfigurationsfallback. Main-versionens callbackinformation i status och gränssnitt bevaras tillsammans med den nya precisa hälsoprojektionen.

Granskningen reproducerade race conditions där ett medgivande kunde löpa ut eller börja återkallas mellan den tidiga kontrollen och anropet. Den gemensamma läsvakten kontrollerar nu aktuell giltighet, status, session, kontoidentitet, kontoval och medgivandekontext direkt före alla berörda läsningar. Förberedande sessionsdekryptering sker före den sista kontrollen. Strikt väntetidspolicy för återvalidering hålls separat, så att befintlig synkkvot och kontoval inte ändras.

Återvalidering verifierar också apphälsan före återaktivering och binder appmetadata i samma atomära skrivning som anslutning och kvitto. Vanligt svar, kvittoreplay och återhämtning efter ett förlorat commitsvar projicerar aktuell hälsa. Ett tidigare lyckat kvitto kan alltså inte påstå aktuell anslutning när appkonfigurationen därefter blivit ogiltig. Sexton nya regressioner gick från reproducerade fel till godkända resultat; 80 integrerade bankfall och 163 befintliga konto-/detalj-/kvotfall passerade efter rättningen. Den separata slutgranskningen hittade inga ytterligare materiella fel i denna diff.

### Sanningsenlig status och sekretessäker diagnos

Den gemensamma lokala hälsokontrollen skiljer mellan frånkoppling, pågående återkallelse, saknad konfiguration/lagring, ändrad appgeneration, återautentisering, utgånget medgivande, saknad företagsbehörighet och saknat kontoval. Företagsbeviset måste också täcka just de valda kontona. Ett verifierat bevis för ett annat konto räcker inte.

Statussvaret behåller tidigare fält och kompletteras med `connectionStatus`, `requiresReauthentication`, `blockedReason`, `nextAction`, `syncAllowed`, `statusEvidence` och en säker diagnos. `statusEvidence=stored_connection` anger uttryckligen att inget nytt banksvar har hämtats. Ett återautentiseringskrav ger inget utlovat nytt schemalagt försök.

Det etablerade `connection.status` behåller `reauth_required` vid saknad serverkonfiguration för äldre konsumenter. Det nya `connection.connectionStatus=configuration_required`, tillsammans med `nextAction=configure_service`, anger att operatörskonfiguration behöver åtgärdas. GitHubs första fulla körning fångade den kompatibilitetsavvikelsen; det befintliga säkerhetstestet behölls och kompletterades med assertioner för den nya diagnosen.

Läsroller kan läsa befintlig bankstatus med uttrycklig läsbehörighet. Förvaltning och synk behåller standardkravet på hanteringsbehörighet; regressioner verifierar att viewer/accountant inte får `syncControl`-åtkomst genom statusrättningen.

Kontovalideringen har tolv fasta orsaker, exempelvis `CURRENT_ACCOUNT_INVENTORY_MISMATCH`, `CONSENT_ACCOUNT_INVENTORY_CHANGED`, `ACCOUNT_IDENTITY_CHANGED` och `SELECTED_ACCOUNT_UNAVAILABLE`. Själva kontovärdet, IBAN, medgivande, token och rått providerfel sparas inte i diagnosen. Felklassens privata proveniens används; ändrade publika fält, anpassade feltexter, getter-funktioner och förfalskade prototyper kan inte bli diagnostiskt bevis. Även Enable-providerfel får kanonisk publik/persisterad text.

Jobbhändelser binds till det lokala anslutnings-ID:t och senaste tillståndsändringen. Ett fel från en tidigare anslutning kan inte presenteras som diagnos för en ersättande anslutning. Lokal korrelation ger inget tillstånd att läsa bankdata.

### Transport, konton och transaktioner

Enable-adaptrarnas tidsgränser avslutar även anroparens väntan när transport eller svarsläsning inte reagerar på AbortSignal. Fel vid stängning av en svarskropp döljer inte det ursprungliga nekade eller för stora svaret. En icke samarbetsvillig fjärrtjänst kan fortfarande slutföra sin behandling; avbrottet bevisar inte att en mutation uteblev. Inga automatiska upprepningar av engångskoder eller oklara medgivandeändringar läggs till.

Den oberoende transportgranskningen reproducerade ytterligare en befintlig lucka: Node accepterade ett svar på 2 097 167 bytes och kunde börja läsa ett sent svar efter timeout. Node har nu samma gräns som Sites, 2 097 152 bytes. Både deklarerad längd och faktiskt strömmade bytes kontrolleras före avkodning. `response_too_large` avvisar hela svaret; ingen del av transaktionshämtningen returneras för import. Exakt gränsvärde och delade UTF-8-tecken fungerar. Ett sent svar avbryts före kroppsläsning. Känd Retry-After på 429/503 behåller företräde framför kroppsläsning och storleksfel.

Open Payments-kontot får inte användas när banken uttryckligen anger `blocked` eller `deleted`. Okända eller feltypade status-/usage-värden avvisas. Dokumentationens valfria fält förblir valfria: frånvaro av `usage` eller `status` avvisas inte enbart för att fältet saknas. `ORGA` är professionell kontoanvändning, inte bevis att kontot tillhör det valda företaget [O3].

En förlorad, avbruten eller misslyckad DELETE för ett medgivande klassas som en möjlig fjärrändring. Anslutningen får inte antas vara återkallad bara för att svaret saknas. Transporten upprepar inte mutationen automatiskt; befintlig beständig `revocation_pending`-hantering bevaras.

Befintlig pagination och identitetsmodell bevaras: Enable fortsätter genom `continuation_key`, Open Payments läser `transactions._links.next` med samma konto och datumintervall. Tomma sidor med en fortsättningsnyckel är inte slutet. Dubblettskyddet använder kontoavgränsad stabil transaktionsevidens; Enable `transaction_id` får inte ersätta `entry_reference` som ekonomisk identitet. Förnyade provider-UID:n får inte skapa ett nytt ekonomiskt konto om bankstyrkt stabil identitet är densamma [E2, O3].

## Officiell dokumentation kontrollerad 2026-11-05

| Ref | Primärkälla | Verifierat och relevant |
| --- | --- | --- |
| E1 | [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) | RS256/JWT, `/auth` → SCA → callbackkod → `/sessions`, business-PSU, sessionsstatus, konto-/transaktionsläsning och felkontrakt. |
| E2 | [Enable Banking FAQ](https://enablebanking.com/docs/faq/) | Ny auktorisation vid förnyelse; nya sessions-/konto-UID:n; stabil identitet, `entry_reference`, tomma paginerade svar och tidigarelagd sessionsutgång. |
| E3 | [Enable Banking knowledge base](https://enablebanking.com/knowledge-base) | Publik produktionslansering kräver avtal/KYB; begränsad egenkontoutvärdering styrker inte flerkundsdrift. |
| O1 | [Open Payments access tokens](https://docs.openpayments.io/docs/get_access_token) | Client credentials, `accountinformation corporate`, en timmes tokenlivslängd och separat Bankgirobehörighet. Sidan anger ändringsdatum 2026-10-15. |
| O2 | [Open Payments authorisations](https://docs.openpayments.io/docs/authorisations) | Återgiven SCA-metod/approach, exakt redirect-URI vid kodutbyte, resursbundna headers och faktisk PSU-närvaro. |
| O3 | [Open Payments AIS API](https://docs.openpayments.io/api/account-information-service-ais) | Corporate-ID, konto-status/usage, kontobunden transaktionsläsning och nästlad pagination. |
| O4 | [Open Payments consent guide](https://docs.openpayments.io/docs/create_consent) | Kundauktorisation separat från apptoken, statuskontroll och högst fyra obevakade åtkomster per dygn om inget annat avtalats. |
| O5 | [Open Payments getting started](https://docs.openpayments.io/docs/getstarted) | Produktionsgodkännande, organisationsspecifikt klientcertifikat, rätt API-produkter och tillåtna returadresser. |
| O6 | [Open Payments API conventions](https://docs.openpayments.io/docs/api) | Åtskilda sandbox-/produktionsursprung, corporate-scope och unikt `X-Request-ID` för spårbarhet. Det dokumenteras inte som idempotensnyckel. |
| S1 | [Swedbank Open Banking FAQ](https://www.swedbank.com/openbanking/faq.html) | Svensk redirect-SCA/BankID och företagsadministratörens roll vid saknad Open Banking-behörighet. |
| S2 | [Swedbank PSD2 onboarding](https://www.swedbank.com/openbanking/contact-us-openbanking/golive.html) | Direkt TPP-integration kräver relevant tillstånd, registrering och QSEAL/QWAC. Dessa direktkrav ska inte automatiskt tillskrivas aggregatorns kundmodell. |

Swedbanks aktuellt länkade svenska PDF-adress gav HTTP 403 vid verifiering. Den inloggade portalversionen har därför inte certifierats som åtkomlig. Norges separata API-dokumentation används inte som ersättning för svenska produktionskrav. Ingen ny livslängdsregel införs från äldre FAQ-uppgifter. Befintliga försiktiga applikationsgränser kan begränsa den begärda perioden; validerad leverantörs-/bankgiltighet är fortfarande en övre gräns.

## Externa krav innan verklig produktionsacceptans

| Krav | Vad operatören behöver styrka | Vad kod/test kan styrka utan detta |
| --- | --- | --- |
| Enable-app och nyckel | Rätt produktionsapp, aktiv AIS för SE/företag, registrerad publik nyckel och skyddad motsvarande privat nyckel; eventuell tidigare nyckel korrekt återkallad. | Felaktig konfiguration, nyckel-/generationsbyte och obehöriga ursprung blockeras. |
| Returadress | Aktuell HTTPS-adress i serverkonfiguration och exakt samma adress i providerregistreringen. | Validering, sparad flow-bindning, fel värd, ändrad konfiguration, replay och nekad registrering. |
| Enable-avtal | Rätt avtals-/KYB- och användningsmodell för den avsedda företags-/flerkundstjänsten. | Koden tillverkar inte avtalsgodkännande eller kontolänkar. |
| Open Payments | Produktionsgodkänd organisation, klientuppgifter, aktiverade AIS corporate-produkter, giltigt klientcertifikat och verklig mTLS-transport. | Vanlig fetch kan inte kringgå produktionskravet; scope, certifikatstatus och origin kontrolleras. |
| Företag och konton | Aktuellt medlemskap/roll samt bank-/providerstyrkt rätt att företräda företaget och använda just de valda kontona. | Privat konto, fel företag, återkallad eller delvis indragen behörighet, okänd identitet och stängda/spärrade konton avvisas. |
| Ny kund-SCA | Användaren genomför bankens aktuella BankID-/SCA-resa och bekräftar medgivandet. | Avbrott/avslag, utgången callback och oklara utfall behåller spärrar och historik. |
| Bankgiro | Separat produkt/scope, kundavtal och styrkt konto-/Bankgiro-/rapportrelation. | AIS eller en samlingsinsättning kan inte skapa obestyrkta enskilda betalare eller matchningar. |

Efter att externa krav är klara: genomför en uttryckligt godkänd anslutning på rätt driftdomän, verifiera företag och konto, gör en begränsad läsning inom medgivandet och kontrollera original/checkpunkt. Återläs samma intervall och verifiera noll extra ekonomiska dubbletter. Verifiera därefter aktuell schemakvot samt en kontrollerad utgångs-/förnyelseresa. Det är framtida acceptanssteg; de har inte körts mot kundens bank i detta uppdrag.

## Verifieringskvitto och granskning

**Slutlig integrerad programkod:** `5f71a3c4840739bcf0786693a00b4213ab59ceba`, repositoryträd `80214932045cb75df02d54c8324f4df0a5443ee0`, med main `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` integrerad. GitHub testade PR-mergecommit `9264e1515fd1a431dbf3455e0e1c30860091c240`; dess träd kontrollerades exakt lika med kodcommitten. Senare leveransändringar gäller bara denna rapport, kvitton, plan och poäng-/framstegsreferenser. [Maskinläsbart verifieringskvitto](verification.json) innehåller även underträdshashar för programkod och tester.

[Payment control checks, körning 42083045947](https://github.com/sharbel0022/Mgeorge/actions/runs/42083045947) och [SaaS security acceptance, körning 42083045911](https://github.com/sharbel0022/Mgeorge/actions/runs/42083045911) är godkända. CI använde Node 22.23.4. Samtliga nedanstående testsviter har **0 fel, 0 avbrutna, 0 överhoppade och 0 TODO**.

| Grind på den integrerade koden | Resultat |
| --- | --- |
| Node: låst installation, `npm run check`, high-audit och `NODE_ENV=test npm run test:isolated` | **2 013/2 013**, syntax för 182 JavaScript-filer, 0 auditfynd. |
| Sites: `npm run install:ci`, exakt minimatchkontroll, `npm run check`, high-audit och `NODE_ENV=test CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false npm run test:isolated` | **3 938/3 938**, typkontroll godkänd, 0 high/critical. |
| Sites: `CLOUDFLARE_CF_FETCH_ENABLED=false npm run build` | **Godkänt produktionsbygge**. |
| Bankgiro-bridge: låst installation, syntax, production-audit och isolerad testsvit | **47/47**, 0 auditfynd. Bridge-koden ändras inte av bank-PR:n. |
| Separat säkerhetsacceptans: `node scripts/run-saas-security-acceptance.mjs <evidence-directory>` | **325 Node + 823 Sites = 1 148**. Dessa fall överlappar helsviterna och adderas inte till totalsumman. |

Helsviterna innehåller tillsammans **5 998 godkända tester**. Sites har fortfarande åtta moderate-fynd i utvecklingsberoenden; inga paketversioner eller låsfiler ändrades. De lokala slutliga syntax-, typ- och byggkontrollerna passerade också på den integrerade koden med Node 24.22.1/npm 11.9.0. Den exakta lokala minimatchkontrollen visade ett verifierat mål och noll skrivningar.

De riktade verifieringarna är beteendetester med syntetiska providergränser och verkliga HTTP-/SQLite-/D1-tillstånd där det är relevant: bland annat 135 Node-bankfall för transporten, 80 integrerade bankfall inklusive 16 nya merge-regressioner samt 163 befintliga konto-/detalj-/kvotfall. Riktade tal överlappar helsviterna. De isolerade helgrindarna laddar repositoryts nätverksspärr före testerna. Verkliga bankuppgifter används inte som fixtures.

Separata granskningspass omfattade callback/state/cookie/medlemskap, statuskontrakt och användande gränssnitt, Open Payments felkonsumenter, Enable-transport samt den nya main-integrationen. Node-granskningens storlekslucka rättades med RED/GREEN och granskades igen; granskaren körde själv tio transportfall. Efter integrationsrättningen hittades inga ytterligare materiella fel inom den granskade ändringen. Detta är kodgranskning och intern acceptans, inte extern bankcertifiering.

### Tidigare körningar och rättade fynd

Första GitHub-körningen på `418fc7a` gav 1 907/1 907 Node, 47/47 bridge och 3 827/3 828 Sites; säkerhetskörningen hade samma enda statuskompatibilitetsfel. Det etablerade `reauth_required`-värdet återställdes i det gamla fältet, och en separat precis diagnos lades till. Det befintliga testet behölls. Nästa GitHub-körning på `65917c6` passerade alla 1 907/3 828/47 samt 325/769 säkerhetsfall. De resultaten gäller den äldre basen och ersätter inte de nya 5 998/1 148-resultaten ovan. Tidigare lokala fulla körningar gav också 1 907 Node och 3 828 Sites före den sista main-integrationen; de räknas inte som slutverifiering av den nya basen.

Första lokala Node-baslinjeförsöket saknade `NODE_ENV=test` och stoppades av isoleringsskyddet. Rättad baslinje gav 364/364. Ett parallellt Sites-baslinjeförsök gav 423 godkända och en avbruten testprocess; inget produktionsfel eller exakt resursfel fastställdes. De körningarna räknas inte som godkända slutgrindar.

### Ändrade filer och avgränsning

| Filer | Ändring |
| --- | --- |
| `sites/lib/bank-consent-policy.js`, `sites/lib/bank-consent-policy.d.ts` | Privat felproveniens, fasta diagnoser och ren projektion av sparad anslutningshälsa. |
| `sites/lib/banking/service.ts`, `sites/lib/banking/store.ts`, `sites/lib/banking/runtime-config.ts` | Konfigurerad callback, app-/företagskontroller, återanslutning, läsbehörighet, status och säkra jobbhändelser. |
| `sites/lib/banking/enable-banking.ts`, `src/bank.js` | Begränsad väntan och svarsstorlek, bevarad kvotinformation och försiktig hantering av avbrott. |
| `sites/lib/banking/account-read-guard.ts`, `sites/lib/banking/details-service.ts` | Aktuellt medgivande och oförändrad anslutningskontext precis före bankläsning. |
| `sites/lib/banking/openpayments-provider.js`, `sites/lib/banking/bank-data-provider.js` | Kontostatus-/usage-kontroll och fast felkod för otillgängliga konton. |
| `sites/lib/banking/openpayments/http.js` | Osäkert utfall även för en avbruten eller förlorad DELETE. |
| `src/bank-consent.js`, bankdelen av `src/server.js` | Kanoniska medgivandeavslag ger krav på förnyelse och spärrar nästa försök. |
| `sites/tests/bank-diagnostics-95.test.mjs`, `sites/tests/bank-transport-95.test.mjs`, `sites/tests/banking-security.test.mjs` | Policy, sekretess, status, medlemskap, callback, förnyelse och Enable-transport. |
| `sites/tests/openpayments-account-access-95.test.mjs`, `sites/tests/openpayments-mutation-95.test.mjs` | Kontoåtkomst och osäkra mutationsutfall. |
| `test/bank-transport-95.test.js`, `test/consent-reconnect-95.test.js` | Node-transport och verkliga HTTP-/SQLite-gränser med syntetisk provider. |
| `docs/integration/bank-95/*`, `docs/superpowers/plans/2026-11-05-real-bank-connection.md`, `PROGRESS.md`, `QUALITY-SCORECARD.md` | Verifieringsbevis, officiella källor, externa krav och oförändrade numeriska produktionspoäng. |

Inga paketversioner, låsfiler, databasmigrationer, betalningsfunktioner eller produktionsinställningar ändras av denna PR.

## Bedömning av 9,5-målet

Koden kan förbättras och verifieras utan att ett verkligt bankmedgivande fabriceras. Område 15 (bankanslutning) behåller 8,5 och område 16 (bankhämtning) 8,0 tills faktisk produktionsacceptans finns. Övriga områden ändras inte. Basens sammanlagda 255/330 = 7,73/10 behålls. Ett höjt testantal, en öppnad PR eller att medgivandets slutdatum ligger i framtiden ger inte 9,5/10 i verifierad bankdrift.
