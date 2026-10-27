# Verifierad produktionsstatus, 27 oktober 2026

## Genomfört

- Ny Enable Banking-applikation `9650951b-9a61-43be-afc0-9982e5500912`, PRODUCTION/AIS, registrerad och aktiv. Kontrollpanelen visar begränsad åtkomst till två länkade egna Swedbank-konton. Detta är inte ett beviljat avtal om obegränsad löpande företagsdrift.
- Den gamla applikationen `c8ada025-c3c6-49e2-bddf-5289e5791157` togs permanent bort efter användarens uttryckliga bekräftelse. Kontrollpanelen visar därefter endast den nya applikationen. Den gamla PEM-filen användes inte.
- Den nya matchande privata nyckeln installerad som skyddad Sites-hemlighet, korrekt registrerad callback och dokumentlänkar. Befintlig `BANK_DATA_ENCRYPTION_KEY` bevarad. Rotationsbekräftelsen aktiverades först efter verifierad borttagning av den gamla registreringen.
- Sites runtime-revision 3 publicerad med **version 10**, commit `c02f18e043abd9868dc46b828d6bb5b51e64d642`, deployment `appgdep_6ae0fa5f324c81919b7f6a66d7c82c19`, resultat `succeeded`.
- Riktiga signerade API-anrop bekräftade aktiv produktionsapplikation, AIS, Sverige, rätt callback och Swedbank med `business`.
- Hemsidans autentiserade anslutningsflöde slutfördes efter användarens personliga Swedbank-signering. Bankvyn visar **Ansluten**, ett valt företagskonto i SEK och framtida giltighet för medgivandet. Verkliga bokförda bankhändelser visas i den privata arbetsytan.

## Produktionsfel som rättades

Cloudflare Workers avvisade `redirect: 'error'` före nätverksanropet. Sites-adaptern använder nu `manual` och avvisar alla HTTP 3xx innan svarskroppen läses. Bankuppgifter och koder skickas därmed aldrig vidare till en omdirigerad adress. Tekniska transportfel kan diagnostiseras med maskerade URL:er och behörighetsuppgifter.

Enable Bankings riktiga Swedbank-svar använder `https://tilisy.enablebanking.com/ais/start`; API-exemplet anger `https://auth.enablebanking.com/ais/start`. Båda exakta HTTPS-originerna och endast AIS-startsökvägen godtas nu i server och klient. Annan domän, port, användaruppgifter, fragment eller betalningssökväg avvisas. Motsvarande domänkontroll rättades i Node-versionen.

[Sites-patchen version 6→10](sites/swedbank-worker-compatibility.patch) kompletterar de två tidigare patcharna. 87 Sites-tester och 117 Node-tester går igenom, totalt **204**. TypeScript, produktionsbygge och Node-klientens syntaxkontroll godkända. Testerna omfattar även verklig klientnavigeringskontroll och omdirigeringssvar utan vidarebefordran av behörighetsuppgifter.

## Verifierat efter bankens retur

**Swedbank är ansluten och verkliga bankhändelser är importerade.** Den separata signeringen för hemsidans AIS-session är slutförd. Bankvyn visar ansluten status, valt maskerat företagskonto, giltighet och lyckad hämtning. Bankhändelsevyn visar importerade inbetalningar och utbetalningar. Inga kontonummer, transaktionsreferenser, belopp eller betalare återges i denna rapport.

En ytterligare uppdatering genomfördes från hemsidan. Den slutfördes med noll nya bankhändelser, och de tidigare importerade raderna finns kvar. Det verifierar dubblettskyddet för denna faktiska hämtning. Ingen faktura har automatiskt markerats betald. Bankgiro och ofullständiga betalardetaljer kräver fortfarande betalningsunderlag och granskning.

För fortsatt användning finns **Uppdatera bankhändelser** på bankanslutningssidan. Hämtning i Sites sker manuellt. Personlig förnyelse krävs när medgivandet går ut. Denna verifiering ersätter inte avstämning mot företagets originalunderlag eller leverantörens avtalsgodkännande.

Källor: [Enable Banking API](https://enablebanking.com/docs/api/reference/), [aktivering av egna konton](https://enablebanking.com/docs/api/linked-accounts/). Begränsad kontoaktivering ersätter inte leverantörens avtals- och driftgodkännande.
