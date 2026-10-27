# Slutrapport: Swedbank-integrationen, 27 oktober 2026

**Automatisk uppdatering:** Sites version 12 tillför automatisk hämtning med ett aktiverat molnschema fyra gånger per dygn och automatisk uppdatering av öppna sidor. Se [driftbeskrivning och verifiering](SWEDBANK-AUTOMATIC.md). Bankanslutningen och de importerade uppgifterna är bevarade.

**Aktuell status:** Swedbank är ansluten i Sites version 10 efter användarens personliga signering. Verkliga in- och utbetalningar visas i den privata arbetsytan; upprepad hämtning gav noll nya händelser. Ny produktionsapplikation är aktiv, gammal registrering är borttagen efter uttryckligt godkännande och runtime-hemligheter är installerade. 204 tester godkända. Se [verifierad produktionsstatus](SWEDBANK-PRODUCTION-STATUS.md) för aktuella detaljer. Avsnitten nedan bevarar kontrollhistoriken före registrering/aktivering och beskriver dåtidens hinder.

## Uppföljande kontroll före bankmedgivande

Ändringarna i denna uppföljning är publicerade som **Sites version 6**, källcommit `109574c4255855dec79ddb21e4a7432649dfd859`, deployment `appgdep_6ae0f0c98f508191869401f18de400d8` med resultat `succeeded`. Befintliga runtime-hemligheter och företagsdata har inte ändrats.

Efter grundimplementationen rättades två ytterligare fall i Sites-adaptern enligt Enable Bankings AccountResource-schema. Ett spärrat/stängt konto utan `uid` stoppar inte längre andra åtkomliga konton. Ett giltigt SEK-konto utan kontonummer kan identifieras med bankens primära `identification_hash`, omvandlad till ett bank-/landsspecifikt SHA-256-ID. Hashen visas aldrig som ett påhittat maskerat kontonummer. Befintliga IBAN-/BBAN-identiteter ändras inte.

Sites-sviten omfattar nu **84 godkända tester**, inklusive callback, kontoval, synkronisering och dubblettkontroll över förnyade konto-UID:n när banken bara lämnar en primär kontohash. TypeScript och produktionsbyggning är godkända. Tillsammans med Node-versionens 117 tester är det **201 godkända automatiska tester**. [Readiness-patchen](sites/swedbank-readiness.patch) bygger ovanpå version 5; den första Sites-patchen återger fortfarande exakt version 4→5.

Den nya RSA4096-nyckeln och det publika certifikatet har även verifierats lokalt mot samma PKCS#8/WebCrypto-import och signaturkontroll som appen använder. Privatnyckeln är skyddad utanför Git; den har inte skickats till webbläsaren, chatten eller leverantören. Nyckelparet är **genererat och verifierat, inte registrerat**. Den gamla registreringen är inte bekräftat återkallad. Kontrollpanelen visar fortfarande den gamla inaktiva applikationen; serverns bankhemligheter har inte installerats. Det återstår alltså registrering, återkallning, leverantörsaktivering och serverkonfiguration före det personliga bankmedgivandet. Ingen teknisk kontroll kan ge en garanti om ett ännu inte genomfört produktionsmedgivande eller verklig bankhämtning.

## Resultat

Kodändringarna är implementerade och testade i både GitHub-versionen och den separata ChatGPT Siten. Grundimplementationen publicerades som Sites version 5, källcommit `17f57738c1e1bc50a48741fab500771763d279a4`, och följdes av **version 6** ovan på [bankanslutningssidan](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/bank). Båda publiceringarna bekräftades som `succeeded`. En GitHub-push användes inte som ersättning för Sites-publicering.

**Swedbank är inte ansluten. Inga verkliga transaktioner från de senaste 30 dagarna har hämtats.** Den publicerade, inloggade bankvyn visar ”Ej ansluten” och ”Banktjänsten behöver aktiveras av systemadministratören.” Den befintliga Enable Banking-applikationen visas som **Inactive / PRODUCTION / Account Information** i kontrollpanelen. Detta är ett verkligt produktionshinder, inte ett fel som kan lösas genom att ändra knappens status.

## Implementerat

- Validerad serverkonfiguration, miljöseparering och uttryckligt krav på genomförd produktionsnyckelrotation. Tidigare delad PEM används inte. Rätt applikation, aktivt tillstånd, svensk AIS och exakt callback kontrolleras före medgivande.
- Swedbank Företag, enbart läsåtkomst, tillåten autentiseringsdomän, säker engångsstate och sessions-/ägarkontroll. Förfalskade eller återspelade callbacks kan inte ge lyckad anslutning. En utloggad webbläsare kan inte avsluta en redan pågående callback.
- Krypterade banksessioner och konton, separat kontoval, 30 inkluderade kalenderdagar initialt, paginering, kontroll av bokföringsstatus, dubbletter och utgångna medgivanden. Manuella bankåtgärder låses så att kontoval, hämtning, förnyelse och frånkoppling inte krockar.
- Node-versionen har sparad återförsökstid vid API-begränsning och valbar återkommande hämtning. Sites har manuell hämtning med befintlig begränsning och felhantering; ingen bakgrundsidentitet eller cron har konfigurerats där.
- Bankreferens, instabilt transaktions-ID, OCR, betalare och Bankgiro hålls åtskilda. Kontots sessions-UID används aldrig för beständig dubblettkontroll. Äldre importer med instabila ID:n kräver kontrollerad migrering, inte gissningar utifrån belopp.
- Samlingsposter blockeras tills komplett betalningsspecifikation finns. Node-importen kopplar specifikationen till ett sparat maskerat konto och kan ersätta/komplettera samlingsposten utan dubbelräkning. Sites kräver kompletta individuella uppgifter vid uppdelning och kan inte kringgå spärren genom en anteckning eller återtagen uppdelning.
- Riktning, delbetalningar, granskade matchningar och revisionshistorik bevaras. Belopp ensamt ger ingen automatisk betalning. Sites förslag och manuella matchningar kräver tillräcklig referens-/betalarinformation.
- Förenklad bankvy med aktivering, maskerat konto, giltighet, senaste uppdatering, hämtning, förnyelse, frånkoppling och alternativ filimport. Sites PEM-uppladdning är borttagen och det gamla konfigurations-API:t tar inte emot privata nycklar. Skyddade runtimehemligheter är enda nyckelkälla; äldre D1-nycklar används inte.
- Lokal Node-användning förblir lösenordsfri för en företagsadministratör. HTTPS-drift kräver administratörslösenord, säker cookie och behörighet för alla företags-API:er. Flera företag eller separata användarroller ingår inte.

## Ändrade filer

| Filer i GitHub | Ändring |
| --- | --- |
| `src/bank.js` | Enable Banking-konfiguration, JWT, AIS-avgränsning, applikationskontroll, redigerade fel, paginering och miljö-/nyckelkrav. |
| `src/server.js`, `src/security.js` | Administratörssessioner, callback, ägarskap, kontoval, krypteringsalias, synkronisering, lås, återförsök och importens kontokoppling. |
| `src/db.js`, `src/importers.js` | Additiva migreringar, stabila referenser, Bankgirofält, enskild XML-komplettering och spårbar historik. |
| `public/app.js`, `public/style.css` | Bankvy, inloggning för HTTPS, kontoval, verklig status, filimport och tydliga fel. |
| `test/bank.test.js`, `test/bank-api.test.js`, `test/bank-ui.test.js` | Nya adapter-, flödes-, behörighets-, samtidighets- och gränssnittstester. |
| `test/api.test.js`, `test/db.test.js`, `test/importers.test.js` | Regressioner för äldre sessioner, specifikationer, datum, delbetalningar, dubbletter och riktning. |
| `.env.example`, `.gitignore`, `package.json`, `scripts/check.mjs` | Konfigurationsmall, uteslutning av lokalt test-/Sites-material och automatisk syntaxkontroll av alla JS-filer. |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/SWEDBANK.md`, `docs/SWEDBANK-SITES-COMPARISON.md`, denna rapport | Driftguide, begränsningar, jämförelse, tester och manuella steg. |
| `docs/sites/swedbank-safety.patch` | Reproducerbar kodpatch mellan Sites version 4 och publicerad version 5, inklusive tester. |

Sites-patchen ändrar `components/bank-connection.tsx`, `cloudflare-env.d.ts`, `lib/banking/{enable-banking,runtime-config,service,status-view,store,transactions}.ts`, `lib/domain.ts`, `lib/imports.ts`, tre testfiler och Sites README. Den bygger på exakt version 4; tillämpa inte patchen över en senare version utan diffgranskning. Befintlig D1/R2-data och runtimehemligheter har inte ersatts.

## Tester och verifiering

| Kontroll | Resultat |
| --- | --- |
| `npm run check`, GitHub-versionen | Godkänd: 17 JavaScript-filer syntaxkontrollerade. |
| `npm test`, GitHub-versionen | **117 godkända**, 0 fel, 0 överhoppade. |
| Sites tre testsviter | **80 godkända**, 0 fel, 0 överhoppade. |
| Sites `tsc --noEmit --incremental false` | Godkänd. |
| Sites produktionsbyggning | Godkänd med samtliga bankroutes. |
| `npm run setup` och `npm start` | Godkända i en isolerad kopia med ny testdatabas och tom bankkonfiguration; befintlig privat `.env` och företagsdatabas användes inte. HTTP 200 för frontend och korrekt `not_configured` i bankstatus. |
| Lokal bankvy i Chrome | Swedbank, korrekt aktiveringsmeddelande, filimportalternativ och inga nyckelfält. |
| Publicerad Sites-version 5 i Chrome | Inloggad vy: Swedbank, Ej ansluten, aktiveringsmeddelande, inga PEM-fält. Alternativet för bankfil når bankvyn och importformuläret öppnas. Ingen fil laddades upp. |
| Publicerade endpoints utan inloggning | `/bank`: 200. `/api/bank/status`: 401 med `private, no-store`. Ogiltig `/api/bank/callback`: 303 till `result=expired`. Policy/villkor: 200. |
| Hemlighetskontroll | Inga bokstavliga privata PEM-block i föreslagna källfiler eller Sites-patch. `.env`, nycklar, testdatabaser, arkiv, skärmbilder och Sites-checkout hålls utanför Git. |

Testerna använder syntetiska uppgifter, genererade testnycklar och mockade leverantörssvar. **Inget riktigt Sandbox-medgivande har genomförts.** Kodvägar för Sandbox och Production testas med kontrollerade svar, inklusive att Sites inte blandar testhändelser med riktiga register. Dessa tester verifierar inte Swedbanks BankID-flöde eller företagets verkliga kontobehörighet.

## Vad som faktiskt kontrollerats i produktion

Sites-versionen är publicerad och dess användarvy, åtkomstskydd och ogiltiga callback är kontrollerade. Enable Bankings redan inloggade kontrollpanel visade applikationens inaktiva produktionsstatus. Sverige → Swedbank erbjöd `business`. Ingen länkningsknapp användes, ingen privat nyckel lästes och inga bank-API-anrop med verkliga uppgifter gjordes.

Registreringens policy-/villkorslänkar är omkastade: Privacy policy pekar på användarvillkor och Terms of service på integritetspolicy. Detta dokumenteras för administratören; ingen leverantörsregistrering eller säkerhetsinställning ändrades.

## Manuella steg som återstår

1. Återkalla den komprometterade nyckeln/certifikatet enligt Enable Bankings process. Skapa och registrera en ny nyckel. Lämna endast det publika certifikatet till leverantören; skicka aldrig privat PEM i chatt eller GitHub.
2. Ordna aktivering av produktionsapplikationen, rätt avtal/AIS-behörighet och eventuell kontolänkning enligt leverantörens godkända process. Kontrollera företagskontots behörigheter och rätta de omkastade dokumentlänkarna. BankID ersätter inte applikationsaktiveringen.
3. Lägg det nya applikations-ID:t och den nya privata nyckeln i skyddad serverkonfiguration för valt driftmål, välj `PRODUCTION` och bekräfta rotation med `ENABLE_BANKING_KEY_ROTATED=true`. Bevara befintlig lagringsnyckel. För Sites heter den `BANK_DATA_ENCRYPTION_KEY`; för Node `BANK_DATA_KEY`/`ENCRYPTION_KEY`.
4. Registrera exakt `https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback` för Siten. En annan domän behöver sin egen registrering, HTTPS och åtkomstskydd.
5. Behörig användare klickar Koppla banken, identifierar sig hos Swedbank och godkänner läsåtkomst, väljer företagets konto och hämtar de senaste 30 dagarna.
6. Jämför en känd inbetalning och utbetalning mot original, upprepa hämtningen utan nya dubbletter och granska Bankgirospecifikation samt manuell fakturamatchning innan ordinarie drift. Kontrollera backup och återställning för valt driftmål.

Detaljerad konfiguration och primär källa finns i [bankguiden](SWEDBANK.md) och [Enable Bankings officiella API-specifikation](https://enablebanking.com/docs/api/reference/).
