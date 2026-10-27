# Arkitektur och överlämning

Denna kodbas är en fristående Node.js-installation med en administratör för ett företag. Lokal HTTP-åtkomst är utan lösenord; HTTPS-drift kräver administratörsinloggning. Gränssnitt, API och SQLite körs från samma server. Den har ingen automatisk koppling till ChatGPT Sites-installationens kod, lagring eller publicering. Se [jämförelsen med Siten](SWEDBANK-SITES-COMPARISON.md) för installationsskillnaderna.

## Moduler

| Modul | Ansvar |
| --- | --- |
| `public/` | Responsivt svenskt gränssnitt, navigation, formulär, sökning och granskning. Användardata HTML-escapas. Inga externa CDN:er krävs. |
| `src/server.js` | HTTP API, sessionskontroll, origin-kontroll, validering, originalfiler, OAuth-returer och återkommande hämtning. |
| `src/db.js` | SQLite i WAL-läge, additiva schemamigreringar, fakturasaldon, matchningsförslag, importhistorik och revisionslogg. |
| `src/importers.js` | Bunden CSV/XML-inläsning, riktning, faktiska datum, SEK-kontroll och försiktig hantering av samlade Bankgiroposter. |
| `src/bank.js` | RS256-signerad Enable Banking AIS, medgivande och sidindelad hämtning av bokförda händelser. |
| `src/gmail.js` | Google OAuth med `gmail.readonly`, tokenförnyelse, företagskontokontroll och hämtning av fakturaliknande originalbilagor. |
| `src/security.js` | scrypt-hash för lösenord, slumpade sessioner och AES-256-GCM för integrationshemligheter. |
| `scripts/setup.mjs` | Skapar lokal `.env` med slumpade hemligheter utan att skriva över befintlig konfiguration eller databas. |

## Datamodell och status

`invoices` innehåller riktning, fakturanummer, part, datum, totalbelopp i ören, OCR/referens, moms, Bankgiro, dokumenttyp och avstämningsinformation. Krediter registreras med ett positivt totalbelopp och `kind='credit'`; typen vänder förväntad betalningsriktning och tecknet i öppna sammanställningar. Automatisk kvittning mellan olika fakturor ingår inte.

`bank_transactions` innehåller bankens originaluppgifter, importkälla, dubblettfingeravtryck, granskningsorsak, eventuell samlingsreferens och undantag med motivering. `bank_reference` är bankens beständiga postreferens, `reference` kundens OCR/fakturareferens, `bankgiro` ett uttryckligt Bankgiro-ID och `provider_transaction_id` leverantörens tillfälliga ID för detaljuppslag. Fälten ersätter inte varandra. Originalets betalare och referens kan inte redigeras fritt genom API:t; kompletterande bankunderlag importeras och dokumenterade kompletteringar sparas i revisionshistoriken.

`sessions` lagrar en hash av sessionskakan, giltighet och `principal`. `bank_states` binder ett engångstillstånd till session, ägare, bank och eventuell anslutning som ska förnyas. `bank_connections` har ägare, krypterad banksession och kontolista, valt konto-UID, medgivandets giltighet, status, senaste synkronisering, säkert felmeddelande och en beständig återförsökstid efter anropsbegränsning. Äldre anslutningar utan säker ägarbindning eller kontoval kan inte användas som en ny behörig anslutning; de behöver förnyas.

`allocations` kopplar fakturor till bankhändelser. Allokerade belopp får inte överstiga vare sig fakturans utestående saldo eller bankhändelsens tillgängliga saldo. Riktning och valuta måste stämma, även för återbetalningar av krediter. Undantagna händelser och samlingsposter får inte allokeras. En matchning kräver uttrycklig bekräftelse och skrivs tillsammans med saldokontrollerna i en databastransaktion. En faktura kan få flera delbetalningar och en bankhändelse kan fördelas på flera fakturor.

Fakturans saldo beräknas från allokeringarna. **Betald** kräver att hela beloppet har fördelats; **Delvis betald** att ett positivt delbelopp har fördelats. Utan betalning visas **Ej avstämd** tills användaren uttryckligen bekräftat en kontroll och angett underlaget. Därefter visas **Obetald** eller **Förfallen**. `is_overdue` markerar passerat förfallodatum även om betalningsunderlaget ännu inte är avstämt. Dagens datum beräknas i `Europe/Stockholm`.

Att återta en matchning tar bort allokeringen, återställer fakturans avstämningsmarkering och skapar en revisionshändelse. Beloppet på en redan registrerad faktura ändras inte genom redigerings-API:t; en rättelse hanteras med korrigerings-/kreditunderlag.

`documents` lagrar PDF-/bildoriginal som BLOB med innehållshash, MIME-typ, källa, käll-ID och koppling till faktura. `import_jobs` sparar antal hittade, importerade, överhoppade och granskningskrävande poster samt bankfilens original. `audit_events` bevarar viktiga åtgärder. Inställningar och krypterade anslutningar ligger i separata tabeller. Migreringar lägger till saknade kolumner utan att ersätta befintliga register.

## Import och matchning

Bankfiler är begränsade till 15 MB och 1 000 händelser. CSV stödjer datum/belopp eller separata debet-/kreditkolumner. Båda sidor med belopp, saknade obligatoriska fält och ogiltiga kalenderdatum stoppas. SEK krävs; andra valutor etiketteras aldrig om.

XML-läsaren hanterar elementstruktur, namnrymdsprefix och vanliga entiteter med begränsat djup och antal noder. DTD och externa entiteter tillåts inte. Den är inte en fullständig XML-/ISO 20022-XSD-validerare. Olika banker och camt-versioner måste verifieras med verkliga, anonymiserade filer.

Samlade bankposter delas bara upp när individuella belopp och totalbelopp stämmer. En ofullständig specifikation behåller totalen en gång med granskningskravet **Betalardetaljer saknas – importera betalningsspecifikation.** En komplett specifikation kan ersätta en tidigare samlingspost när konto, datum, valuta, bankreferens och summa kan kopplas ihop. Flera detaljer kopplas till samlingspostens referens och ersätter totalen först när summan stämmer.

En sparad XML-specifikation med exakt en individuell betalning kan komplettera en befintlig samlingspost med samma beständiga referens på plats. Konto, bokföringsdatum, signerat belopp och valuta måste stämma och både individuell betalare och referens finnas. Transaktions-ID, ursprunglig importhistorik och leverantörsmetadata bevaras; den nya originalfilen kopplas till posten och före/efter-data revisionsloggas. Beloppet finns kvar en gång och fakturan kräver fortfarande manuell matchning. Ofullständiga uppgifter, vanliga API-uppdateringar, manuella undantag, befintliga allokeringar och motstridiga tidigare delbetalningar kan inte öppna samlingsposten för matchning.

Vid filimport kan användaren välja ett sparat maskerat bankkonto. Backend kontrollerar anslutningens ägare och kontoval och använder samma beständiga kontoidentitet som API-hämtningen. Vid saknade referenser eller manuella kontoalias kan systemet inte garantera koppling mellan fil och API; samma belopp ensamt används aldrig för att slå ihop betalningar.

Dubblettkontrollen använder i första hand beständigt konto, bankens stabila transaktionsreferens och betalningsriktning, så att en ändrad beskrivning vid nästa hämtning inte skapar en ny post. Enable Bankings `entry_reference` är den stabila transaktionsreferensen. `transaction_id` kan ändras mellan hämtningar och används endast som separat metadata. Kontoidentiteten kommer från kontonummer, eller bankens beständiga identifikationshash när kontonummer saknas; medgivandets konto-UID används endast för leverantörsanrop. När stabilt transaktions-ID saknas används konto, datum, belopp, valuta, referens, part och text. Två verkligt separata, identiska händelser utan bank-ID kan inte skiljas säkert; användaren behöver kontrollera sådana underlag. Historiska importer med tidigare instabila ID:n kan behöva en kontrollerad manuell migrering; de slås inte ihop enbart utifrån belopp.

Matchningsförslag kräver rätt riktning och valuta samt exakt OCR/fakturareferens eller samma betalare tillsammans med samma belopp. Transaktioner före fakturadatum föreslås inte. Förslaget ändrar ingen betalningsstatus. Användaren väljer faktura, belopp och bekräftar efter granskning.

## Gmail och bankanslutningar

OAuth-status är tidsbegränsad, kopplad till webbläsarsessionen och förbrukas en gång. Bankflödet binder dessutom tillståndet till behörig `principal` och anslutningens ägare, med atomisk engångsförbrukning. Avbrutet godkännande, upprepade parametrar, fel användare, utgången session och återspelning avvisas. En långsam bankåtgärd får inte spara en anslutning eller nya bankhändelser efter att den inloggade sessionen har avslutats. Google-kontot jämförs med `GMAIL_ACCOUNT` efter godkännande. Bank- och Gmail-hemligheter krypteras med AES-256-GCM på servern; API:t returnerar inte privata nycklar eller token. Frånkoppling återkallar först medgivandet hos leverantören; ett misslyckande visas och den lokala anslutningen behålls för nytt försök.

Gmail hämtar möjliga fakturabilagor från inkorgen och skickade mejl, med dubblett-ID per konto, meddelande och bilagedel. Tydliga påminnelser och order-/betalningsbekräftelser hoppas över. Bilagor sparas som **Behöver granskning**; de blir inte automatiskt bokförda skulder. Filernas signaturer kontrolleras. Ingen automatisk OCR eller fullständig PDF-fälttolkning finns i denna version. Sökningen är heuristisk och kan missa exempelvis arkiverade mejl eller otydliga ämnesrader. Se [Gmail-guiden](GMAIL.md).

Bankkopplingen använder enbart AIS för kontoinformation. Systemet initierar inga bankbetalningar. Både bank och Gmail kräver riktiga klientuppgifter, godkända returadresser och medgivanden. Mockade tester verifierar inte ett riktigt BankID-/Google-flöde eller leverantörens stöd för just företagets konto.

Enable Banking konfigureras på servern med `ENABLE_BANKING_APPLICATION_ID`, explicit `ENABLE_BANKING_ENVIRONMENT=SANDBOX|PRODUCTION` och en av `ENABLE_BANKING_PRIVATE_KEY` eller `ENABLE_BANKING_PRIVATE_KEY_FILE`. Filen måste ligga utanför repositoryt. De äldre namnen `ENABLEBANKING_APP_ID`, `ENABLEBANKING_PRIVATE_KEY_FILE` och `ENABLEBANKING_ENVIRONMENT` stöds som alias; motstridiga värden stoppas. `SESSION_SECRET` kräver 64 hextecken. Krypteringsnyckeln är `BANK_DATA_KEY` eller aliaset `ENCRYPTION_KEY`, 32 byte som 64 hextecken; båda måste vara lika om båda anges. Se [konfigurationsexemplet](../.env.example).

En tidigare delad leverantörsnyckel ska betraktas som komprometterad och får inte användas. Produktion spärras före leverantörsanrop tills en ny produktionsnyckel har registrerats, den gamla återkallats och administratören satt `ENABLE_BANKING_KEY_ROTATED=true`. Flaggan är administratörens bekräftelse, inte bevis från leverantören. Produktion kräver HTTPS. Båda miljöerna använder `https://api.enablebanking.com`; registrerad miljö kontrolleras via `/application`, inte genom val av en alternativ API-värd.

Vid **Koppla banken** kontrollerar backend verkligt applikations-ID, registrerad miljö, `active`, AIS, Sverige och exakt `APP_ORIGIN` följt av `/api/bank/callback` i leverantörens returadresser. Därefter väljs Swedbanks företagsanslutning ur den aktuella banklistan och ett medgivande med `psu_type: business` skapas. Den returnerade inloggningsadressen måste tillhöra `https://auth.enablebanking.com`. Ingen lokal inställning ersätter Enable Bankings godkännande eller bankens medgivande.

Callbacken växlar engångskoden och verifierar bankens session, bankidentitet, företagsanvändning, giltighet och konton innan den sparar `pending_account`. Kontolistan är krypterad och visas maskerad. **Ansluten** sätts först efter användarens uttryckliga kontoval och ny kontroll av kontots medlemskap i en `AUTHORIZED`-session. Kontovalet startar en initial hämtning av idag och de föregående 29 kalenderdagarna. Om hämtningen misslyckas bevaras det giltiga kontovalet och felet visas; anslutning och genomförd transaktionshämtning är olika resultat.

Hämtning kontrollerar medgivandet före varje körning, begär `BOOK`, granskar svarets status och sparar inga ej bokförda poster. Alla sidor samlas före databasimport; en upprepad markör eller överskriden gräns ger ingen ofullständig import. Adaptern begränsar ett försök till 15 sidor och 5 000 mottagna poster och ett datumintervall på högst 91 dagar. Anropsbegränsning ger HTTP 429 med `Retry-After`; en återförsökstid sparas på anslutningen så att upprepade knapptryckningar och serveromstart inte kringgår väntetiden. Utgångna/återkallade medgivanden kräver ny säker anslutning. Vid förnyelse återkallas den föregående leverantörssessionen innan den nya ersätter den lokalt.

## Återkommande hämtning

`sync_interval_minutes` kan vara `0`, `15`, `30`, `60`, `240` eller `1440`. `0` stänger av automatisk hämtning. Node-servern kontrollerar förfallna jobb en gång per minut och hämtar från anslutningar med säker ägare och valt konto. Samtidig synkronisering, kontoval, förnyelse och frånkoppling låses per anslutning i processen. Fel återförsöks tidigast enligt valt intervall och bankens sparade återförsökstid, och status för senaste körning kan läsas i inställningarna.

Jobben finns i den körande Node-processen. De körs inte medan servern är avstängd. Gmail har sidmarkör och checkpoint för begränsade batcher; bankhämtning överlappar datum för att fånga upp senare bokföring, med dubblettkontroll. Tidsintervall begränsas till leverantörsadapterns gränser. Det finns ingen separat distribuerad jobbkö, flerprocesslåsning eller driftövervakning.

Inställningar för aviseringar gäller det lokala gränssnittet. Ingen e-post-/pushleverans eller automatisk betalningspåminnelse skickas. Utkast ska kontrolleras av användaren.

## Åtkomst, filer och återställning

API:t öppnas direkt lokalt under `local-admin`. Servern lyssnar på `127.0.0.1` och kontrollerar Host för att stoppa DNS-rebinding. Med HTTPS-origin kräver uppstart `MG_ADMIN_PASSWORD` med minst 16 tecken, och privata API-rutter kräver inloggad `administrator`. `POST /api/login` roterar sessionskakan efter korrekt lösenord; upprepade fel begränsas. `POST /api/logout` återkallar sessionen. Servern ska stå bakom en korrekt konfigurerad HTTPS-proxy som vidarebefordrar rätt värd.

En anonym webbläsarsession ger ingen behörighet i HTTPS-drift. API:t kontrollerar den tillåtna rollen innan registerdata läses; bankanslutningar kontrolleras dessutom mot sin lagrade ägare, även vid kontoval, import, synkronisering, förnyelse och frånkoppling. HttpOnly-/SameSite-kakor binder bank-/Google-returer till rätt webbläsare; HTTPS-kakor har även `Secure`. Skrivningar kräver samma origin och JSON. CSP, `no-store`, begränsad referer och HSTS vid HTTPS skyddar svaren. Dokument och importerade bankoriginal serveras som bilagor med begränsande filpolicy. Filuppladdning tillåter PDF, PNG, JPEG och WebP med verifierad signatur, högst 15 MB. Innehåll behandlas som data och körs inte som instruktioner.

SQLite-filen innehåller kunduppgifter och original. De är inte separat krypterade på disk; kryptering av OAuth-/bankhemligheter ersätter inte skydd av lagringsplatsen. Installationen har ett gemensamt företagsregister med en administratör. Ägarkontrollerna gör den inte till ett system med flera företag, personliga användarkonton eller gemensamma företagsroller.

`GET /api/export` exporterar register, historik och dokumentmetadata, men inte original-BLOB:ar, token eller nycklar. Den exporten räcker inte för fullständig återställning. En konsekvent filbackup kan tas genom att stoppa servern och kopiera databasen tillsammans med den privata konfigurationen och integrationsnycklarna till skyddad lagring. Återställ samma `BANK_DATA_KEY` för att kunna läsa anslutningarna. Automatisk backup, retention, återställningsprocedurer och extern driftövervakning behöver hanteras i driftmiljön.

## API-endpoints

| Område | Endpoints |
| --- | --- |
| Session | `GET /api/health`, `GET /api/me`, `POST /api/login` (HTTPS), `POST /api/logout` |
| Översikt/inställningar | `GET /api/dashboard`, `GET/PATCH /api/settings` |
| Fakturor | `GET/POST/PATCH /api/invoices`, `GET /api/invoices/:id` |
| Bankhändelser | `GET/POST/PATCH /api/bank-transactions`, `GET /api/suggestions` |
| Matchningar | `GET/POST/DELETE /api/allocations` |
| Bankimport | `POST /api/import/preview`, `POST /api/import/commit`, `GET /api/imports`, `GET /api/imports/:id/original` |
| Dokument | `GET/POST /api/documents`, `GET /api/documents/:id` |
| Bankanslutning | `GET /api/bank/status`, `POST /api/bank/connect` (även förnyelse), `GET /api/bank/callback`, `POST /api/bank/accounts`, `POST /api/bank/sync`, `DELETE /api/bank/connections` |
| Gmail | `GET /api/gmail/status`, `POST /api/gmail/connect`, `GET /api/gmail/callback`, `POST /api/gmail/sync`, `DELETE /api/gmail/connection` |
| Historik/export | `GET /api/audit`, `GET /api/export` |

## Verifiering

`npm run check` syntaxkontrollerar JavaScript-koden. `npm test` kör isolerade tester med tillfälliga databaser och kontrollerade externa svar. Verifiera dessutom med anonymiserade verkliga bankfiler och behöriga externa konton innan systemet används för företagets ordinarie avstämning. Automatiska tester ersätter inte kontroll av driftmiljön, säkerhetskopiorna eller de verkliga medgivandena.
