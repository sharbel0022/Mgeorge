# Swedbank: säker aktivering och verifiering

## Produktionsläget den 27 oktober 2026

Den befintliga applikationen **MG Fakturakoll** visades i Enable Bankings inloggade kontrollpanel som **Inactive**, miljö **PRODUCTION**, tjänst **Account Information**. Den registrerade returadressen motsvarar Sites-adressen nedan. Under Sverige → Swedbank finns användningstyperna `business` och `personal`. Inget konto länkades och inget BankID- eller leverantörs-API-anrop med privata nycklar genomfördes. Att företagsvalet finns bevisar inte behörighet till M.Georges konto.

Registreringen har två omkastade länkar: Privacy policy URL pekar på `/anvandarvillkor` och Terms of service URL på `/integritetspolicy`. Rätta dessa i kontrollpanelen till respektive korrekta dokument. Dokumenten är utkast och behöver granskas för den verkliga verksamheten.

Den tidigare delade privata PEM-nyckeln är komprometterad. Återkalla certifikatet/applikationen enligt Enable Bankings process och registrera en ny privat nyckel och ett nytt publikt certifikat. Skicka inte PEM i chatt, GitHub, webbläsarformulär eller e-post. Endast det publika certifikatet får lämnas till leverantörens registrering.

## Konfiguration i Node-versionen

| Variabel | Format och funktion |
| --- | --- |
| `APP_ORIGIN` | Exakt origin utan sökväg eller avslutande snedstreck. HTTPS krävs i produktion. |
| `SESSION_SECRET` | 64 slumpade hextecken; behåll skyddad på servern. |
| `BANK_DATA_KEY` / `ENCRYPTION_KEY` | Samma 32-byte AES-nyckel, 64 hextecken. Om båda sätts måste de vara lika. Byt aldrig en befintlig lagringsnyckel utan migrering. |
| `MG_ADMIN_PASSWORD` | Minst 16 tecken för HTTPS. En administratör för företagets arbetsyta. Lokal HTTP kräver inget applösenord. |
| `ENABLE_BANKING_APPLICATION_ID` | Applikations-ID som motsvarar det nya certifikatet. Äldre alias `ENABLEBANKING_APP_ID` stöds. |
| `ENABLE_BANKING_ENVIRONMENT` | Uttryckligen `SANDBOX` eller `PRODUCTION`. Äldre `ENABLEBANKING_ENVIRONMENT` stöds. |
| `ENABLE_BANKING_PRIVATE_KEY_FILE` | RSA PEM-fil utanför repositoryt. Äldre `ENABLEBANKING_PRIVATE_KEY_FILE` stöds. |
| `ENABLE_BANKING_PRIVATE_KEY` | Alternativ till fil: skyddad servermiljövariabel med RSA PEM. Blanda inte nyckelkällor. |
| `ENABLE_BANKING_KEY_ROTATED` | Sätt `true` för produktion **först efter** verklig återkallning och ny registrering. En flagga roterar inte leverantörsnyckeln. |

RSA kräver minst 2048 bitar; följ leverantörens aktuella rekommendation vid nyregistrering. Inga nycklar, JWT, medgivandekoder eller banksessioner returneras till gränssnittet eller skrivs i serverloggar. Servern lyssnar på loopback även vid HTTPS; en betrodd reverse proxy behöver terminera TLS och vidarebefordra rätt Host. Säkra cookies, origin- och behörighetskontroll är obligatoriska i den publika installationen.

## Kontrollerat bankflöde

1. **Koppla banken** kontrollerar lokal konfiguration utan externa anrop om den är ofullständig. I produktion stoppas även läsanrop tills rotationsbekräftelsen finns.
2. `GET /application` måste bekräfta rätt applikations-ID, miljö, `active=true`, AIS, Sverige och exakt callback. Registrerat företagsstöd kontrolleras via `/aspsps`.
3. `POST /auth` begär endast kontoinformation/transaktioner, `psu_type=business`, med bankens tillåtna giltighetstid. Betalningsinitiering är spärrad i adaptern.
4. Callback kräver en slumpad, 15 minuter giltig, oanvänd state kopplad till den inloggade webbläsarsessionen. Den förbrukas atomiskt. Avbruten/felaktig retur skapar ingen anslutning. Endast `https://auth.enablebanking.com` godtas som autentiseringsadress.
5. Bankens kod växlas mot en verklig session. Företagsmedgivande, rätt bank, framtida giltighet och användbara SEK-konton kontrolleras. Sparade sessioner och konton krypteras med AES-256-GCM. Status är `pending_account` tills användaren valt konto.
6. `POST /api/bank/accounts` verifierar sessionens faktiska `AUTHORIZED`-status och kontomedlemskap och väljer ett konto. De senaste **30 kalenderdagarna inklusive idag** hämtas. Kontoval och hämtning har gemensamt lås så att samtidig förnyelse/frånkoppling inte kan ge falsk synkstatus. Importfel visas separat.
7. Manuell/schemalagd hämtning använder valt konto och endast `BOOK`-poster. Alla sidor måste vara kompletta innan något sparas. Max 15 sidor och 5 000 poster per API-hämtning; begränsa datumintervallet vid större mängder. API:t accepterar högst 91 dagars intervall. `429` sparar återförsökstid; utgånget/återkallat medgivande kräver förnyelse.
8. Förnyelse återkallar tidigare medgivande innan den nya krypterade sessionen ersätter det. Frånkoppling rapporteras först efter leverantörens återkallning eller bekräftelse att sessionen redan saknas. Manuellt godkännande krävs alltid för fakturamatchning.

Schemalagd hämtning är valbar i inställningarna och kräver en körande Node-process. Jobbet använder överlappande datum och dubblettkontroll; bankens åtkomstgränser och medgivande gäller även automatiska jobb. Denna version har ingen distribuerad jobbkö eller flerprocesslåsning och ska köras som en process per databas.

## Dubbletter, Bankgiro och äldre data

Kontots kanoniska IBAN/andra beständiga kontonummer används som identitet. Om kontonummer saknas används bankens `identification_hash`. En sessions `uid` används aldrig som beständig kontoidentitet. Bankens `entry_reference`, konto och riktning används för primär dubblettkontroll. Det föränderliga `transaction_id` sparas separat för spårning. Utan beständig bankreferens används dokumenterat fingeravtryck av konto, datum, belopp, valuta, OCR, part och text. Två separata identiska betalningar utan bank-ID kan inte säkert skiljas åt.

Bankreferens, företagets Bankgiro, kundens OCR, namn och individuellt belopp hålls åtskilda. En samlad Bankgiroinsättning kan inte betala en faktura. Importera camt.054 och välj samma sparade, maskerade bankkonto i importdialogen. En komplett specifikation ersätter samlingsposten eller kompletterar en ensam betalning med samma konto, bankreferens, datum, valuta och kontrollerad summa. Original och före/efter-historik bevaras. Om referens/kontoidentitet saknas krävs manuell granskning; beloppslikhet ensam är aldrig bevis.

Äldre anslutningar utan verifierad ägare/kontoval används inte automatiskt. Förnya med en roterad leverantörsnyckel och återkalla gamla medgivanden hos banken/Enable Banking. Historiska API-importer kan ha använt ett instabilt transaktions-ID. De går inte säkert att migrera utifrån belopp. Säkerhetskopiera, jämför originalreferenser och gör en kontrollerad migrering innan samma historik hämtas på nytt. Byt inte `BANK_DATA_KEY` för att åtgärda leverantörsnyckeln: de är olika nycklar.

## ChatGPT Sites och manuellt driftsättningsprov

Sites använder separat Worker-kod, D1/R2 och ChatGPT-inloggning. Dess lagringshemlighet heter `BANK_DATA_ENCRYPTION_KEY` och är 32 byte som 43 base64url-tecken utan padding. Den ska bevaras. Se [jämförelsen och publiceringsresultatet](SWEDBANK-SITES-COMPARISON.md). En GitHub-push publicerar inte Siten.

Sites-callbacken måste registreras exakt:

```text
https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback
```

Efter nyckelrotation behöver ansvarig administratör ordna aktivering/avtal med Enable Banking, rätta dokumentlänkarna, lägga den nya nyckeln i driftmålets skyddade runtime-konfiguration och välja `PRODUCTION`. Kontrollera att företagskontot får användas för applikationen. Behörig firmatecknare/användare genomför sedan själv identifiering och bankmedgivande, väljer företagskonto och hämtar 30 dagar. Verifiera en känd inbetalning och utbetalning, upprepa hämtningen utan nya dubbletter och granska en Bankgirospecifikation mot originalfakturor.

## Testgräns och officiell källa

Automatiska tester använder genererade testnycklar och mockade API-svar. De provar applikationskontroll, felaktiga nycklar, state/återspelning, avbrutna/felaktiga medgivanden, konton, 30 dagar/paginering, dubbletter, granskning, riktning, delbetalningar, API-gränser och behörighetskontroll. Detta är **inte ett genomfört Enable Banking-sandboxmedgivande** och inte bevis för verklig produktion.

Officiell API-specifikation kontrollerad 2026-10-27: [Enable Banking API reference](https://enablebanking.com/docs/api/reference/). Den anger miljöseparering, RSA/JWT, `/application`, AIS-medgivanden, beständiga kontohashar och transaktionsreferenser. Produktionsregistrering kräver aktivering enligt leverantörens dokumenterade process; godkännande kan inte kringgås i appen.
