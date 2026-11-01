# MGEORGE – hela betalningskedjan

Datum: 2026-11-01. Arkitekturen beskriver befintliga Node- och Sites-motorer och denna cykels kontroller. Faktiska test- och driftresultat finns i [verifieringsrapporten](END-TO-END-PAYMENT-VERIFICATION.md). Original, personuppgifter, kontonummer och originalens kontrollsummor bevaras privat.

## Flöde och felvägar

```mermaid
flowchart TD
    A[Kund betalar] --> B[Swedbank bokför bankhändelse]
    B --> C[AIS: stabil kontonyckel och extern transaktionsidentitet]
    C --> D[Bevara mottagen JSON och versionsstyrt SHA-256-kvitto]
    E[Bankgiro: XLSX, CSV eller camt.053/054] --> F[Bevara exakt originalfil med ägare och SHA-256]
    F --> G[Tolka individuella rader, rapportantal och totalsumma]
    D --> H[Kontrollera integritet, ursprung och härledda bankfakta]
    G --> H
    H --> I[Aktuellt ägt medgivande och exakt valt SEK-konto]
    I --> J{Rapport och AIS har gemensam stabil bankidentitet?}
    J -->|Ja, komplett grupp och inga konflikter| K[Bankidentifierade individuella betalningar]
    J -->|Nej| L[Granskningsunderlag utan nya pengar]
    L --> M{Tillräcklig original- och kontoevidens samt uttrycklig attest?}
    M -->|Ja| N[Separat återtagbar manuell originalrelation]
    M -->|Nej| O[Vänta på preciserat bankunderlag]
    N --> P[Visa gemensamma original; bevara manuell evidensnivå]
    K --> Q[Bankens betalare och exakt typad referens]
    C -->|AIS har redan individuell betalare och referens| Q
    Q --> R[Sök registerfaktura och underlagskandidater]
    R --> S{Original och registerpost finns?}
    S -->|Original finns, registerpost saknas| T[Befintlig fakturagranskning och registrering]
    S -->|Uppgifter saknas eller är motstridiga| U[Förslag eller manuell granskning]
    S -->|Registerpost finns| V[Kontrollera unik referens, kundrelation, datum, riktning och saldo]
    T --> V
    V --> W{Alla regler vid allokeringsgränsen passerar?}
    W -->|Ja| X[Automatisk allokering i atomisk transaktion]
    W -->|Nej| U
    U --> Y[Separat administrativ attest där reglerna tillåter]
    Y --> W
    X --> Z[Beräkna ören, delbetalning, överskott och fakturastatus]
    Z --> AA[Ägarbunden historik och betalningsdetalj]
    H -->|Saknat eller ändrat original| O
    I -->|Alias saknas eller medgivande ogiltigt| O
    G -->|Ofullständig eller motstridig fil| AB[Avvisa ekonomisk import; bevara konfliktunderlag]
    AA --> AC[Återta originalrelation eller allokering separat]
    AC --> AD[Bevara revisionshistoria; allokeringsåtertag spärrar ny automatchning]
```

En AIS-post med individuella bankuppgifter behöver inte invänta en separat Bankgirofil. En samlingspost får däremot inte bli en individuell betalning genom en beloppslikhet eller ett fakturaförslag. Den manuella originalrelationen i diagrammet har ingen pil till automatisk allokering: den är endast ett granskningsbeslut om underlag.

## Beslut och ekonomiska konsekvenser

```mermaid
flowchart TD
    A[Ny eller befintlig bankobservation] --> B{Ägare, format, original och rapportkontroller godkända?}
    B -->|Nej| C[Stoppa import eller nya kopplingar; bevara evidens]
    B -->|Ja| D{Aktuellt medgivande och exakt konto godkända?}
    D -->|Nej| E[Vänta på konto- eller bankunderlag; oförändrat saldo]
    D -->|Ja| F{Individuell betalning eller stabilt identifierad komplett rapport?}
    F -->|Nej| G[Föreslå originalrelation för manuell granskning]
    G --> H{Original och mottagarkonto uttryckligen attesterade?}
    H -->|Nej| E
    H -->|Ja| I[Spara manuell metadatarelation; oförändrat saldo]
    F -->|Ja| J{Unik referens och tillräcklig kundrelation?}
    J -->|Nej| K[Fakturaförslag eller separat administrativ granskning]
    J -->|Ja| L{Belopp, valuta, datum, tillgängligt saldo, konflikt och dubbletter godkända?}
    L -->|Nej| K
    L -->|Ja| M[Atomisk säker allokering och audit]
    I --> N{Relationen felaktig?}
    N -->|Ja| O[Återta metadatarelation med ägarbunden anteckning]
    M --> P{Allokeringen felaktig?}
    P -->|Ja| Q[Återta allokering; räkna om saldo och stoppa automatisk återkoppling]
```

| Beslut | Tillåten effekt |
| --- | --- |
| Faktura- eller underlagsförslag | Ingen saldoförändring och ingen ny ekonomisk post |
| Manuell underlagsrelation | Separat metadata, anteckning, tidpunkt och återtag; ingen fakturabetalning |
| Automatisk allokering | Endast efter befintlig original-, konto-, identitets- och matchningsgräns |
| Administrativ fakturaattest | Separat uttryckligt beslut, verifierbart bankoriginal och aktuellt konto; inte bankverifierad betalaridentitet |
| Saknat underlag efter tidigare bokning | Visa verifieringsbrist och stoppa nya beslut; bevara redan bokade belopp |
| Återtag | Ny historikhändelse; ändra inte originalfakta och skriv inte om tidigare beslut |

## Datamodell och evidensnivåer

```mermaid
erDiagram
    OWNER ||--o{ BANK_CONNECTION : owns
    BANK_CONNECTION ||--o{ BANK_ACCOUNT : selects
    BANK_ACCOUNT ||--o{ ACCOUNT_IDENTIFIER : provider_supplies
    BANK_ACCOUNT ||--o{ BANK_EVENT : receives
    BANKGIRO ||--o{ REPORT_ORIGINAL : reported_recipient
    REPORT_ORIGINAL ||--o{ INDIVIDUAL_PAYMENT : contains
    REPORT_ORIGINAL ||--|| RECEIPT : bytes_hash
    BANK_EVENT ||--o{ RECEIPT : received_json
    BANK_EVENT ||--o{ INDIVIDUAL_PAYMENT : stable_identified_children
    BANK_EVENT ||--o{ SOURCE_RELATION : manually_reviewed
    REPORT_ORIGINAL ||--o{ SOURCE_RELATION : manually_reviewed
    INDIVIDUAL_PAYMENT ||--o{ PAYER_EVIDENCE : raw_typed_fields
    INDIVIDUAL_PAYMENT ||--o{ PAYMENT_REFERENCE : raw_typed_fields
    INVOICE_ORIGINAL ||--o{ CUSTOMER_INVOICE : reviewed_registration
    CUSTOMER_INVOICE ||--o{ COUNTERPARTY_RELATION : approved
    INDIVIDUAL_PAYMENT ||--o{ INVOICE_ALLOCATION : booked
    BANK_EVENT ||--o{ INVOICE_ALLOCATION : booked_direct_payment
    CUSTOMER_INVOICE ||--o{ INVOICE_ALLOCATION : paid_amount
    SOURCE_RELATION ||--o{ AUDIT_EVENT : creation_and_revocation
    INVOICE_ALLOCATION ||--o{ AUDIT_EVENT : creation_and_reversal
```

Bankgiro-till-kontorelation i modellen är ett krav på bankevidens, **inte en ny fristående verifierad mappningstabell**. Sites löser endast exakta identifierare i det valda kontots banklevererade resurs. Node kräver exakt IBAN. Saknat alias får inte fyllas med en fri manuell sifferöversättning. Bankgironumret i rapporten är en originalobservation och bevisar inte ensamt mottagarkontorelationen.

| Evidensnivå | Node | Sites | Vad den bevisar |
| --- | --- | --- | --- |
| Bankoriginal | `import_jobs.content`, banktransaktionens `raw_bank_data` | Ägda dokument i R2, `bankData` och bevarade detaljoriginal | Mottagna bytes/JSON-representation och ursprung; SHA är integritetskontroll, ingen fristående bankunderskrift |
| Ankomstkvitto | `content_sha256`, `raw_bank_data_sha256`, identitetsversion | Dokumenthash, `bankDataSha256`, `bankDataVersion` | Oförändrad bevarad representation enligt aktuell profil; historisk backfill bevisar inte äldre ankomst |
| Bankkonto | Krypterad `bank_connections.accounts_json`, valt UID, ägare, status och giltighet | Ägd anslutning/applikationsgeneration, production, giltighet, valda konton och bankresurs | Aktuellt tillåtet mottagarkonto; separat från ett originals integritet |
| Härledning | Omtolkade parserfält och `reconciliationData` | `original`, `payerEvidence`, `referenceEvidence`, analys/preview | Spårbar tolkning; bankens råvärden och ledande nollor bevaras |
| Manuellt beslut | `bank_specification_links`, `payer_links`, administrativ allokering | `bankgiroLinks`, separat `verification`, manuell allokering | Vem som granskade vad; får inte omklassificeras till bankens identitet |
| Ekonomiskt bokat | `bank_transactions`, `allocations` | Ekonomiska transaktioner och aktiva `allocations` i workspace | Faktisk öresallokering; reviewrapporter och originalrelationer är inte extra pengar |
| Revision | SQLite-transaktion och audit | Workspace-revision/CAS, request-kvitto, ägarfiltrerad audit | Atomik, samtidighet, återtag och förklarbar historik |

Sites `writePaymentState` jämför en färsk exakt medgivandesnapshot inne i samma D1-batch som audit och workspace-CAS när nya allokeringar eller rapportpromotion ska sparas. En ändrad anslutning, valt konto, krypterad kontoresurs/session, ägare, miljö, applikationsgeneration, bank/land eller utgången giltighet stoppar hela batchen. Frånkoppling kan därför inte passera mellan en tidigare godkänd originalkontroll och ekonomisk commit. Befintligt schema används; inget nytt produktionsregister skapas.

## Implementationskarta

| Led | Node | Sites |
| --- | --- | --- |
| AIS och kontoval | `src/bank.js`, bankrutter i `src/server.js` | `lib/banking/service.ts`, `transactions.ts`, `details-service.ts` |
| CSV/XML/XLSX | `src/importers.js`, gemensamma parserfiler | `lib/imports.ts`, `bankgiro-parser.js`, `bankgiro-xlsx.js` |
| Original, kvitto och allokeringsgräns | `src/reconciliation.js`, `src/bank-evidence.js` | `lib/bank-api-original.js`, `reconciliation-evidence.ts`, `bankgiro-service.ts` |
| Manuell originalrelation | `src/bankgiro-links.js` | `lib/domain.ts`, `bankgiro-service.ts`, `components/bankgiro-link-review.tsx` |
| Fakturaunderlag och registrering | `src/invoice-review.js`, Gmail/OCR-flöden | `lib/document-processing.ts`, Gmail/OCR-flöden |
| Kund och fakturareferens | `src/reconciliation.js`, `payment-references.js` | `lib/reconciliation.ts`, `reconciliation-engine.js`, `payment-references.js` |
| Allokering och saldo | `src/db.js`, `src/reconciliation.js` | `lib/domain.ts`, `lib/reconciliation.ts` |
| Läsande betalningskontroll | Befintlig översikt och separat original-/kontostatus i API | `GET /api/bank/verification`, `lib/payment-verification.ts`, `components/payment-verification.tsx` |

Node är den befintliga administratörsstyrda en-företagsarbetsytan. Sites isolerar arbetsyta, original, bankresurser och audit per ChatGPT-ägare. De har olika lagring, men samma säkerhetsprinciper. Ingen parallell ekonomimotor eller separat produktionsdatabas har införts.

## Gränssnitt: desktop och mobil

Den nya Sites-detaljen öppnas från befintlig bankrad. Den globala knappen som kör Gmail/dokument/bank/avstämning är en annan funktion; att öppna en betalningskontroll startar inget av dessa jobb.

```mermaid
flowchart LR
    subgraph Desktop[Desktop: befintlig betalningsdialog]
        D1[Bankens betalare, belopp, datum och exakt referens]
        D2[Betalningskontroll: kontroll och status]
        D3[Öppna valfritt steg: uppgifter, källa, tid, regel, förklaring och nästa steg]
        D4[Befintliga original, fakturaförslag och historik]
        D1 --> D2 --> D3 --> D4
    end
    subgraph Mobil[Mobil: samma innehåll i en kolumn]
        M1[Belopp och betalningsstatus]
        M2[Kontrollsteg med textstatus]
        M3[Utfällbar förklaring under valt steg]
        M4[Original och separat godkännandeflöde]
        M1 --> M2 --> M3 --> M4
    end
```

Svart och vitt, tydliga textstatusar, tangentbordsåtkomliga utfällningar och radbrytning för långa värden. Gränssnittet skiljer på bankfakta, manuella beslut, förslag och bokförda belopp. Fakturakund ersätter aldrig bankens betalarnamn. Ett registerfynd utan kontrollerat fakturaoriginal visas med den begränsningen. Tidpunkten avser den läsande kontrollen och får inte kallas bankens attesttid.

## Externa gränser

625-kronorsfallet är inte färdigavstämt. Aktuellt kontoalias för rapportformatet, bankens uttryckliga rapport-/AIS-samband samt separat fakturaregistrering/motpartsgranskning återstår. Företagets formella OCR-avtal och rapportkanal är inte verifierade genom generella parserregler. Det är korrekt att lämna betalningen i granskning tills dessa krav har styrkts.
