# OpenAI för fakturatolkning – drift och säker aktivering

**Status: avstängt. Dokumentation kontrollerad 2026-11-06.**

Detta är driftinstruktionen för tillägget i [PR #64](https://github.com/sharbel0022/Mgeorge/pull/64), med `main` vid `f3c80629` som utgångspunkt. Dokumentet ger ingen aktivering och innebär inget godkännande att skicka kunduppgifter. Originaldokument och befintliga tolkningar ska bevaras.

## Verifieringsläge

| Kontroll | Status vid dokumentets tillkomst |
| --- | --- |
| Officiella modell-ID:n, standardpriser, Responses och Structured Outputs | Kontrollerade mot källorna nedan |
| Lokal exekveringsmiljö och lokal API-nyckel | Inte tillgängliga i arbetssessionen |
| Modellåtkomst för avsett OpenAI-projekt | `NOT_VERIFIED` |
| Projektets betalningssätt, saldo, faktiska kostnader och leverantörsgränser | `NOT_VERIFIED` |
| Anrop till tokenräkning och generering med projektets nyckel | `NOT_VERIFIED` |
| Dataskyddsbedömning, biträdesavtal/DPA, lagring och eventuell EU-region | `NOT_VERIFIED`; inga godkännanden antas |
| Träffsäkerhet på representativa verkliga fakturor | `NOT_VERIFIED` |

Tester med syntetiska svar kan verifiera programbeteende men styrker inte modellens faktiska träffsäkerhet. Påståenden om 85 %, 98 % eller en viss förbättring får inte göras utan en dokumenterad, representativ utvärdering. Se PR:ens aktuella CI-resultat för kodtester; detta dokument intygar inte en viss körning.

## Flöde och tillitsgränser

Den befintliga tolkningen körs först. AI-tillägget används endast för godkända ägare och dokument som behöver ytterligare granskning. En redan grön tolkning behöver inget AI-anrop. Servern kontrollerar dokumentets ägare, gällande bearbetningsrätt, originalets hash, MIME-typ och storlek före åtkomst och omkring asynkrona steg.

Servern skickar originalets PDF eller bild direkt som inline-data till OpenAI. PDF använder `input_file` med `file_data` och filnamn; bild använder `input_image` med en data-URL. Ingen offentlig dokumentlänk, extern bild-URL eller separat Files API-uppladdning behövs. Originalets bytes ska bevaras. PDF-behandlingen hos OpenAI omfattar både text och sidbilder, vilket påverkar tokenantalet. [3]

Tokenräkning görs med `POST /v1/responses/input_tokens` innan generering. Samma modell, instruktioner, multimodala indata, svarsschema och reasoning-inställning ska användas i båda stegen. Om räkningen saknas, är ogiltig eller överskrider gränserna ska genereringen stoppas. Generering använder `POST /v1/responses`, `store: false`, ett strikt JSON-schema och begränsat antal output-token. Ingen verktygsåtkomst, webbsökning eller agentkedja ingår. [4][5]

Alla AI-resultat är granskningsförslag. Ett giltigt JSON-schema bevisar inte att de avlästa uppgifterna stämmer. Belopp, datum, företag, moms och referenser ska kontrolleras mot originalet och befintliga valideringar. Sidnummer och citerad text i modellsvaret är också modelluppgifter, inte oberoende bevis.

AI får inte övertrumfa motstridiga uppgifter, skapa bevis för bankreferenser, fastställa att en betalning skett eller göra en faktura automatiskt bokföringsklar. Behåll `requiresHumanReview: true` och `bankEvidence: false`. Osäkra ekonomiska uppgifter får inte automatiskt fylla bokföringsfält. Avvisning, timeout, ofullständigt svar, schemafel eller saknat lagringskvitto ska lämna originaltolkningen tillgänglig för manuell granskning.

## Modellprofiler och priser

| Profil | Exakt modell-ID | Reasoning | Input, USD/1M token | Output, USD/1M token |
| --- | --- | --- | ---: | ---: |
| `luna-v1` | `gpt-6-luna` | `low` | 0.10 | 0.50 |
| `sol-v1` | `gpt-6.1-sol` | `low` | 2.00 | 10.00 |

Detta är dokumenterade standardpriser, kontrollerade 2026-11-06, för inputkontext upp till 272K token. Prisversionen ska lagras tillsammans med beräkningen. Profilerna måste hålla sig inom det prissatta kontextintervallet. Beräkna inte billigare användning genom att anta cacheträffar. Cache-skrivning, andra tjänstenivåer, långa kontexter och regionala alternativ kan ha andra priser; de måste granskas innan någon sådan funktion införs. [1][2]

De öppnade modellsidornas snapshot-avsnitt listade inga daterade modell-ID:n. De bokstavliga ID:na ovan är därför explicita val, men dokumentet påstår inte att de är oföränderliga snapshots. Hitta inte på datumändelser. Logga vald och returnerad modell samt profil-, prompt-, schema- och prisversion. Modell- eller profilbyte kräver ny utvärdering.

Genereringsanropet ska uttryckligen ha `prompt_cache_options: { mode: 'explicit' }` och inga `prompt_cache_breakpoint` i innehållet. Den dokumenterade kombinationen stänger av promptcache och cache-skrivningar. Standardläget kan annars skapa cache-skrivningar som kostar 1,25 gånger ordinarie inputpris för 30 minuter. Lägg inte ett odokumenterat cachefält i tokenräkningsanropet. Välj standardnivån för generering och kontrollera returnerad användning och tjänstenivå. [9]

Luna är utgångspunkten för en kostnadsbegränsad utvärdering. Sol är ett separat profilval som måste motiveras med mätningar. Ett fel på Luna får inte automatiskt starta ett dyrare Sol-anrop.

## Kostnad, reservation och återförsök

Alla belopp i konfigurationen anges som heltal i mikro-USD: 1 USD = 1 000 000 mikro-USD. Standardtaket per dokument är `250000` = 0,25 USD och standardbudgeten per UTC-dygn är `2000000` = 2,00 USD.

Före extern överföring reserveras hela dokumenttaket i den beständiga audit-lagringen. Reservation och kontroll av dygnsbudgeten ska ske atomiskt. Reservationsnyckeln binder samman ägare, dokumenthash, modellprofil och tolkningskontext. Samma innehåll i samma sammanhang ska därför inte ge ett nytt betalt försök vid omstart, parallell bearbetning eller upprepat jobb.

En befintlig reservation återanvänder ett sparat resultat, eller stoppar försöket om resultat saknas. Reservationer återbetalas inte automatiskt. Efter timeout eller bruten anslutning är debiteringen okänd: leverantören kan ha behandlat anropet. Behåll reservationen och gör inget automatiskt återförsök. Radera inte audit-poster för att försöka på nytt.

Den reserverade summan är ett konservativt internt budgetavdrag, inte en uppgift om verklig debitering. Kontrollera officiell tokenräkning och maximal output mot dokumenttaket före generering. Spara faktisk returnerad användning och beräknad kostnad separat, och stäm av mot projektets fakturering. Påstå inte att appens budget är ett bekräftat hårt kostnadstak hos OpenAI. [4][8]

D1-budgeten kontrolleras per ägare. Node-lagringen utgår från den befintliga databasens isolering och summerar audit-reservationerna i databasen. Den får inte beskrivas som en separat budget per ägare i en delad databas utan ytterligare ägarfiltrering.

En ny profil, organisationskoppling eller tolkningskontext kan ge en ny reservationsnyckel och ny kostnad. Sådana ändringar ska därför vara avsiktliga. En full reservation kan också finnas kvar efter ett lokalt fel eller misslyckad tokenräkning; detta är den valda konservativa policyn.

## Dataskydd och lagring

OpenAI beskriver att API-innehåll inte används för träning som standard utan uttryckligt deltagande. Normal abuse-monitoring kan ändå behålla innehåll i upp till 30 dagar, med angivna undantag. `store: false` styr Responses lagring av applikationstillstånd; det stänger inte i sig av denna övervakningslagring. [6]

Zero Data Retention och Modified Abuse Monitoring kräver godkännande och särskilda förutsättningar. Filer och bilder omfattas också av säkerhetskontroller och vissa lagringsundantag. Inline-data undviker ett separat Files-objekt men innebär inte noll lagring. [6]

EU-lagring och regional behandling måste vara korrekt konfigurerade och tillåtna för det faktiska projektet. `eu.api.openai.com` är inte ett allmänt godkännande och alla systemuppgifter omfattas inte av data residency. Ingen EU-region är verifierad eller aktiverad här. [6]

Ansvarig måste före kunddata bedöma ändamål, rättslig grund, uppgiftsminimering, biträdesavtal/DPA, underbiträden, eventuella överföringar, åtkomst och gallring. Godkännandeflaggor dokumenterar ett redan fattat beslut; de fattar inte beslutet och bevisar inte GDPR-efterlevnad. Bedöm även den egna audit-lagringens fakturauppgifter och beviscitat. Hemligheter och råa leverantörsfel får inte skrivas till användargränssnitt eller vanliga felloggar.

## Konfiguration – avstängd mall

Samtliga värden nedan är avstängda eller tomma. Kopiera inte en verklig nyckel till Git, webbläsarkod, byggvariabler för klienten, ärenden eller loggar. `OPENAI_API_KEY` ska endast finnas i serverns hemlighetshantering.

```dotenv
OPENAI_INVOICES_ENABLED=false
OPENAI_INVOICES_PRIVACY_APPROVED=false
OPENAI_INVOICES_SECURITY_APPROVED=false
OPENAI_INVOICES_COST_APPROVED=false
OPENAI_INVOICES_APPROVAL_ID=
OPENAI_INVOICES_ALLOWED_OWNERS=[]
OPENAI_INVOICES_COMPANY_ORGANIZATIONS={}
OPENAI_INVOICES_PROFILE=
OPENAI_INVOICES_MAX_DOCUMENT_MICRO_USD=250000
OPENAI_INVOICES_DAILY_BUDGET_MICRO_USD=2000000
OPENAI_API_KEY=
```

`OPENAI_INVOICES_ALLOWED_OWNERS` är en JSON-lista med exakt godkända ägar-ID:n. `OPENAI_INVOICES_COMPANY_ORGANIZATIONS` är ett JSON-objekt från samma ägar-ID till företagets svenska organisationsnummer som sträng. Använd verifierad företagsidentitet; klienten eller fakturans text får inte välja denna koppling.

Profilen måste uttryckligen vara `luna-v1` eller `sol-v1`. Godkännandeflaggorna och aktiveringsflaggan kräver strängen `true`; andra värden ger inte tillstånd. Godkännande-ID ska identifiera ett verkligt dokumenterat beslut. Saknad nyckel, okänd profil, ogiltig organisation, otillåten ägare eller ogiltiga budgettal ska blockera anropet. Dokumenttaket får inte överstiga dygnsbudgeten.

## Aktivering efter separat, dokumenterat godkännande

1. Behåll funktionen avstängd. Granska PR #64 och dess aktuella tester, kontrollera ägarisolering och beständig lagring samt säkerställ att original och manuell granskning fungerar när OpenAI är otillgängligt.
2. Dokumentera dataskydds-, säkerhets- och kostnadsbeslutet, inklusive berörda ägare, företag, miljö, profil, datatyper och giltighet. Kontrollera avtal och faktiska projektinställningar. Inget sådant godkännande följer av denna PR.
3. Verifiera modellåtkomst, fakturering och prisvillkor för ett avsett OpenAI-projekt. Lägg nyckeln endast i serverns hemlighetshantering. Dokumentera vad som fortfarande är `NOT_VERIFIED`; anta inte att ett ChatGPT-abonnemang betalar API-anrop. [8]
4. Efter uttryckligt tillstånd för API-test: använd en isolerad testmiljö och syntetiska dokument. Kontrollera exakt tokenräkning, strukturerade svar, outputgräns, tidsgränser, reservrutiner, ägarbyten, samtidiga jobb och omstarter. Testa samma dokument igen och verifiera att ingen ny generering sker.
5. Utvärdera representativa, separat godkända eller tillräckligt anonymiserade dokument mot manuellt verifierat facit. Mät fältfel, felaktiga godkännanden, konflikter, behov av granskning, latens och verklig kostnad. Resultatet måste motivera profilvalet; syntetiska kodtester räcker inte för kvalitetspåståenden.
6. Fyll endast de beslutade ägar- och organisationskopplingarna, godkännande-ID, profil och budgetar. Sätt godkännandeflaggorna till `true` först när motsvarande beslut finns. Sätt `OPENAI_INVOICES_ENABLED=true` sist och endast i den godkända miljön.
7. Följ de första godkända körningarna och stäm av reservationer, tokenanvändning, fel och fakturering. Behåll samtliga AI-kandidater i manuell granskning.

Inga steg som skickar data, använder en nyckel, ändrar projektinställningar eller aktiverar funktionen har utförts genom att detta dokument skapats.

## Stopp och återgång

Sätt `OPENAI_INVOICES_ENABLED=false` på servern och stoppa nya AI-jobb. Vid misstänkt nyckelkompromettering ska nyckeln återkallas i projektet. En avstängning kan inte återkalla data som redan sänts eller säkert avbryta leverantörens pågående behandling. Behåll reservationer och kvitton för felsökning och kostnadsavstämning; originaltolkning och manuell granskning är återgången.

## Läsbar projektinventering

Verktyget `scripts/openai-invoices-inventory.mjs` gör endast läsanrop. Utan `--network` görs inga nätanrop. Med en separat, betrodd servernyckel kan modellistan hämtas:

```sh
node scripts/openai-invoices-inventory.mjs --network --output /skyddad/sokvag/modeller.json
```

Flaggan `--costs` begär dessutom historiska kostnader för exakt `OPENAI_PROJECT_ID`, med en separat `OPENAI_ADMIN_KEY`. Administrationsnyckeln hör endast hemma i en skyddad körning av inventeringsverktyget. Ingen adminnyckel behövs för fakturatolkning. Verktyget summerar ett avgränsat historiskt intervall; det verifierar inte förbetalt saldo eller projektets hårda utgiftsgräns. Saknade nycklar och otillgängliga svar ger `NOT_VERIFIED`, aldrig ett påhittat nollsaldo.

[Projektåtkomstrapporten](project-access-report.json) skapades genom faktisk körning utan tillgängliga nycklar. Se [benchmarkprotokollet](benchmark-protocol.md) för fyrarmsjämförelse, fryst facit och den separata beständiga budgetjournalen vid betalda tester. Den enkla utvecklingsrubriken omfattar tretton registerfält och bevisar inte precision för alla mottagaruppgifter eller fakturarader.

## Officiella källor

Dessa dokumentationssidor öppnades och kontrollerades 2026-11-06. Produktpriser och villkor kan ändras; granska dem igen före aktivering. Hänvisningarna fastställer inte projektets behörigheter eller avtal.

1. [GPT-6 Luna – modell, funktioner och pris](https://developers.openai.com/api/docs/models/gpt-6-luna)
2. [GPT-6.1 Sol – modell, funktioner och pris](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
3. [File inputs – PDF och inline-data](https://developers.openai.com/api/docs/guides/file-inputs)
4. [Responses – räkna input-token](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count)
5. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
6. [Your data – lagring, datakontroller och regioner](https://developers.openai.com/api/docs/guides/your-data)
7. [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
8. [Separat fakturering för ChatGPT och API](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)
9. [Prompt caching – explicit läge utan brytpunkter och cache-skrivningspriser](https://developers.openai.com/api/docs/guides/prompt-caching)

Modellspecifik bildkostnadsformel för de två valda profilerna har inte verifierats tillräckligt för en egen exakt kalkyl. Använd den officiella tokenräkningen och observerad användning; anta inte att en äldre modells bildformel gäller. [7]
