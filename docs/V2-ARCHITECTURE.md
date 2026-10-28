# Mgeorge V2 arkitektur och gränssnitt

Diagrammen visar kodens faktiska installationsgränser. Node och Sites är separata körmiljöer med separata register. UI-bilderna visar fiktiva uppgifter i den levererade appen.

## Arkitekturen vid arbetets början

```mermaid
flowchart LR
  U[Webbläsare] --> N[Node HTTP API]
  N --> S[(SQLite och dokument)]
  N --> B[Enable Banking AIS]
  N --> G[Gmail OAuth]
  C[ChatGPT inloggning] --> W[Sites Worker API]
  W --> D[(D1 arbetsyta och köer)]
  W --> R[(R2 original)]
  W --> B
  W --> G
  L[Lokal OCR dator] --> W
```

Node implementeras av `src/server.js`, `src/db.js`, `src/bank.js` och `src/gmail.js`. Sites använder `sites/worker/index.ts`, API-rutterna, `sites/lib/server.ts` och bank-/Gmail-modulerna. Inga fakturauppgifter flyttas mellan installationerna av Git-publiceringen.

## Levererad systemarkitektur

```mermaid
flowchart TD
  I[Bank API och godkänd filimport] --> O[Bevarat original]
  O --> X[Gemensam referensextraktor]
  X --> E[Kandidater med källväg och kontrollstatus]
  G[Gmail och dokumentkö] --> F[PDF text eller lokal svensk OCR]
  F --> V[Granskad faktura]
  E --> M[Konservativ avstämning med regelversion]
  V --> M
  M -->|Entydigt underlag och verifierad betalare| A[Atomisk betalningskoppling]
  M -->|Konflikt eller osäkerhet| Q[Behöver granskas]
  Q --> H[Behörigt manuellt beslut]
  H --> A
  A --> T[Revisionslogg och saldon]
  T --> UI[Översikt och fakturor]
  N[(Node SQLite)] --> K[Krypterad daglig snapshot]
  K --> P[Isolerad återställningskontroll]
```

Referenser hanteras av `src/payment-references.js` och samma kod i `sites/lib/payment-references.js`. Avstämningen ligger i `src/reconciliation.js`, `sites/lib/reconciliation-engine.js` och `sites/lib/reconciliation.ts`. Lagringens transaktionskontroller finns i `src/db.js`, `sites/lib/domain.ts` och `sites/app/api/state/route.ts`. Node-backupen ligger i `src/backup.js`; D1/R2 har en separat driftgräns.

## Från banktransaktion till faktura

```mermaid
flowchart LR
  B[Bokförd bankpost] --> ID[Kontroll av konto ID datum belopp valuta]
  ID --> RAW[Spara oförändrat original]
  RAW --> REF[Extrahera alla stödda referensfält]
  REF --> CHECK{Fullständiga och förenliga referenser}
  CHECK -->|Nej| REVIEW[Granska original och specifikation]
  CHECK -->|Ja| MATCH{Entydig faktura och verifierad betalare}
  MATCH -->|Nej| REVIEW
  MATCH -->|Ja| TX[Atomisk allokering med saldokontroll]
  TX --> LOG[Regelversion och revisionslogg]
```

API-normalisering sker i `sites/lib/banking/transactions.ts` och `src/importers.js`. Detaljsökningen i `sites/lib/banking/details-service.ts` kontrollerar den valda bankposten och sparar detaljoriginal i R2. Referensernas källvägar visas i transaktionsdetaljen i `sites/app/dashboard.tsx`. Ett detaljsvar delar inte automatiskt upp en samlingspost.

## Från Gmail till registrerad faktura

```mermaid
flowchart LR
  O[Godkänt Gmail OAuth] --> S[Sök mottagna och skickade fakturabilagor]
  S --> D[Dubblettkontroll och bevarat original]
  D --> C[Dokumentklassificering]
  C --> PDF[PDF text]
  C --> OCR[Lokal bild OCR vid behov]
  PDF --> E[Fält med källbelägg och säkerhet]
  OCR --> E
  E --> V{Säkra fält och verifierad motpart}
  V -->|Ja och automatik tillåten| F[Registrera faktura]
  V -->|Nej| Q[Granska uppgifter bredvid original]
  Q --> F
  F --> M[Konservativ betalningsavstämning]
```

Node använder `src/gmail.js`, `src/invoice-extraction.js`, `src/invoice-review.js` och `src/invoice-worker.js`. Sites använder `sites/lib/gmail-service.ts`, `sites/lib/document-processing.ts`, `sites/lib/invoice-fields.js` och lokal OCR-kö. Konflikter mellan text, filnamn och mejlrubrik blockerar automatisk fakturaregistrering.

## Desktopöversikt

![Mgeorge desktopöversikt med fiktiva uppgifter](v2/dashboard-desktop.jpg)

`sites/components/economy-overview.tsx` visar saldon från `sites/lib/economy-summary.js` och beslut från betalningskontrollen. En uttrycklig preliminärmarkering synliggör saknat underlag. `sites/app/dashboard.tsx` ger fem huvudområden och separat inställningsval.

## Mobilöversikt

![Mgeorge mobilöversikt med fiktiva uppgifter](v2/dashboard-mobile.jpg)

Samma komponenter använder responsiva regler i `sites/app/globals.css`. Sidomenyn blir en öppningsbar mobilmeny och sammanfattningarna anpassas till smal skärm.

## Banktransaktioner

![Bankposter med OCR och separat status](v2/bank-desktop.jpg)

Banklistan i `sites/app/dashboard.tsx` visar betalare, OCR/fakturareferens, belopp, datum och status. Matchade betalningar och samlingsposter visas separat; samlingspostens bankreferens presenteras inte som kundens OCR.

## Granskning av osäker betalning

![Granskningsyta med osäkert bankunderlag](v2/review-desktop.jpg)

`sites/components/payment-control.tsx` visar granskningslistan bredvid valt underlag. `TransactionDetail` i `sites/app/dashboard.tsx` visar bankoriginal, referenskällor och nödvändig komplettering. En samlingspost utan individuell specifikation har ingen automatisk fakturamatchning.
