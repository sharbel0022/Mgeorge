# Område 6: minsta återstående verkliga observation

Läsbedömning 2026-11-06, mot källträdet `ae7721b35ec1c91ee590b57a14e36cc13f2e8e62`. Inga produktionsanrop, originalhämtningar, köändringar, OCR-/parserkörningar eller nya poäng ingår i denna bedömning.

## Slutsats

PLAN:s oförändrade krav är att säkra normalfall går genom den avsedda kön, att avvikelser får konkreta granskningsskäl och kan återupptas, samt att verklig köprogress observeras. **Periodisk körning är inte ett ytterligare krav i område 6.** Den frågan hör till område 28.

Verklig Gmailhämtning, sex behandlade OCR-underlag utan körfel och specificerade granskningsskäl styrker delar av kedjan. Syntetiska prov styrker normalregistrering, dubblettskydd och återupptagning. De två rapporterade registreringskvittona från 28 oktober visar historiskt bruk. Det återstående snäva beviset är ett verkligt, redan behörigt normalunderlag som på den aktuella publicerade koden går genom den avsedda kön till ett beständigt registreringskvitto och korrekt slutstatus. Detta kan vara ett textbaserat PDF-underlag; OCR-underlag behöver inte godkännas automatiskt om den bevarade produktpolicyn kräver granskning. En ny betalningskoppling, ett utskick eller en framprovocerad dubblett i produktion behövs inte som extra villkor.

Det här underlaget visar inte att ett sådant normalfall redan finns redo. Ingen poäng ändras.

## 368 minus 367 är inte ett färskt motpartsbevis

Det sparade kvittot `wave2-postpublication-observations.json` innehåller 368 analyserade granskningsposter, utan trunkering. 367 hade den bokstavliga, sparade varningen om att motparten behöver verifieras. `other_review` var 0.

`reviewReasons()` i `sites/lib/document-processing.ts` räknar överlappande flaggor i den **sparade tolkningen**. Den gör ingen aktuell uppslagning i `invoice_counterparties`, ingen ny kontroll av originalet och inget godkännande. Frånvaron av just den historiska varningstexten kan därför inte ensam bevisa en aktiv, korrekt bunden motpart i dag. Eftersom `other_review=0` har även den återstående posten minst en annan räknad granskningsflagga. Det går inte att härleda dess identitet, övriga saknade fält eller återupptagningsbarhet från totalsiffrorna.

Vid verklig bearbetning söker `finish()` motparten med aktuell ägare, normaliserad identitet/riktning och mejladress. Bankgiro och valuta måste stämma; tolkningen måste vara grön, komplett och inte en dubblett. Automatisk registrering kontrollerar originalets faktiska byteinnehåll och spärrar även vid ändrad tolkning, motpartsversion, kölease, registerrevision eller automationsinställning. Ett manuellt tryck på **Verifiera motpart** eller **Godkänn faktura** skulle skapa ett nytt manuellt bevis och besvarar inte frågan om ett redan tillåtet normalfall.

## Befintlig läs- och återupptagningsväg

| Befintlig väg | Vad den faktiskt ger | Begränsning |
| --- | --- | --- |
| `gmail_sync_status` / sammanfattningsstatus | Aggregerade kötal och sparade granskningsskäl. | Inga dokument-ID:n och ingen aktuell motpartsrelation. |
| Ägarens `GET /api/gmail/status` utan `summary=1` | Metadata, sparad tolkning, jobbstatus och eventuellt registrerat faktura-ID för de senaste 200 källraderna. | Ingen aktuell trust-join eller paginering; det återstående fallet kan ligga utanför fönstret. Anropet hämtar inte originalbytes. |
| Befintlig Sites-databasöversikt och begränsad tabelläsning | Kan läsa redan lagrade motparts-, jobb- och registreringsrader med ordinarie behörighet. | Översikt måste först ge exakta tabell/binding-namn; högst 25 rader per sida och endast returnerad fortsättningsmarkör. Ingen godtycklig SQL eller serverfiltrering finns i detta verktyg. Företags-/ägargräns och trunkering måste kontrolleras innan slutsats. |
| **Tolka igen** på ett bestämt underlag | `POST /api/gmail/retry` med dess ID återköar ett befintligt `failed`, `needs_review` eller `duplicate`-jobb; UI följer med `POST /api/gmail/process`. | Det är en mutation och utfördes inte här. Den godkänner inga fält. Processorn tar högst två tillgängliga PDF-jobb i köordning, inte nödvändigtvis just det valda jobbet. Ett lokalt/OCR-jobb går tillbaka till OCR-kön. |

**Minsta nästa steg för driftägaren:** undersök först befintliga lagrade metadata och motpartsrelationer, utan att öppna original eller skriva ett godkännande. Identifiera om den enda posten utan den historiska motpartsvarningen faktiskt motsvarar en aktuell, oförändrad motpartsrelation och vilka andra granskningsskäl den har. Börja med det redan tillgängliga kandidatfönstret eller redan bevarad diagnostik; om det inte omfattar posten behövs en separat, begränsad läsning med den vanliga Sites-behörigheten. Ingen sådan kandidat är identifierad av den här granskningen.

Om en redan tillåten kandidat finns kan driftägaren därefter använda den befintliga återupptagningen och observera det exakta jobbets övergång, registreringskvitto, originalbindning och slutliga efterkontrollstatus. Återupptagningen måste återpröva samtliga vanliga säkerhetsvillkor. Om fält saknas eller originalet inte är ett säkert normalfall ska granskningsläget bevaras; att framtvinga grönt vore inget giltigt bevis för område 6. Befintlig säker återupptagning och idempotens är syntetiskt prövade; ett nytt skapat produktionsfel krävs inte för att styrka dem igen.

## Källor och avgränsning

Källor: `docs/quality8/PLAN.md` område 6; `docs/quality8/wave2-postpublication-observations.json`; `sites/lib/document-processing.ts` (`reviewReasons`, `finish`, `registerProcessedInvoice`, `claim`, `processingAction`); `sites/lib/gmail-service.ts` (`gmailStatus`); `sites/components/gmail-workspace.tsx`; `sites/components/document-ocr-status.tsx`; `sites/app/api/gmail/[action]/route.ts`; `sites/tests/gmail.test.mjs` (befintliga positiva registrerings- och negativa tillitsprov). Filhashar finns i den separata JSON-filen.

De rapporterade två registreringskvittonas datum och den senare Gmailhämtningen är uppgifter från driftägaren; granskaren har inte läst nya privata rader. Här har endast kod och redan sanerad evidens lästs. V3, dess bilder/facit och framtida första mätning är orörda.
