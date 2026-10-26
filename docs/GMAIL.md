# Aktivera Gmail

Gmail-kopplingen använder Googles OAuth-flöde med enbart `gmail.readonly`. Inga Gmail-lösenord sparas. Systemet kan läsa mejl och originalbilagor men saknar funktioner för att skicka, radera eller ändra mejl.

## Engångsaktivering av administratör

1. Välj företagets Google Cloud-projekt och aktivera **Gmail API**.
2. Konfigurera OAuth-medgivandet. Under utveckling lägger du till `mg.vitvaror@gmail.com` som testanvändare. Kontrollera Googles aktuella verifieringskrav för produktionsanvändning av Gmail-behörigheten.
3. Skapa en OAuth-klient av typen **Web application**. Registrera exakt serverns `APP_ORIGIN` följt av `/api/gmail/callback`, till exempel `http://localhost:3000/api/gmail/callback` lokalt eller `https://din-domän.se/api/gmail/callback` i drift.
4. Lägg klient-ID och klienthemlighet i serverns miljövariabler `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET`. `.env` är ignorerad av Git och får aldrig publiceras.
5. Ange `GMAIL_ACCOUNT=mg.vitvaror@gmail.com` och starta om servern. Kontot kontrolleras mot Googles Gmail-profil efter medgivandet; ett annat Google-konto godtas inte.
6. Öppna **Import → Koppla Gmail**. Välj företagskontot och godkänn läsåtkomst. Servern lagrar OAuth-uppgifter krypterade med `BANK_DATA_KEY`; den nyckeln måste bevaras säkert även vid återställning.

## Vad hämtningen gör

Hämtningen söker efter möjliga fakturor med bilagor i inkorgen och skickade mejl. PDF, PNG, JPEG och WebP stöds. Filernas signaturer kontrolleras. Ett nedladdningsnamn får rätt filändelse för det bekräftade formatet; det ursprungliga namnet bevaras som metadata. En fil får vara högst 15 MB och en hämtning omfattar högst 50 MB bilagor. Ett begränsat antal mejl hämtas åt gången; när fler finns behålls sidmarkören till nästa hämtning. Redan hämtade bilagor identifieras med konto, mejl-ID och bilagedel och läggs inte in en gång till. Efter en tidigare hämtning används UTC-tidsgräns med en dags överlapp för att undvika luckor runt dygnsskiften; överlapp ger inga nya dubbletter.

Mejl med tydlig påminnelse, orderbekräftelse eller betalningsbekräftelse i ämnesraden hoppas över. En bilaga behandlas alltid som **underlag som behöver granskas**. Avsändare och riktning är förslag för att underlätta registreringen. Även ett fakturaliknande mejl kan vara felklassificerat; användaren granskar därför originalet och registrerar fakturans uppgifter innan en skuld skapas. Kreditfakturor och motsägelsefulla uppgifter måste bedömas manuellt.

Denna version gör ingen automatisk OCR eller fullständig PDF-tolkning. Den hittar och bevarar underlag men hittar inte säkert alla fakturor: exempelvis arkiverade mejl utan inkorgsetikett, andra filtyper, andra språk eller otydliga ämnen kan missas. Ladda upp sådana original manuellt. Fakturor får aldrig antas vara betalda utifrån text i ett mejl.

Högst 150 nya bilagedelar kontrolleras i en hämtning, även när de är felaktiga. Bekräftat ogiltiga eller för stora original identifieras och felorsaken sparas, så att samma felaktiga bilaga inte hämtas om vid varje försök. Nästa hämtning kan då fortsätta framåt. Ett tillfälligt anslutningsfel gör däremot aldrig en bilaga permanent undantagen. Varje API-begäran har 20 sekunders tidsgräns och inga automatiska nätverksomförsök görs inne i en hämtning.

## Förnya eller koppla från

Om Google återkallar ett medgivande eller en refresh-token upphör att gälla visas att kopplingen behöver förnyas. **Koppla Gmail igen** startar ett nytt medgivande. **Koppla från** återkallar åtkomsten hos Google och tar bort den lokala kopplingen. Tidigare registrerade original och fakturor bevaras i systemet.

Hämtningens adapter stöder återkommande körning med serverlagrade refresh-token. Schemaläggning och serverns drift måste vara aktiva för att nya mejl ska hämtas när ingen användare har sidan öppen; en öppen webbläsare är inte en driftlösning.

## Verifiering

`node --test test/gmail.test.js` verifierar OAuth-parametrar, kontokontroll, tokenförnyelse, riktning, dubblettskydd, originalbilagor, filgränser, påminnelser och återkallande med kontrollerade API-svar. Riktigt Google-medgivande och ett fullständigt flöde med företagets fakturor kräver de ovanstående externa inställningarna och är inte verifierade av dessa tester.

Tekniska källor: [Googles OAuth-flöde för webbservrar](https://developers.google.com/identity/protocols/oauth2/web-server), [lista Gmail-mejl](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [hämta originalbilagor](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get), [kontrollera Gmail-profil](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).
