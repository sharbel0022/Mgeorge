# Arkitektur och överlämning

Denna kodbas är en fristående Node.js-installation för ett företag utan lösenordsinloggning. Gränssnitt, API och SQLite körs från samma server. Den har ingen automatisk koppling till den tidigare ChatGPT Sites-installationens kod, lagring eller publicering.

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

`bank_transactions` innehåller bankens originaluppgifter, importkälla, dubblettfingeravtryck, granskningsorsak, eventuell samlingsreferens och undantag med motivering. Originalets betalare och referens skrivs inte över genom API:t; kompletterande bankunderlag importeras i stället.

`allocations` kopplar fakturor till bankhändelser. Allokerade belopp får inte överstiga vare sig fakturans utestående saldo eller bankhändelsens tillgängliga saldo. Riktning och valuta måste stämma, även för återbetalningar av krediter. Undantagna händelser och samlingsposter får inte allokeras. En matchning kräver uttrycklig bekräftelse och skrivs tillsammans med saldokontrollerna i en databastransaktion. En faktura kan få flera delbetalningar och en bankhändelse kan fördelas på flera fakturor.

Fakturans saldo beräknas från allokeringarna. **Betald** kräver att hela beloppet har fördelats; **Delvis betald** att ett positivt delbelopp har fördelats. Utan betalning visas **Ej avstämd** tills användaren uttryckligen bekräftat en kontroll och angett underlaget. Därefter visas **Obetald** eller **Förfallen**. `is_overdue` markerar passerat förfallodatum även om betalningsunderlaget ännu inte är avstämt. Dagens datum beräknas i `Europe/Stockholm`.

Att återta en matchning tar bort allokeringen, återställer fakturans avstämningsmarkering och skapar en revisionshändelse. Beloppet på en redan registrerad faktura ändras inte genom redigerings-API:t; en rättelse hanteras med korrigerings-/kreditunderlag.

`documents` lagrar PDF-/bildoriginal som BLOB med innehållshash, MIME-typ, källa, käll-ID och koppling till faktura. `import_jobs` sparar antal hittade, importerade, överhoppade och granskningskrävande poster samt bankfilens original. `audit_events` bevarar viktiga åtgärder. Inställningar och krypterade anslutningar ligger i separata tabeller. Migreringar lägger till saknade kolumner utan att ersätta befintliga register.

## Import och matchning

Bankfiler är begränsade till 15 MB och 1 000 händelser. CSV stödjer datum/belopp eller separata debet-/kreditkolumner. Båda sidor med belopp, saknade obligatoriska fält och ogiltiga kalenderdatum stoppas. SEK krävs; andra valutor etiketteras aldrig om.

XML-läsaren hanterar elementstruktur, namnrymdsprefix och vanliga entiteter med begränsat djup och antal noder. DTD och externa entiteter tillåts inte. Den är inte en fullständig XML-/ISO 20022-XSD-validerare. Olika banker och camt-versioner måste verifieras med verkliga, anonymiserade filer.

Samlade bankposter delas bara upp när individuella belopp och totalbelopp stämmer. En ofullständig specifikation behåller totalen en gång med ett granskningskrav. En komplett specifikation kan ersätta en tidigare samlingspost när konto, datum, valuta, bankreferens och summa kan kopplas ihop. Vid saknade referenser eller olika kontoalias kan systemet inte garantera denna koppling.

Dubblettkontrollen använder i första hand konto, bankens stabila transaktionsreferens och betalningsriktning, så att en ändrad beskrivning vid nästa hämtning inte skapar en ny post. När stabilt ID saknas används konto, datum, belopp, valuta, referens, part och text. Två verkligt separata, identiska händelser utan bank-ID kan inte skiljas säkert; användaren behöver kontrollera sådana underlag.

Matchningsförslag kräver rätt riktning och valuta samt exakt OCR/fakturareferens eller samma betalare tillsammans med samma belopp. Transaktioner före fakturadatum föreslås inte. Förslaget ändrar ingen betalningsstatus. Användaren väljer faktura, belopp och bekräftar efter granskning.

## Gmail och bankanslutningar

OAuth-status är tidsbegränsad, kopplad till den automatiska webbläsarsessionen och förbrukas en gång. Google-kontot jämförs med `GMAIL_ACCOUNT` efter godkännande. Bank- och Gmail-hemligheter krypteras på servern; API:t returnerar inte privata nycklar eller token. Frånkoppling försöker återkalla medgivandet hos leverantören innan den lokala anslutningen tas bort.

Gmail hämtar möjliga fakturabilagor från inkorgen och skickade mejl, med dubblett-ID per konto, meddelande och bilagedel. Tydliga påminnelser och order-/betalningsbekräftelser hoppas över. Bilagor sparas som **Behöver granskning**; de blir inte automatiskt bokförda skulder. Filernas signaturer kontrolleras. Ingen automatisk OCR eller fullständig PDF-fälttolkning finns i denna version. Sökningen är heuristisk och kan missa exempelvis arkiverade mejl eller otydliga ämnesrader. Se [Gmail-guiden](GMAIL.md).

Bankkopplingen använder enbart AIS för kontoinformation. Systemet initierar inga bankbetalningar. Både bank och Gmail kräver riktiga klientuppgifter, godkända returadresser och medgivanden. Mockade tester verifierar inte ett riktigt BankID-/Google-flöde eller leverantörens stöd för just företagets konto.

## Återkommande hämtning

`sync_interval_minutes` kan vara `0`, `15`, `30`, `60`, `240` eller `1440`. `0` stänger av automatisk hämtning. Node-servern kontrollerar förfallna jobb en gång per minut och hämtar från aktiva anslutningar. Samtidiga jobb för samma tjänst/konto begränsas. Fel återförsöks tidigast enligt valt intervall, och status för senaste körning kan läsas i inställningarna.

Jobben finns i den körande Node-processen. De körs inte medan servern är avstängd. Gmail har sidmarkör och checkpoint för begränsade batcher; bankhämtning överlappar datum för att fånga upp senare bokföring, med dubblettkontroll. Tidsintervall begränsas till leverantörsadapterns gränser. Det finns ingen separat distribuerad jobbkö, flerprocesslåsning eller driftövervakning.

Inställningar för aviseringar gäller det lokala gränssnittet. Ingen e-post-/pushleverans eller automatisk betalningspåminnelse skickas. Utkast ska kontrolleras av användaren.

## Åtkomst, filer och återställning

API:t öppnas direkt lokalt. Servern lyssnar på `127.0.0.1` och kontrollerar Host för att stoppa DNS-rebinding. HttpOnly-/SameSite-sessioner skapas automatiskt för att binda bank-/Google-returer till rätt webbläsare. Origin-kontroll för skrivningar, CSP och `no-store` kvarstår. Dokument och importerade bankoriginal serveras lokalt som bilagor med begränsande filpolicy. Filuppladdning tillåter PDF, PNG, JPEG och WebP med verifierad signatur, högst 15 MB. Innehåll behandlas som data och körs inte som instruktioner.

SQLite-filen innehåller kunduppgifter och original. De är inte separat krypterade på disk; kryptering av OAuth-/bankhemligheter ersätter inte skydd av lagringsplatsen. Installationen har ingen lösenordsinloggning och saknar isolering mellan företag eller separata användarroller.

`GET /api/export` exporterar register, historik och dokumentmetadata, men inte original-BLOB:ar, token eller nycklar. Den exporten räcker inte för fullständig återställning. En konsekvent filbackup kan tas genom att stoppa servern och kopiera databasen tillsammans med den privata konfigurationen och integrationsnycklarna till skyddad lagring. Återställ samma `BANK_DATA_KEY` för att kunna läsa anslutningarna. Automatisk backup, retention, återställningsprocedurer och extern driftövervakning behöver hanteras i driftmiljön.

## API-endpoints

| Område | Endpoints |
| --- | --- |
| Session | `GET /api/health`, `GET /api/me` (automatisk webbläsarsession) |
| Översikt/inställningar | `GET /api/dashboard`, `GET/PATCH /api/settings` |
| Fakturor | `GET/POST/PATCH /api/invoices`, `GET /api/invoices/:id` |
| Bankhändelser | `GET/POST/PATCH /api/bank-transactions`, `GET /api/suggestions` |
| Matchningar | `GET/POST/DELETE /api/allocations` |
| Bankimport | `POST /api/import/preview`, `POST /api/import/commit`, `GET /api/imports`, `GET /api/imports/:id/original` |
| Dokument | `GET/POST /api/documents`, `GET /api/documents/:id` |
| Bankanslutning | `GET /api/bank/status`, `POST /api/bank/connect`, `GET /api/bank/callback`, `POST /api/bank/sync`, `DELETE /api/bank/connections` |
| Gmail | `GET /api/gmail/status`, `POST /api/gmail/connect`, `GET /api/gmail/callback`, `POST /api/gmail/sync`, `DELETE /api/gmail/connection` |
| Historik/export | `GET /api/audit`, `GET /api/export` |

## Verifiering

`npm run check` syntaxkontrollerar JavaScript-koden. `npm test` kör isolerade tester med tillfälliga databaser och kontrollerade externa svar. Verifiera dessutom med anonymiserade verkliga bankfiler och behöriga externa konton innan systemet används för företagets ordinarie avstämning. Automatiska tester ersätter inte kontroll av driftmiljön, säkerhetskopiorna eller de verkliga medgivandena.
