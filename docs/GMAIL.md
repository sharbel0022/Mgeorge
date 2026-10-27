# Gmail: anslutning och drift

## Aktivering

1. Aktivera Gmail API i företagets Google Cloud-projekt.
2. Konfigurera Google Auth Platform: branding, supportkontakt, domäner, integritetspolicy, användarvillkor och målgrupp. För ett vanligt Gmail-konto används extern målgrupp; lägg till `mg.vitvaror@gmail.com` som testanvändare under test.
3. Skapa en OAuth-klient av typen Web application. Begär bara `https://www.googleapis.com/auth/gmail.readonly`.
4. Registrera exakt callback för respektive installation:
   - Node: `APP_ORIGIN` följt av `/api/gmail/callback`.
   - Sites: `https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/gmail/callback`.
5. Sätt `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` och vid behov `GMAIL_ACCOUNT=mg.vitvaror@gmail.com` i respektive miljös skyddade konfiguration. Node använder ignorerad `.env`; Sites använder Sites runtime secrets. GitHub-push överför inga sådana uppgifter.
6. Bevara befintlig krypteringsnyckel: Node `BANK_DATA_KEY`; Sites `BANK_DATA_ENCRYPTION_KEY`. De har olika format och är inte utbytbara. Rotera eller ersätt inte fungerande banknycklar för att aktivera Gmail.
7. Öppna Import eller Gmail-sidan och välj Koppla Gmail. Kontot verifieras mot Gmail-profilen. Endast företagskontot accepteras. Kontrollera sedan en känd faktura hela vägen till original, registrering och bankförslag.

Gmails läsbehörighet är en restricted scope. Kontrollera tillämplig verifiering och eventuell säkerhetsgranskning i Google Cloud innan extern produktionsanvändning. En extern OAuth-app med status Testing får normalt refresh tokens som löper ut efter sju dagar. Testanvändare och ett lyckat testmedgivande ersätter inte produktionsgodkännande. Källor: [Google scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [tokenlivslängd](https://developers.google.com/identity/protocols/oauth2).

## Hämtning och säkerhet

State är slumpmässigt, engångsanvänt och bundet till den inloggade webbläsaren. Callback med dubbla parametrar nekas. Token krypteras på servern; hemligheter visas aldrig i gränssnittet. Refresh sker före utgång eller en gång vid oväntat 401-svar. Rotationen bevaras även om ett senare Gmail-anrop misslyckas. Frånkoppling återkallar Google-åtkomsten först och behåller redan importerade original.

Sökningen omfattar mottagna, arkiverade och skickade mejl med bilagor; ämne och filnamn behöver inte innehålla ordet faktura. Spam, papperskorg, utkast och tydliga påminnelser/order-/betalningsbekräftelser undantas. Detta är kandidatupptäckt, inte ett bevis på en skuld. Enskilda fakturor som bara finns i mejltext eller ligger bakom nedladdningslänkar importeras inte. Flera bilagor blir separata underlag. Vidarebefordrade mejl kräver kontroll av riktning och motpart.

Filformat kontrolleras mot bytesignaturen. Högst 15 MB per fil, 50 MB per körning, 150 bilagedelar och 20 sekunder per API-anrop. Efter två minuters arbete sparas fortsatt paginering vid nästa kontrollpunkt. Node läser högst 50 mejl per omgång; Sites läser 10. Sidmarkörer och en dags datumöverlapp gör omkörning säker. Käll-ID, Message ID, attachment-ID, avsändare, mottagare, originalfilnamn, datum och SHA-256 bevaras. Återsändning med samma innehåll kompletterar originalets källhistorik. Trasiga oföränderliga bilagedelar undantas utan att tillfälliga nätverksfel räknas som permanent avvisade.

## Schemaläggning

Node har serverbaserad Gmail-hämtning var 15 minut efter anslutning, oberoende av bankens intervall. Ändra till manuellt, 15/30/60/240/1440 minuter i Inställningar. Håll Node-processen igång via driftens processhanterare. Ingen öppen webbläsare behövs. Senaste lyckade hämtning och nästa möjliga hämtning visas i Gmail-inställningarna.

Sites har separat drift. `gmail_auto_sync` är en autentiserad MCP-operation med ägarisolering, beständig låsning och 15 minuters spärr. Den är förberedd för en Sites-länkad molnautomation. Ingen ny Gmail-automation har aktiverats i denna leverans eftersom Google-konfiguration och ett verkligt medgivande saknas. Verifiera först hämtning via det anslutna Sites-verktyget från en ny molnkörning; anslut därefter ett återkommande Sites-schema. Produktionsschemat ska endast meddela vid meningsfull ändring, fel eller behov av användaråtgärd. Befintligt bankschema påverkas inte.

Sites tolkar dokument lokalt i webbläsaren vid granskning. Serverbaserad obevakad OCR och automatisk fakturaregistrering ingår i Node-versionen, men är inte implementerade i Sites Worker. Detta är en kvarstående skillnad, inte en verifierad automatisk produktionskedja.

## Tester

`npm run check` och `npm test` verifierar Node-koden. Google-svar är simulerade. PDF- och OCR-testerna läser riktiga syntetiska filer med de installerade motorerna. HTTPS-tester verifierar inloggning, state, fel konto, kryptering, arkiverad Gmail-import, återkommande hämtning och spårbara korrigeringar. Sites har en separat TypeScript-kontroll och testsvit med lokal SQLite som D1-adapter. Verkligt Google-medgivande kräver användarens konto och återstår att verifiera.
