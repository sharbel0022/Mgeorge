# Swedbank: GitHub och publicerad ChatGPT Site

**Aktuell driftuppföljning:** Version 10 är publicerad med runtime-revision 3. Ny produktionsapplikation är aktiv och den gamla borttagen efter uttryckligt godkännande. Workers-transport och Swedbanks faktiska Enable Banking-domän är rättade i server och klient. 204 tester godkända. [Aktuell status och återstående bankmedgivande](SWEDBANK-PRODUCTION-STATUS.md), [patch version 6→10](sites/swedbank-worker-compatibility.patch). Jämförelsen nedan är historik från tidigare versioner.

**Senaste uppföljning:** version 6 är publicerad, commit `109574c4255855dec79ddb21e4a7432649dfd859`. Den kompletterar version 5 med stöd för primär kontohash när kontonummer saknas samt korrekt filtrering av stängda/spärrade konton utan `uid`. Befintliga kontonumrens identiteter bevaras. 84 Sites-tester, TypeScript och produktionsbyggning är godkända. [Patchen version 5→6](sites/swedbank-readiness.patch) är separat från grundpatchen nedan. Se [uppdaterad rapport](SWEDBANK-REPORT.md).

Kontrollerat 2026-10-27. Baslinjen nedan är Sites **version 4**, commit **`f8cdd8b1d06ac11058061da81e4d0e1d02d52364`**, för [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site). Säkerhetsändringarna har därefter publicerats separat som **version 5**, commit **`17f57738c1e1bc50a48741fab500771763d279a4`**. Publiceringen returnerade `succeeded`. Inga befintliga privata miljöfiler, nycklar eller banksessioner lästes. Inga riktiga bankanrop gjordes och inga runtime-hemligheter ändrades.

## Publicerat i version 5

- PEM-formuläret har tagits bort. `/api/bank/config` avvisar uppladdning utan att läsa request-body. Äldre krypterade D1-nycklar används aldrig för leverantörsanrop.
- Endast skyddade runtimevärden används: `ENABLE_BANKING_APPLICATION_ID`, `ENABLE_BANKING_PRIVATE_KEY`, `ENABLE_BANKING_ENVIRONMENT` och för produktion `ENABLE_BANKING_KEY_ROTATED=true` efter verklig rotation. Befintlig `BANK_DATA_ENCRYPTION_KEY` bevaras. Nyckelbyte ändrar applikationens generation så att gamla callbackflöden inte kan användas.
- Swedbank är förvald. Användaren ser aktiveringsmeddelande, filimport, bankens godkännande, maskerat kontoval, giltighet, senaste uppdatering, hämtning, förnyelse och frånkoppling. Förfalskade URL-parametrar kan inte visa en lyckad bankbekräftelse utan aktuell serverstatus.
- Bankgiroinsättningar utan individuella uppgifter spärras som samlingsposter. Anteckning eller återtagen uppdelning kan inte kringgå spärren. Uppdelning kräver namn, referenser och korrekt summa. Enbart samma belopp ger varken förslag eller godkänd betalning.
- Befintliga ägargränser, kryptering, engångscallback, bankverifiering, Sandbox-isolering och revisionskontrollerad lagring bevaras. Inga D1-migreringar krävdes. Om en gammal anslutning inte kan återkallas med den nya serverkonfigurationen anges uttryckligen att frånkopplingen är lokal och att medgivandet måste återkallas hos banken/Enable Banking.

**Verifiering:** 80 automatiska tester, TypeScript utan fel och lyckad produktionsbyggning. Den separata native Sites-publiceringen lyckades med deployment `appgdep_6ae0eaa717708191892d4429110cbe70`, version `appgprj_6adf2f7f7e848191b64192161886b528~appgver_d326f99fb50c8191b6735135581a7403`. Källa och byggarkiv kom från samma pushade commit. Den publicerade bankvyn kontrollerades i webbläsaren. Ett sådant produktionsbygge är inte ett verifierat bankmedgivande.

GitHub innehåller en reproducerbar [patch för Sites](sites/swedbank-safety.patch), mot baslinjens commit ovan. Öppna den befintliga Siten med Sites-källflödet och använd `git apply --check` före `git apply` på patchen. Publicera bara efter Sites egna tester/typkontroll/byggning; kopiera aldrig GitHub-versionens SQLite-data över D1/R2. En GitHub-push publicerar fortfarande inte Siten.

Kvarstående driftgränser: Sites har **manuell** bankhämtning. Ingen cron eller bakgrundsidentitet har lagts till. För en äldre API-samlingspost som inte automatiskt kan kopplas till en filspecifikation används granskad uppdelning med komplett underlag; en identisk summa räcker aldrig. Node-versionens schemaläggning och automatiska XML-komplettering är separata funktioner.

## Baslinje: skillnader och brister i version 4

## Två separata installationer

| Område | GitHub-versionen i detta repository | Publicerad Site, version 4 |
| --- | --- | --- |
| Körning | Node.js, JavaScript, inbyggd HTTP-server, statiskt gränssnitt | TypeScript, React 19, Vinext/Vite, Cloudflare Worker |
| Register och original | Lokal SQLite, original som databas-BLOB | D1 med revisionskontrollerad JSON-arbetsyta per ägare; R2 för originalfiler |
| Identitet | Lokal företagsadministratör; skyddad administratörsinloggning för HTTPS enligt denna implementation | Sites betrodda ChatGPT-identitet, `userId` som ägare; ingen gemensam företagsroll |
| Bankkod | `src/bank.js`, `src/server.js` | `lib/banking/enable-banking.ts`, `service.ts`, `store.ts`, `security.ts`, `transactions.ts` |
| Leverantörsnyckel | Skyddad serverkonfiguration, med spärr för produktion tills nyckelrotation bekräftats | PEM väljs i webbläsaren och skickas till `/api/bank/config`; lagras därefter krypterad per ChatGPT-ägare i D1 |
| Krypteringshemlighet | `BANK_DATA_KEY` / dokumenterat alias `ENCRYPTION_KEY`, 32 byte som 64 hextecken | Worker-hemligheten **`BANK_DATA_ENCRYPTION_KEY`**, 32 byte som 43 base64url-tecken utan padding |
| Returadress | `APP_ORIGIN` + `/api/bank/callback` | Hårdkodad full Sites-adress i `lib/banking/service.ts:15` |
| Synkronisering | Manuell och valbart återkommande medan Node-servern körs | Endast manuell; 1 minut mellan lyckade hämtningar, högst 1 000 poster / 25 sidor |

En GitHub-push eller sammanslagen PR uppdaterar inte Siten, dess D1/R2-data eller dess runtime-hemligheter. Sites-implementationen måste ändras, testas och publiceras separat om just den befintliga domänen ska få detta uppdrags nya beteende. Den lokala databasen ska inte ersätta eller importeras över Sites-registret utan en separat migreringsplan.

## Det som finns på Siten

Bankflödet är mer omfattande än en knapp. Det kontrollerar `/application`, AIS, aktivering och registrerad returadress, hämtar svenska företagsbanker och startar `psu_type: business`. Swedbank förväljs när exakt ett alternativ heter Swedbank (`components/bank-connection.tsx:193`). Leverantörsadaptern tillåter bara angivna AIS-adresser/metoder och HTTPS-retur via `auth.enablebanking.com`.

Callbacken binder ett 15 minuter giltigt engångstillstånd till ägare, HttpOnly/Secure-cookie och applikationens generation. Den växlar koden, kontrollerar därefter verklig `AUTHORIZED`-session, bank, företagsanvändning, giltighet och kontonas medlemskap. Session och konton krypteras med AES-GCM och ytterligare autentiserade data som binder innehållet till ägare och ändamål. Saldodata läses under rätt ChatGPT-ägare; mutationer kräver samma origin (`lib/server.ts`, `lib/banking/security.ts`, `service.ts:199`).

Efter callback krävs uttryckligt kontoval och hämtning. Standardperioden är 30 dagar. Stabila kontoidentifierare och `entry_reference` används för dubblettkontroll; sessionens konto-UID och instabilt `transaction_id` används inte som beständig transaktionsidentitet. Sandbox-händelser skrivs inte till det riktiga fakturaregistret. Bankgiro/samlingsposter ger varningar och importeras initialt som ogranskade; fullständiga betalardetaljer behöver fortfarande underlag och granskning.

Oautentiserade HTTP-kontroller mot den publicerade domänen gav:

| Förfrågan | Observerat svar |
| --- | --- |
| `GET /bank` | `200`, HTML |
| `GET /api/bank/status` | `401`, begär ChatGPT-inloggning; `private, no-store` |
| `GET /api/bank/callback` utan parametrar | `303` till `/bank?result=expired`; `private, no-store` |

Callback-endpointen finns alltså och avvisar en ofullständig retur. Dessa kontroller bevisar inte att en verklig bankanslutning, runtime-hemlighet eller registrering är fungerande. De övriga bankrutterna finns i `app/api/bank/`: `config`, `banks`, `connect`, `accounts`, `sync` och `disconnect`.

## Identifierade brister i baslinjen och kvarstående externa krav

1. **Komprometterad PEM spärras inte uttryckligen i version 4.** Koden validerar RSA-format och aktuell leverantörsbehörighet men saknar krav på att tidigare delad nyckel återkallats, kontroll mot komprometterad nyckelidentitet eller administrativ rotationsbekräftelse. `generation` skyddar mot gamla callbackflöden när konfigurationen byts; det är inte bevis för säker nyckelrotation. Återanvänd inte den tidigare delade nyckeln.
2. **Aktiveringsvyn hanterar PEM i frontend.** `components/bank-connection.tsx:255–272` läser nyckelfilen i React-state och skickar den med applikations-ID. `saveConfig` tillåter detta för varje autentiserad ägare, utan separat administratörsroll. Det uppfyller inte uppdragets krav på en vanlig bankvy utan PEM/API-konfiguration och hemligheter enbart i skyddad serverkonfiguration. Flytta aktivering till administrativ serverkonfiguration och förenkla användarvyn innan denna version används som uppdragets färdiga lösning.
3. **Runtime-variablerna skiljer sig.** Siten läser inte `ENABLE_BANKING_APPLICATION_ID`, `ENABLE_BANKING_PRIVATE_KEY`, `ENABLE_BANKING_ENVIRONMENT`, `APP_ORIGIN`, `SESSION_SECRET` eller GitHub-versionens nyckelfilsvariabel för sin nuvarande bankkonfiguration. App-ID och PEM kommer från D1; miljön kommer från leverantörens `/application`. Den enda bankrelaterade runtime-hemlighet som aktuell kod läser är `BANK_DATA_ENCRYPTION_KEY` (`store.ts:22`, `cloudflare-env.d.ts:5`). Dess faktiska närvaro och giltighet har inte verifierats i denna jämförelse. Byt inte lagringsnyckeln utan dekrypterings-/återkrypteringsplan.
4. **Riktig produktionsåtkomst är inte verifierad.** `active`, `environment`, AIS, registrerad callback och Swedbanks företagsstöd kontrolleras i koden när en behörig användare ansluter. Ingen sådan kontroll har körts med verkliga leverantörsuppgifter här. Produktionsavtal, godkännande, kontobehörigheter och BankID-medgivande måste bekräftas av ansvarig användare och Enable Banking. Ett aktivt testkonto är inte bevis för godkänd löpande drift.
5. **Schemaläggning och granskning behöver egen Sites-implementation.** Version 4 har ingen bankcron. Dess Bankgiroflöde och statusmeddelanden måste också bedömas separat mot uppdragets exakta krav; GitHub-förändringarnas spärrar och texter överförs inte genom denna PR.

## Manuella nästa steg

Återkalla den komprometterade leverantörsnyckeln/certifikatet hos Enable Banking och skapa en ny enligt deras officiella process. Ansvarig administratör bekräftar godkänd produktionsapplikation, AIS, korrekt registrerad callback och tillgång till Swedbank Företag. För Siten är callbacken exakt:

```text
https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback
```

Version 5 åtgärdar kodbristerna ovan men kan inte utföra leverantörens aktivering eller användarens bankmedgivande. I Enable Bankings befintliga kontrollpanel visades applikationen **PRODUCTION / Account Information / Inactive** den 27 oktober 2026. Swedbank har alternativet `business` i kontrollpanelens bankval. Inget konto länkades. Registreringens policy-/villkorslänkar är omkastade och behöver rättas.

GitHub-versionen kan driftsättas separat med sin egen registrerade HTTPS-callback och skyddade servermiljö. För den befintliga Siten behöver administratören nu återkalla den komprometterade nyckeln, registrera den nya, ordna leverantörsaktivering och konfigurera de skyddade runtimevärdena. Behörig användare loggar sedan in med rätt ChatGPT-konto, startar bankflödet, godkänner hos banken, väljer företagets SEK-konto och hämtar 30 dagar. Kontrollera en känd inbetalning, en utbetalning, upprepad hämtning utan dubbletter och Bankgirospecifikation före daglig drift.

**Verifierat mot riktig bank i denna jämförelse:** inget. **Swedbank ansluten:** inte verifierat. **Verkliga 30-dagarstransaktioner hämtade:** nej. Ingen lyckad anslutning härleds från sidans utseende eller callbackens existens.
