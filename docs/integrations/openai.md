# OpenAI och befintlig OCR

AI är valfritt. Utan nyckel, vald granskad modell, giltiga gränser och fullständiga godkännanden fortsätter befintlig OCR. Startkontrollen kan visa **”OpenAI är inte konfigurerat. Befintlig OCR används.”**. Den gör ingen nätverksbegäran och ger inget bevis på modellåtkomst. Inga kundöverföringar eller produktionsgodkännanden har aktiverats genom denna ändring.

## Offentlig ingång och körmiljöer

Node använder `packages/ai/index.js`, som återexporterar den gemensamma implementationen i `sites/lib/openai-invoices/index.js`. Sites använder den senare ingången direkt och behöver inga filer utanför sin källrot. Provideranrop, schema, validering, kostnadsberäkning, återförsök och policy finns endast i den gemensamma implementationen. Node/SQLite- och Sites/D1/R2-adaptrar behåller sina kontroller av företag, original, lease, återställningsstatus och beständig journal.

De kompatibla funktionerna är `invoiceAiPolicy(environment, owner)`, `extractOpenAiInvoice(args, options)` och `enrichInvoiceForReview(context)`. Den offentliga ingången exponerar också förberedelse, audit stores, återställningskontroller och `enrichSitesInvoice(context)` som laddar Sites-adaptern först vid anrop.

`invoiceAiConfigurationStatus(environment)` returnerar endast `{status, code, model, fallbackModel, limits, budgets, liveVerified:false}`. Status är `disabled`, `blocked` eller `configured`. Nyckel, råa miljövärden, kontrakt och ägarlistor ingår aldrig. `configured` betyder lokal konfigurationsvalidering; `invoiceAiPolicy` måste fortfarande godkänna det aktuella företaget. Detta statusobjekt är lämpligt för startkontroll och intern driftinformation. Sites exponerar det via `GET /api/admin/ai-status` med aktuell företagskontext och rättigheten `manage_integrations` (owner/admin). Kontrollen återvaliderar medlemskap och kontext; accountant, viewer, anonym och fel företag nekas. Adminsvaret lägger till `policyStatus` (`disabled`, `blocked`, `enabled`) och `policyCode` för aktuellt företags faktiska godkännanden, så lokal konfiguration kan skiljas från överföringstillstånd utan att visa ägare eller hemligheter. Svaret har `Cache-Control: private, no-store`. Diagnostiken ska inte hämtas eller visas för vanliga kunder.

## Miljövariabler

Kopiera `.env.example` lokalt och fyll hemligheter på servern. I Sites förs samma värden in via Workers befintliga runtime-bindings och skyddade hemlighetshantering. Kopiera aldrig lokal `.env` till produktion. Inga av dessa variabler ska ha `NEXT_PUBLIC_` eller skickas till webbläsaren.

| Variabel | Betydelse och validering |
|---|---|
| `OPENAI_API_KEY` | Krävs endast för AI. Icke-tom ASCII utan blanktecken, högst 4096 tecken. Loggas inte. |
| `OPENAI_ENABLED` | Exakt `true` eller `false`. Frånvaro ger avstängt om inget äldre aktiveringsvärde finns. |
| `OPENAI_MODEL` | Exakt modellidentifierare i granskad profil eller i ett godkänt anpassat kontrakt. Tomt eller okänt värde blockerar AI. |
| `OPENAI_FALLBACK_MODEL` | Valfri separat granskad modell. Tomt värde betyder ingen reservmodell. Ogiltig reservmodell blockerar AI-konfigurationen. |
| `OPENAI_MAX_OUTPUT_TOKENS` | Heltal 1–8192 och inom respektive modells granskade gräns. Exempelfilen använder 2000; äldre installation utan variabel behåller profilens 8192. |
| `OPENAI_TIMEOUT_MS` | Heltal 1–45000, standard 30000. Gemensam tidsgräns för tokenräkning, svar, kroppsläsning och eventuellt begränsat återförsök per modell. |
| `OPENAI_DAILY_BUDGET_USD` | Positiv decimal med högst sex decimaler, högst 100 USD. Standard 2 USD. |
| `OPENAI_MONTHLY_BUDGET_USD` | Positiv decimal med högst sex decimaler, högst 1000 USD. Standard 50 USD. Minst dagsbudgeten. |
| `OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD` | Positivt heltal, högst 10 000 000; standard 250 000 (0,25 USD). Får inte överstiga dagsbudgeten. Varje vald modell reserverar hela detta belopp. |
| `OPENAI_MODEL_CONTRACT` | JSON-kontrakt för primär modell som saknar inbyggd granskad profil. Se nedan. |
| `OPENAI_FALLBACK_MODEL_CONTRACT` | Separat JSON-kontrakt för motsvarande reservmodell. |

Nya namn har företräde när de finns, även om de är tomma, ogiltiga eller `false`. Ta bort variabeln helt om äldre beteende önskas. `OPENAI_ENABLED` ersätter `OPENAI_INVOICES_ENABLED`; `OPENAI_MODEL` ersätter `OPENAI_INVOICES_PROFILE`; USD-budgeterna ersätter `OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD` respektive `OPENAI_INVOICES_MONTHLY_BUDGET_MICRO_USD`. Övriga äldre godkännanden och dokumentbudget gäller fortsatt. Äldre `luna-v1` och `sol-v1` hämtas från samma profilregister som den nya modellinställningen; ingen separat hårdkodad modellista finns i integrationspolicyn.

## Godkännanden före överföring

Alla följande krav måste uppfyllas för varje företag:

1. `OPENAI_INVOICES_PRIVACY_APPROVED=true`, `OPENAI_INVOICES_SECURITY_APPROVED=true` och `OPENAI_INVOICES_COST_APPROVED=true` anger dokumenterade beslut om personuppgifter, säkerhet och kostnader.
2. `OPENAI_INVOICES_APPROVAL_ID` innehåller en spårbar beslutsreferens, 3–120 tecken, med bokstäver, siffror eller `- . _ : /`.
3. `OPENAI_INVOICES_ALLOWED_OWNERS` innehåller en JSON-lista med godkända exakta `storageOwner`-värden. `OPENAI_INVOICES_COMPANY_ORGANIZATIONS` mappar varje sådan ägare till företagets verkliga giltiga svenska organisationsnummer.
4. Modellens faktiska existens, projektåtkomst, stöd för Responses, schema, bild/PDF och tokenräkning samt prisgränser verifieras separat med godkända syntetiska underlag. Ett lokalt kontrakt bevisar inte liveåtkomst. Ingen sådan liveverifiering utförs automatiskt av start eller status.
5. Företagsbehörighet, återställningsjournal och validerat oförändrat original kontrolleras vid varje relevant steg. Sites måste också ha giltig bearbetningslease. Först därefter får originalet läsas och en kostnadsreservation skapas.

En redan grön OCR-tolkning använder inte AI. AI-förslag kräver alltid mänsklig kontroll mot originalet, blir aldrig bankbevis och kan aldrig automatiskt registreras genom att ange en grön status. Oförenliga belopp, identiteter, valutor och tabelluppgifter spärrar automatisk ifyllnad.

## Anpassad modell och granskade priser

Identifieraren i `OPENAI_MODEL` styr modellvalet. En ny identifierare får användas endast med ett uttryckligt serverkontrakt. Exemplet nedan är **syntetiskt**, fungerar endast i tester och intygar ingen befintlig modell:

```json
{
  "model": "synthetic-reviewed-model",
  "approvalId": "review-synthetic-v1",
  "reviewedOn": "2026-11-07",
  "source": "https://developers.openai.com/api/docs/models/synthetic-reviewed-model",
  "capabilities": {
    "responses": true,
    "structuredOutputs": true,
    "imageInput": true,
    "pdfInput": true,
    "inputTokenCounting": true,
    "reasoningEffort": "low"
  },
  "limits": {"maxInputTokens": 32000, "maxOutputTokens": 2000},
  "pricing": {
    "inputMicroUsdPerMillionTokens": 1000000,
    "outputMicroUsdPerMillionTokens": 4000000
  }
}
```

Lagra JSON som en serversträng i respektive kontraktsvariabel. Modellnamnet måste matcha exakt. Granskaren intygar att priserna är försiktiga övre gränser för standardnivå, okachad input och samtliga fakturerbara output-token inom de angivna gränserna. Ta hänsyn till modellens bild/PDF-token och eventuella pristiers innan godkännande. Priserna får inte vara noll, saknas, vara negativa eller överstiga 1 000 000 000 mikro-USD per miljon token. Inputgränsen är högst 128 000 och outputgränsen högst 8192. Källan måste ligga på officiell OpenAI-domän. Ett kontrakt för en inbyggd modell åsidosätter inte den granskade registerprofilens pris.

Modeller som kräver andra API-parametrar, tokenprisfält, verktyg, serverlagring eller caching stöds inte genom att bara lägga till ett kontrakt. Då krävs kodgranskning av adapter och kostnadsregler. Ofullständiga kontrakt återgår till OCR. Inbyggda profilpriser återkontrollerades mot officiella modellsidor 2026-11-07: `gpt-6-luna` 0,10 USD input/0,50 USD output och `gpt-6.1-sol` 2 USD input/10 USD output per miljon token vid standardnivå. Sols tröskel för högre långkontextpris är 272 000 input-token; adaptern tillåter högst 128 000. Versionsmarkörerna behålls eftersom profilernas priser och gränser inte ändrats. Produktionsgodkännande kräver fortfarande verklig åtkomst- och faktureringskontroll; dokumentation är inte faktureringsbevis.

## Budget, reservmodell och osäkra svar

En original-/modellreservation har en stabil identitet för exakt modell, ägare, originalhash och befintlig företags-/rollkontext. Granskningsdatum, beslutsreferens, käll-URL, priser, token-/timeoutgränser eller senare inbyggd/anpassad representation kan inte ge samma original en ny kostnadsrätt. Kompletta kvitton återanvänds och osäkra reservationer förblir spärrade även efter omstart och ändrad modellattest. Avsiktlig ombearbetning kräver en separat uttryckligt granskad migrering. Gamla profilbaserade nycklar kontrolleras som alternativa identiteter; reservationen prövar båda nycklarna atomärt och D1 behåller ägarscope.

Budgetar jämförs som exakta heltal i mikro-USD. Dags- och månadsgränser gäller UTC och per företags skyddade journal. SQLite respektive D1 gör båda budgetvillkoren och reservationen i **samma INSERT-sats**. Reservationer finns kvar efter omstart, fel, timeout och återställning enligt befintlig recovery-spärr; de återbetalas aldrig automatiskt eftersom ett förlorat svar kan ha debiterats. Äldre journalreservationer räknas också med i månadsbudgeten. Felaktiga reservationsbelopp räknas konservativt som förbrukad budget.

Tokenräkningen använder samma modell, instruktioner, schema och original som generationen. Innan generation räknas ett övre belopp från input-token, maximal output och maximalt två försök, och jämförs mot dokumentreservationen. Endast uttrycklig tillfällig rate limit kan ge ett begränsat återförsök. Saknad användningsstatistik, oväntad modell, prisrelaterad osäkerhet, cachedebitering och ofullständiga svar blir aldrig godkända ekonomiska fakta.

En reservmodell provas bara när leverantören uttryckligen returnerar HTTP 404 med `model_not_found`, föregående resultat saknar kostnadsosäkerhet och det resultatet sparats beständigt. Reservmodellen passerar godkännanden på nytt och får egen nyckel, tokenräkning, kvitto och full reservation under **samma** dags- och månadsbudget. Därför kan två modeller för ett original reservera dubbla dokumenttaket. Saknas återstående budget används OCR. Ingen växling sker efter nätverksfel, timeout, kvotfel, nekad åtkomst, refusal eller okänd debitering. Primärt och sekundärt resultat återanvänds vid ny bearbetning. Varje modell har sin egen tidsgräns, så en tillåten reservväg kan använda upp till två tidsgränser totalt.

## Officiellt API-underlag

Granskat 2026-11-07:

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) och [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): identifierare, Responses, resonemang och standardpriser. Båda modellsidorna öppnades.
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses använder `text.format` med `json_schema`, `strict:true`; refusal och ofullständiga svar kräver separat hantering.
- [Tokenräkning](https://developers.openai.com/api/docs/guides/token-counting): `POST /v1/responses/input_tokens`, PDF/filinput och att `max_output_tokens` omfattar även icke-synliga genererade token.
- [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create): endpoint och parametrar. Sökresultatet kunde läsas men full sidöppning överskred verktygets storleksgräns; de två guiderna öppnades och lästes.

Lokala syntetiska tester verifierar kontrakt, spärrar, beständig budget och adapterbeteende. De verifierar inte projektets faktiska modellåtkomst, kundsamtycke, produktionens hemligheter eller leverantörens faktiska faktura.
