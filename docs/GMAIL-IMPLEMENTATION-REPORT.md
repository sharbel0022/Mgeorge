# Gmail och fakturatolkning – leveransstatus 27 oktober 2026

## Resultat

Node-versionen har PDF-texttolkning, lokal svensk OCR för skannade PDF/PNG/JPG/WebP, källbelägg och säkerhetsnivå per fält, datum-/belopps-/momskontroll, tre granskningsnivåer, originalförhandsvisning, godkännande, korrigeringshistorik, dubblettkomplettering och valbar automatisk registrering av gröna fakturor från kända motparter. Gmail söker även arkiverade och otydligt namngivna fakturabilagor. Samma innehåll kan ha flera mejlkällor utan att skapa en ny skuld. Gmail har separat serverintervall på 15 minuter från början. Matchning återanvänder befintlig banklogik och kräver alltid användarens godkännande.

Koden är pushad på `codex/gmail-invoice-review`. [Pull request #3 mot main](https://github.com/sharbel0022/Mgeorge/pull/3) är skapad och bifogad till chatten. Den är inte mergad.

Sites har separat källkod, databas och produktionspublicering. Version **13** publicerades framgångsrikt på [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site). Sites-källcommit: `0793f2ab8c73f0d806a33f72cf70468533d9de62`. Deployment: `appgdep_6ae116d67944819198fd45e0a46ff3e8`. D1-migreringen skapar endast fem nya Gmail-tabeller och ändrar inga banktabeller. Banknycklar, miljöhemligheter, banksessioner och tidigare bankhändelser har inte ändrats av arbetet.

## Verifiering och kvarstående arbete

| Efterfrågat resultat | Verifierad status |
|---|---|
| OAuth-kod och säker callback | Implementerat och testat med simulerade Google-svar i båda miljöerna; state, kontokontroll, kryptering och återkallande ingår. |
| Gmail OAuth konfigurerat | Nej. Lokala Google Client ID/Secret saknas. Sites runtime-variabler innehåller inga Google Client ID/Secret. Befintliga skyddade bankhemligheter har inte skrivits ut eller ändrats. |
| Gmail faktiskt anslutet | Nej. Företagskontots interaktiva Google-medgivande återstår. |
| Verklig fakturabilaga hämtad från Gmail | Nej. Gmail-nätverkstester använder syntetiska svar. |
| Fakturauppgifter korrekt extraherade | Ja för syntetisk text-PDF, skannad PDF och PNG/JPG/WebP med verkliga lokala motorer. Inte verifierat på företagets verkliga fakturor. |
| Faktura registrerad | Ja i isolerade tester och i webbläsaren med syntetiskt underlag. Ingen produktionsfaktura har skapats i detta arbete. |
| Swedbankbetalning korrekt matchad | Matchning, riktning och delbetalning är testade med syntetiska bokförda bankhändelser. Ingen verklig Swedbankbetalning har hämtats eller matchats i detta arbete. |
| Obemannad Gmail-hämtning i Node | Implementerad och testad med schemaläggaren och simulerad Gmail. Kräver igångvarande Node-process och giltig anslutning. |
| Obemannad Gmail-hämtning i Sites | Autentiserat MCP-verktyg förberett och testat med 15 minuters spärr. Ett nytt Gmail-schema är inte aktiverat; Google-konfiguration, medgivande och verifiering av det obemannade anropet återstår. |
| Obemannad OCR/automatisk registrering i Sites | Inte implementerad. Sites använder lokal browser-OCR vid granskning och manuell registrering. Node-versionen har bakgrundstolkning och valbar automatisk registrering. |

Slutmålet med en helt automatisk verklig produktionskedja är därför **inte uppnått ännu**. Administratörens externa inställningar och medgivanden kan inte ersättas av tester eller publicering.

## Tester

- `npm run check`: godkänd, 25 JavaScript-filer.
- `npm test`: **137/137 godkända**. Ny täckning omfattar verklig lokal OCR, text-PDF, skannad PDF, bildformat, felaktig PDF, null-värden, momsmotsägelser, flera fakturanummer, kredit, dubbletter och olika leverantörer, ändringshistorik, automatisk registrering, schemaläggning och HTTPS/OAuth-skydd.
- `npm audit --omit=dev`: inga rapporterade sårbarheter i Node-versionens låsta beroenden vid körningen.
- Sites TypeScript: `tsc --noEmit`, godkänd.
- Sites tester: **97/97 godkända**. Nya tester kör riktiga tjänstfunktioner och SQL mot lokal SQLite/D1-adapter och simulerar Google/R2. De testar callbackbindning, replay, fel konto, kryptering, kontoisolering, idempotens, granskning, moms/valuta och spärr för schemalagd körning.
- Sites produktionsbygge: godkänt. Native deployment bekräftade `succeeded` för version 13.
- Webbläsare: separat Node-testdatabas på port 3017; syntetisk PDF laddades upp, fält lästes automatiskt, original visades bredvid uppgifterna, fakturatyp valdes och fakturan godkändes. Gränssnittet visade att registreringen lyckades. Originaldatabasen användes inte för detta test.
- Webbläsare, bankmatchning: den syntetiska fakturan på 3 750 kr matchades efter manuell bekräftelse mot en syntetisk utbetalning på 1 000 kr med referens 0606. Fakturadetaljen visade **Delvis betald**, 1 000 kr betalt och 2 750 kr kvar. Detta var ett test i separat databas, inte en verklig Swedbankbetalning.
- Produktionskontroll efter Sites-publicering: `/api/gmail/status` returnerade 401 utan inloggning; `/gmail` omdirigerade till ChatGPT-inloggning; egenhostad OCR-worker returnerade 200.
- Hemlighetskontroll: ändrade filer och Sites-källkod kontrollerades för typiska Google-, OpenAI-, GitHub- och privata PEM-nyckelmönster; inga träffar. Ignorerade miljöfiler/databaser/original har inte lagts till i Git.

`npm start`-skriptets serverentrypoint verifierades med separata ignorerade testinställningar via `node --env-file=.env --env-file=.codex-work/preview.env src/server.js`. Den befintliga `.env` och dess krypteringsnycklar behölls. En tidigare startbegäran med PowerShell-miljötilldelningar avvisades automatiskt; start med en uttrycklig separat testkonfigurationsfil lyckades. Port 3001 var upptagen, så testservern använde 3017.

## Ändrade filer

Node/GitHub:

- `src/gmail.js`, `src/server.js`, `src/db.js`.
- Nya `src/invoice-extraction.js`, `src/invoice-worker.js`, `src/invoice-review.js`.
- `public/app.js`, `public/index.html`, `public/style.css` och nya `public/review.js`.
- `package.json`, `package-lock.json`.
- `test/gmail.test.js` och nya `test/gmail-additions.test.js`, `test/gmail-api.test.js`, `test/invoice-extraction.test.js`, `test/fixtures.js`.
- `README.md`, `docs/GMAIL.md`, `docs/INVOICE-EXTRACTION.md`, denna rapport och `docs/sites/gmail-invoices.patch`.

Sites version 13:

- `app/api/gmail/[action]/route.ts`, `app/gmail/page.tsx`, `app/dashboard.tsx`, `app/globals.css`.
- `components/gmail-workspace.tsx`, `components/gmail-summary.tsx`.
- `lib/gmail-adapter.js`, `lib/gmail-service.ts`, `lib/invoice-fields.js`, `lib/local-ocr.ts`, `lib/imports.ts`, `lib/banking/mcp.ts`.
- `db/schema.ts`, `drizzle/0003_needy_gravity.sql`, `drizzle/meta/0003_snapshot.json`, `drizzle/meta/_journal.json`.
- `package.json`, `package-lock.json`, `GMAIL.md`, `tests/gmail.test.mjs` och uppdaterade tester för domän/MCP.
- Egenhostade OCR-assets och licenser i `public/ocr/`.

Den läsbara Sites-diffen finns i `docs/sites/gmail-invoices.patch`. OCR-binärer ingår i den separata Sites-källcommiten och deploymentarkivet; de ingår inte i textpatchen. Efter återapplicering behöver Sites-beroenden installeras och motsvarande språk-/motorfiler kopieras till `public/ocr/` enligt den publicerade källversionen.

## Exakta nästa steg

1. Slutför Google Cloud-aktiveringen enligt `docs/GMAIL.md`, registrera rätt callback i varje miljö och ange klientuppgifterna som serverhemligheter.
2. Anslut **mg.vitvaror@gmail.com** genom Google-dialogen. Kontrollera Googles aktuella verifieringskrav och testappens tokenbegränsningar.
3. Hämta en av verksamheten utvald verklig fakturabilaga; jämför varje fält och original. Registrera först efter kontroll.
4. Granska ett verkligt matchningsförslag mot Swedbanks bokförda underlag och betalningsspecifikation. Testerna är inte bankbevis.
5. Aktivera och verifiera separat Sites-molnschema först när Gmail-medgivandet fungerar via det autentiserade verktyget. Befintligt bankschema ska bevaras.
6. Om även Sites ska tolka och registrera fakturor helt obevakat behövs en separat serverbaserad OCR-tjänst eller en verifierad Worker-kompatibel OCR-lösning. Denna del levereras inte genom att Node-versionen pushas till GitHub.

Automatisk uppdelning av flera fakturor i samma PDF och bred tolkning av alla leverantörers layouter återstår. Dokumenten stannar säkert för granskning vid saknade eller motstridiga uppgifter. Referens-/Bankgirokontroll mot externa register ingår inte. Se `docs/INVOICE-EXTRACTION.md` för kostnad, dataskydd och tekniska gränser.
