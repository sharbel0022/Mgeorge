## 2026-11-06 — Agent 5: säkerhet, återställning och releasegrindar

[PR 66](https://github.com/sharbel0022/Mgeorge/pull/66), `feature/95-saas-readiness`, utgår från verifierad main `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. [Leveransrapport](docs/saas-readiness/README.md), [frysta verifieringsresultat](docs/saas-readiness/verification-results.md) och [riskregister](docs/saas-readiness/risk-register.md) beskriver den avgränsade säkerhetsleveransen.

Reproducerade brister är rättade i privat nyckelfil, dubbla sessionscookies, företagsbyte utan förväntad version och återställningens proveniens. Ny separat verifierare binder sparade releasekvitton till källa, scope, hashvärden och fullständigt resultat; åtta ytterligare kvittomotprov upptäcktes genom oberoende granskning och går från RED till GREEN.

Fryst kandidat `d2cad86a`, faktiskt testad PR-merge `bad0a67b`, har 112/112 fokusfall, 14/14 nyckelfilsfall på vardera Node 22/24, samlad säkerhetsacceptans 481/481 Node + 1 244/1 244 Sites samt full Node-kvalitet 3 113/3 113 i båda versionerna. Dessa sviter överlappar. Full slutstatus för aktuell PR-head ska läsas i PR:ns egna kvalitets-/säkerhetsjobb.

[Återställningsövningen](docs/saas-readiness/backup-recovery.md) verifierade 430 syntetiska original/185 567 855 byte, 27 tabeller och 22 negativa kontroller; isolerad restore och acceptans tog 3 080,262 ms. Ett separat prov återställde parsebara syntetiska PDF/PNG/CSV/XML/XLSX byteidentiskt. Simulerad RPO är 15 minuter och motsvarar inte en verifierad produktionskadens. Migrationstest bevarar ekonomisk data och originalmetadata efter upgrade/adoption/omstart och avvisar äldre obundna skrivningar.

Det tidigare produktionsbetyget ändras inte. Publik Node-drift med en enda administratörsidentitet får inte marknadsföras som fleranvändar-SaaS. Verklig identitetsingress, branch enforcement, nyckelhantering, backup/RPO/RTO, dataskydd och kommersiella bankavtal behöver separat acceptans. [Integrationsöverlämningen](docs/saas-readiness/integration-handoff.md) anger de två serverhunkarna och övriga gemensamma gränser. Ingen produktionsrelease eller verklig dataändring ingår i denna PR.

## 2026-11-06 — Agent 2: Gmail/OCR-kandidat i PR 67

[PR 67](https://github.com/sharbel0022/Mgeorge/pull/67) bygger på verifierad main f3c80629d4856c2f8ecbb1ed81be391a13ac6be8. Kandidaten ger bounded Gmail-deduplicering och korrelerbara schemakvitton, OCR-heartbeats/receipt-protokoll, återhämtning från tidiga avbrott, separata felklasser och ändliga återförsök. [Leveransrapport](docs/automation/document-automation-reliability.md), [kontrakt och återhämtningsplan](docs/automation/recovery-runbook.md), [färska driftobservationer](docs/automation/observations-2026-11-06.json).

Sammanfogad lokal fokuskontroll: Node 223/223 och Sites 341/341, 0 fail/cancel/skip/TODO. Rena fullständiga kvalitets-/säkerhetsgrindar på slutlig PR-kandidat redovisas i PR:s check-kvitton; tidigare kandidatjobb ersätter inte aktuell verifiering. Oberoende granskning reproducerade och ledde till rättningar av falska klientmarkörer, transient heartbeat-förlust, förlorad recovery-CAS och strömlimit.

Status 23:18 UTC: 427 granskning, 47 OCR, 4 PDF, 60 färdiga i framflyttat 24-timmarsfönster. Ett faktiskt OCR-schemajobb 22:27 gav 6/0 på main, men regelbunden kvartskörning är inte styrkt. Gmail 23:00 gav åter no_update utan nytt automatiskt appkvitto. Ingen produktion eller verkliga scheman ändrades; ingen massbearbetning eller deployment genomfördes. AI-modelladaptern är orörd.

**Poäng oförändrade:** senaste konservativa bedömning 258,5/330 = 7,83/10. Berörda områden 6, 9–14, 24, 28, 30, 32–33 får nya syntetiska bevis, inte en automatisk höjning eller nytt produktionsgodkännande.

## 2026-11-06 — OpenAI-kandidaten ger inga nya kvalitetspoäng utan oberoende mätning

[PR 64](https://github.com/sharbel0022/Mgeorge/pull/64) tillför skyddad AI-tolkning och reproducerbar modellutvärdering. Den konservativa poängbedömningen **258,5/330 = 7,83/10** ändras inte. Enhets-/integrationstester för schema, ekonomi, företagsspärrar, kostnad och återförsök visar andra egenskaper än verklig optisk extraktionsprecision.

Projektets API-modelltillgång, faktureringskrediter, OpenAI-latens/kostnad per faktura och oberoende fyrarmsjämförelse är **NOT_VERIFIED / NOT_MEASURED**. Ingen förbättring i recall, precision, kompletta fakturor eller granskningsbehov tillgodoräknas. Historiska oberoende OCR-prov och utvecklingsreplayer nedan behåller sina ursprungliga populationer och begränsningar. AI för kunddokument förblir avstängd och alla AI-förslag kräver granskning.

## 2026-11-06 16:20 UTC — Site 68 verifierad, separat kombinerad slutkandidat

PR 61 är normalt mergad till `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`. Full PR-kvalitet, separat säkerhetsacceptans och separat main-CI är gröna för samma källträd. Site **68** publicerades från exakt motsvarande Sites-träd och är avgränsat kontrollerad efter release. [Releasekvitto](docs/completion/release-site68.md).

Aktuell konservativ bedömning är **258,5/330 = 7,83/10**, 27/33 minst 8; målet 314/330 är inte uppnått. [Samtliga 33 kriterier med bevis och risker](docs/completion/final-33-assessment.md). De två oberoende OCR-förstaproven bevaras separat: 37,50 % recall i första kohorten med dokumenterade populationsbegränsningar; 57,41 % i separat giltig SEK-kohort. Ingen normalfaktura blev fullständig eller grön i något av proven.

En separat granskningsbar worker-/standardetikettkandidat på `feature/final-95-completion` har frysta RED/GREEN-kvitton, 574/574 Node- och 464/464 Sites-fokusfall samt 120/120 oberoende aliasprov. Dess granskade käll- och testträd är byteidentiska med `100f9c3015da34f772ea0cba53d9871e978ebeab`. **Ny full PR-/main-CI och ny Sites-publicering återstår.** Tidigare grönt räknas inte för den nya koden. Den enda utvecklingsreplayen 62→66/108 avser en mellanversion, inga nya optiska anrop och ingen självständig slutacceptans.

Swedbank kräver fortfarande giltig återanslutning; Bankgiro är `SOURCE_NOT_CONFIGURED`. Gmail-tillfällena 15:00 och 16:00 gav `no_update` utan appdispatch. Periodisk OCR har ett tidigare 6/0-kvitto från 10:44, medan 15:05 var CI-triggad. Den riktiga backupen täcker sitt frysta manifest på 430 original. Inga osäkra kunddokument har massgodkänts och inga finansiella allokeringar skapats. [Samlad rapport](docs/completion/final-integration-report.md).

# QUALITY-SCORECARD — MG Fakturakoll, 33 kvalitetsområden

## Pågående slutförandeverifiering — 2026-11-06 14:28 UTC

Den nya integrationen har återstående fulla CI- och publiceringsgrindar. Föregående publicerade bedömning är **257,5/330 (7,80/10)**; inget nytt totalbetyg eller 9,5-anspråk följer av riktade tester. [Färsk baslinje](docs/completion/baseline.json), [OCR/Gmail-rättningar och mätgräns](docs/completion/ocr.md) och den senaste posten i [PROGRESS](PROGRESS.md) beskriver den pågående kandidaten.

Känd utvecklingsreplay är nu 74/100 obligatoriska OCR-fält med 0 felvärden, men inget nytt oberoende 85/98-prov har ännu slutförts. Den aktuella verkliga bankanslutningen är fortfarande spärrad, Bankgirokälla saknas och timschemats faktiska Gmail-dispatch är inte verifierad. De 33 slutliga betygen ska omprövas efter exakt CI och produktionskontroll, med dessa begränsningar kvar synliga. Daterade bedömningar nedan bevaras som historik.

## Aktuell bedömning efter Site 66 — 2026-11-06

Uppdaterad drift- och utvecklingsevidens 06:21 UTC: Site 66 är fortfarande publicerad. Huvudgren `237dd45e` underkändes i ett Node-startup-prov; PR 60:s första kandidat har 7606/7606 men stoppades av ett oberoende P2-fynd i testets avbrottsstädning. Version67 är sparad från exakt native-källa som source-only-reservväg efter att arkivuppladdningen stoppats av otillgänglig exekveringsmiljö; den är inte publicerad. Dessa utvecklingsresultat ersätter inte produktionsbetygens källbindning nedan. Se [PR 60](https://github.com/sharbel0022/Mgeorge/pull/60) och [oberoende granskning](https://github.com/sharbel0022/Mgeorge/tree/819bc206f7c21c0f6f8ce0a490c36fbfb4047579/docs/quality8/startup-independent-review-20261106).

**28/33 områden har stöd för minst 8/10. Alla 33 är ännu inte klara.** Summa 257,5/330, medel 7,80. Målet gäller varje rad. Samtliga numeriska betyg är oförändrade i denna leverans.

Site 66 är publicerad från main `0035ea89ef3cd60f0924f901503cad00d1ab1fca` efter exakt **7569/7569** godkända obligatoriska tester och genomfört bygge. [Leveranskedja](docs/quality8/release-wave4.md), [maskinläsbara 33 rader](docs/quality8/current-33-assessment.json), [verkliga efterkontroller](docs/quality8/wave4-postpublication-observations.json).

| Nr | Område | Nu | Stöd / kvarstående krav |
| --- | --- | ---: | --- |
| 1 | Design | 8 | Berörda vyer kontrollerade lokalt och publicerat i separat demo. |
| 2 | Startsida | 8 | Levererad källpolicy; preliminär översikt och noll verifierat vid saknat underlag observerat. |
| 3 | Navigation | 8 | Publicerad sökning→ArrowDown/Enter→Escape återställer sökfokus. |
| 4 | Mobil | 8 | 25/25 lokala geometrier vid fem bredder; samma CSS/Sites-träd publicerat. |
| 5 | Sök/filter | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 6 | Minimal manuell hantering | 6,5 | Site 66: ett ägt normalunderlag återköades en gång genom den vanliga spärrade övergången och väntar på OCR. Två fullständigt lästa registreringsrader är oförändrade; inget nytt registreringskvitto. Ekonomiska läsningar behåller revision 52 och noll nya bokningar. |
| 7 | Kundfakturor | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 8 | Leverantörsfakturor | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 9 | PDF | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 10 | Bild-OCR | 6,5 | Första V2 är fortsatt underkänt. Levererad parser har känd lagrad PSM3-replay 57/100 mandatory, 79/130 All13. Separat opublicerad c5-kandidat fick i en auktoriserad känd optisk utvecklingsrunda 69/100 mandatory och 91/130 All13, 0 FP, 12 worker- och 24 parseranrop utan körfel. Recallkravet 85% nås inte; V3 är fortfarande förseglad. |
| 11 | Gmail | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 12 | Automatisk registrering | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 13 | Dubbletter | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 14 | Dokumentgranskning | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 15 | Swedbank | 6,5 | Site 66-revalidering avvisad: sparat null-usage och aktuellt utelämnat usage. Ett detaljförsök gav DETAILS_PROVIDER_UNAVAILABLE utan verifierad usageklass; ingen aktivering. |
| 16 | Automatisk bankhämtning | 6,5 | Ingen ny lyckad behörig bankhämtning efter 2026-11-05 08:05 UTC. |
| 17 | Bankgiro-import | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 18 | Verklig betalare | 8 | Ägt verkligt rapportoriginal och exakt läsvy bevarar angiven betalare; saknad AIS-betalare förblir okänd. |
| 19 | Verklig OCR/referens | 8 | Verklig explicit rapportreferens bevaras som generell referens; ingen formell OCR eller AIS-referens hittas på. |
| 20 | Automatisk matchning | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 21 | Delbetalning | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 22 | Överbetalning | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 23 | Flera fakturor per betalning | 8 | Granskad explicit vektor publicerad; ingång/demo-spärr observerad; inga QA-allokeringar. |
| 24 | Historik | 8 | Historisk registrering skiljs från aktuell verifiering i publicerad detalj. |
| 25 | Betalstatus | 8 | Publicerad översikt/detalj behåller registrerat saldo och stoppar falskt verifierad visning. |
| 26 | Kontrollera alla betalningar | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 27 | Mejlförslag | 8 | Befintliga relevanta regressionsgrindar bevarade och godkända på exakt levererad main; se oberoende bedömning och releasekvitto. |
| 28 | Schemaläggning | 6,5 | Tidigare periodisk OCR-körningen 42153093698 gav 6 behandlade och 0 fel. Gmail-schematillfällena 05:00 och06:00 gav no_update utan ny verifierad appinvokering; senaste lyckade hämtning är 04:06. Ordinarie 07:00-körning har en återläst engångsinstruktion om körkvitto. Backupens nya budget är fortfarande inte prövad automatiskt från ofärdig snapshot. |
| 29 | Backup | 8 | Snapshot 768fde9a-27a2-4b85-b85a-278239ec4aea: 430/430 original kopierade och kontrollästa, 185 567 855 byte i båda stegen, manifest_pass och verifiering slutförd 2026-11-06 00:48:58 UTC; separat slutstatus 00:49:04 UTC. |
| 30 | Säkerhet | 8,5 | Exakt full CI/audit och negativa säkerhetsgrindar godkända;8 moderate utvecklingsfynd kvarstår. |
| 31 | Katastrofåterställning | 8 | Isolerad återställning med riktig kod; lokalRTO 3,417 s och simuleradRPO 15 min, inte produktionsåterställning. |
| 32 | Kod/tester | 8,5 | Exakt main `0035ea89`ea89: 7569/7569 obligatoriska tester, 0 fail/cancel/skip/TODO; alla 16 grindar och verkligt Sites-bygge passerade. Samma Sites-träd publicerat som Site 66. |
| 33 | Verklig produktionsverifiering | 8 | Exakt main `0035ea89`ea89 till Site 66; verklig avvisad bankrevalidering med bounded detaljförsök, nio nya Gmail-importer, köprogress till OCR, tidigare periodisk OCR 6/0 och verifierad 430-filssnapshot. Två kompletta ekonomiska före-/efterläsningar efter normal bearbetning behåller revision 52, noll bokningar och alla uppgifter/spärrar utom kontrolltid. |

Återstående under 8: **6, 10, 15, 16 och 28**. Bankens faktiska usageklass är ännu okänd. Registreringskedjan behöver ett riktigt normalt slutkvitto, OCR behöver ett fryst oberoende förstaprov och de korrigerade schemainstruktionerna behöver faktisk automatisk verifiering. Dagens kompletta backup är ingen provkörning av budgeten från ett ofärdigt läge. Äldre daterade underlag nedan behåller sin historiska omfattning.

## Tidigare daterade bedömningar

## Agent 7 — avgränsade SaaS-säkerhetsbevis, 2026-11-04

[Aktuell säkerhets- och acceptansrapport](docs/integration/saas/security-acceptance.md) kompletterar evidensen på `feature/saas-security-acceptance`. **Före och efter: 255/330 =7,73/10; 0/33 ≥9,5.** Inga numeriska poäng höjs för syntetiska tester eller för en ännu inte integrerad företagsmodell.

| Område | Före | Efter | Nytt bevis | Kvarstående gräns |
| --- | ---: | ---: | --- | --- |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | RED/GREEN för sekretess i banktransportlogg, 8 KiB-login och 16 MB faktisk multipartbudget. 15 A/B/C-ownerprov med sex riktade IDOR-/bilageangrepp, original, kryptering och banklås. | CompanyMembership/RBAC, ny corporate-consent, origin-/certifikatdrift, nyckelrotation, retention och avtal kräver uttrycklig acceptans. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | Fokuserad acceptans 480/480 med maskinläsbart kvitto; separat testmiljö, nätverksspärr, fixerad CLI-flaggordning och SHA-låsta Actions. Slutliga helgrindar och oberoende review redovisas i rapporten. | Befintlig lintskuld kvarstår. Aktuell lokal audit har 8 moderate Sites-fynd, 0 high/critical; inga beroenden ändras i denna PR. |

Tillståndsfrågor, GDPR-rollfördelning, leverantörsavtal och produktionsåterställning får inga godkännandepoäng från denna delleverans. De tidigare daterade produktionskvittona nedan behåller sin historiska omfattning.

## Agent 3 — avgränsad företagsmedgivandeverifiering, 2026-11-04

[Bank consent-kontrakt och verifieringskvitto](docs/integration/saas/bank-consent.md) gäller utvecklingsbranchen `feature/saas-bank-consent` från `14a042a`. Alla 33 poäng behålls: **255/330 = 7,73/10; 0/33 ≥9,5**. Syntetiska regressionsprov och oberoende kodgranskning ersätter inte bankens faktiska företagsbehörighet eller produktionsacceptans.

| Berört område | Nytt avgränsat bevis | Kvarstående gräns |
| --- | --- | --- |
| 15–16. Bankanslutning och hämtning | Företags-/användarbunden engångscallback, aktuella läsrättigheter, explicit kontoval, giltighet vid databascommit och säker förnyelse/frånkoppling. | Ingen faktisk SCA-/BankID-resa eller ny produktionsanslutning har körts. |
| 17. Bankgiro | Saknat Bankgiro-scope avvisas uttryckligen; kontokontrollen läser inga konton utanför företagets verifierade omfång. | Separat rapportbehörighet och verklig bankstyrkt företags-/Bankgirorelation krävs fortfarande. |
| 30. Säkerhet och åtkomstkontroll | State/cookie/CSRF/replay, samtidiga callbacks, företagsunderlag, återkallad åtkomst och osäkra återkallelser har konkreta regressioner. | Basen har en ägararbetsyta. Agent 1:s riktiga medlemskaps- och rollmodell måste integreras före flerföretagsdrift. |
| 32. Kodkvalitet och tester | Gemensamma rena validatorer, verkliga HTTP-/SQLite-/D1-tester och rättade oberoende granskningsfynd. | Slutliga exakta kommandon/resultat redovisas i integrationskvitto; inga poäng höjs enbart för testantal. |
| 33. Produktion | Utvecklingsbranch och PR är avsedda för samordnad granskning. | Ingen merge, publicering, produktionsmigration, verklig bankhämtning eller ändring av externa scheman. |
## SaaS Agent 4 — avgränsad Bankgiroberikning, 2026-11-04

[Verifieringsrapport och leverantörsmatris](docs/integration/saas/bankgiro-enrichment.md), branch `feature/saas-bankgiro-enrichment`, bas `14a042abd37fa455d08da9dfcc096ef4f603b512`. **Samtliga 33 numeriska poäng är oförändrade: 255/330 = 7,73/10; 0/33 ≥9,5.**

| Berörda områden | Nytt avgränsat bevis | Kvarstående gräns |
| --- | --- | --- |
| Bank, Bankgiro, individuella betalare och dubbletter | Dokumenterad Open Payments-modell, exakt beloppsnormalisering, separata källidentiteter, samlingsinsättningar, ofullständig täckning, återimport och konflikter testas med syntetiska data. | Verklig kundbehörighet, bankens individuella fälttäckning och fullständig historik har inte verifierats. |
| Ekonomisk korrekthet och fakturareferenser | Rapporter tillför inga extra ekonomiska insättningar. Gemensam bankreferens krävs; `0599`/`599`, generell referens, formell OCR och företagspolicy hålls isär. Ingen allokering sker vid import. | Det historiska 0599-fallet kräver fortfarande nödvändiga bankbevis och ett behörigt ekonomiskt beslut. |
| Åtkomstkontroll och original | Företags-/konto-/rapportbindning, aktuella scope, oföränderliga råsvar, kontrollsummor och separata behörighetskvitton verifieras vid intake och commit. | Integrering med SaaS-grundmodell och providertransport återstår före aktivering; nuvarande register är ägarbaserat. |
| Kodkvalitet och tester | Riktade positiva och negativa regressioner, fulla slutgrindar samt oberoende granskning redovisas med exakt omfattning i rapporten. | Lokal syntetisk framgång och dokumenterad leverantörskapacitet är inga produktionsbevis. |
## SaaS master integration candidate — 2026-11-04

Current inventory and limits: [integration matrix](docs/saas/INTEGRATION-MATRIX.md). Repaired foundation is now normally merged as mainf105e9c, with exact main CI41914833272 success (1649Node+3196Sites+47bridge=4892,0fail/skip/cancel/TODO). Below local figures retain their Windows scope; #36 cumulative integration follows separately. No new Sites publication or commercial activation. **All33 numeric scores remain255/330=7.73/10,0/33≥9.5.**

| Area | Before → after | New evidence | Remaining limit |
| --- | --- | --- | --- |
| 11 Gmail /28 scheduling | 7.5→7.5 /6.5→6.5 | Existing disabled schedule verified; obsolete OCR origin404 reproduced and repository variable corrected/read back without changing token or cadence. | No fresh successful fetch/OCR run; disabled schedule not silently enabled. |
| 15 bank /16 sync /17 Bankgiro | 8.5→8.5 /8→8 /8.5→8.5 | Seven frozen producer heads; exact original head CI; current AIS status connected, source absent. | Joint company/provider/source/worker integration pending; no new bank proof. |
| 24 history /29 backup /31 recovery | 8→8 /7.5→7.5 /5.5→5.5 | Synthetic originals-only admission/adoption and concurrent-write preservation; existing restore tests now run on Windows without EBUSY. | Latest362-file backup still verifying35; previous267-file manifest is not full current production recovery. |
| 30 security | 8.5→8.5 | 13 new RED/GREEN foundation cases; actor/company/version-pinned Node OAuth, atomic29-table admission; independent review READY. | Joined all-provider/role/worker acceptance pending; no production tenant activation. |
| 32 code/tests | 8.5→8.5 | Local Node1650/1641pass/9skip; Sites3196/3185pass/11skip,0fail; syntax142/types/build; audits0 production,8moderate Sites development. | Linux exact-head/main CI pending. Bridge is POSIX-only and fails required private-filesystem checks on Windows. |
| 33 real production | 6.5→6.5 | Two exact complete read-only observations at revision50: one economic deposit, zero allocations. | Scoped evidence only; broad reference search incomplete; no new deployment or real Sandbox proof. |

Other area claims and scores retain their existing scope; none is promoted by a synthetic result. The final integrated report will supersede this candidate checkpoint.

## Agent 1 — flerföretagsgrund, 2026-11-04

Egen branch `feature/saas-multitenant-foundation`, bas `14a042abd37fa455d08da9dfcc096ef4f603b512`. [Datamodell, migrering, rollback och verifiering](docs/integration/saas/multitenancy.md), [gemensamma kontrakt](docs/integration/saas/contracts.md) och [föreslagen version samt exakta fält till Agent 8](docs/integration/saas/agent-8-handoff.md).

Node använder en verifierad företagskatalog och separata SQLite-databaser; Sites behåller immutabla owner-namnrymder med transaktionsbundna behörighetsspärrar i D1. Aktuell medlemsroll, aktiv företagskontext, OAuth, bakgrundsjobb, original och återställning kontrolleras genom hela kedjan. Nya företag får neutrala inställningar och egen referenspolicy. Befintliga data adopteras endast genom en separat betrodd operation med explicit verifierad ägarrelation, aldrig genom en klientskickad företagsidentitet.

Slutliga lokala helsviter: **1 633 Node + 3 190 Sites + 47 bridge = 4 870 godkända**, noll fel/överhoppade/avbrutna/TODO. Syntax, TypeScript, låsta installationer, exakt minimatch-kontroll, auditgrindar och Sites produktionsbygge godkända. Root/Sites produktionsberoenden/bridge har noll auditfynd; full Sites-audit har åtta moderate utvecklingsfynd och inga high/critical. Lokal Node är 24.22.1; exakt Node 22-verifiering sker i PR-flödets tre jobb. Oberoende review hittade ett återkallningsfel i worker-fallback; rättningen återverifierades med samma syntetiska reproduktion. Inga kvarvarande reproducerade Critical/Important-fynd inom granskad omfattning.

Ingen produktion, verklig bank/Gmail, extern schemaläggning, merge eller publicering ingår. Efter första företagsbindning får en äldre tenant-omedveten app inte återstartas mot samma databas. Verklig onboarding/ägarverifiering, medgivanden, worker-dispatch och produktionsacceptans återstår enligt integrationskraven. **Alla 33 kvalitetspoäng är oförändrade: 255/330 = 7,73/10; 0/33 ≥9,5.** Tidigare daterade kvitton nedan behåller sin historiska omfattning.

## Agent 2 — Open Payments corporate adapter, 2026-11-04

[Verifieringskvitto och integrationsgränser](docs/integration/saas/openpayments-adapter.md) samt [officiella API- och avtalskällor](docs/integration/saas/provider-capabilities.md). Leveransen är ett additivt adapterlager på `feature/saas-openpayments-provider`; inga produktionsfunktioner aktiveras. Samtliga 33 numeriska poäng förblir **255/330 = 7,73/10; 0/33 ≥9,5**.

Lokalt verifierad implementation `79f27f0`: **1 585 Node + 3 191 Sites + 47 bridge = 4 823 godkända**, noll fel/skip/cancel/todo. Syntax, typer, obligatoriska auditgrindar och bygge godkända; 8 moderate utvecklingsberoendefynd i Sites redovisas separat. Oberoende granskning bekräftar båda rättningarna. Exakt Node 22-PR-CI redovisas i leveransens PR och ersätts inte av lokala Node 24-resultat.

| Berört område | Före | Efter | Nytt bevis | Kvarstående gräns |
| --- | ---: | ---: | --- | --- |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Befintlig Enable Banking-kod och dess regressionssviter bevaras. Ny banklista hämtas via dokumenterat ASPSP-kontrakt. | Ingen faktisk företagskontotäckning hos Open Payments verifierad. |
| 16. Automatisk bankhämtning | 8 | 8 | Företags-/providerbundna medgivanden, tokenhantering, tidsgränser, paginering och återkontroll av giltighet. | Adapter är inte kopplad till produktionsschema eller beständig företagsmodell. |
| 17. Bankgiroimport | 8,5 | 8,5 | Bankgiroobservationer bevaras separat från bokförda rader; saknat stöd blockerar ett uttryckligt Bankgirokrav. | Verklig ISO/BGI-onboarding, täckning och granskad originalimport saknas. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Scope-/vägspärrar, befintlig AES-GCM med företagsbundet ändamål, säkra fel och certifikat-/nyckelkontroller. | Beständig medlemskapskontroll, engångscallback och verkligt produktionscertifikat ska integreras och verifieras. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | Nya kontrakts-, fel-, isolerings- och transporttester. Två oberoende reviewfynd reproducerade, rättade och omkontrollerade. | Fixtureframgång är inte sandboxacceptans. Befintliga moderate utvecklingsberoendefynd och lintskuld åtgärdas inte av denna PR. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Exakt gräns mellan dokumentation, lokala tester och externa behörigheter redovisas. | Ingen Open Payments-sandbox, riktig bank, produktionshandshake eller publicering genomförd. |

## Agent 5 — SaaS-synk och avstämning, avgränsad verifiering 2026-11-04

Branch `feature/saas-bank-sync-reconciliation`, bas `14a042a`. [Kontrakt och fullständigt verifieringskvitto](docs/integration/saas/sync-reconciliation.md). **Alla 33 numeriska poäng förblir 255/330 = 7,73/10; 0/33 ≥9,5.** Nya syntetiska teknikbevis höjer inte produktionsberoende poäng. Följande berörda områden behåller uttryckligen sina före-/eftervärden; övriga områden och äldre leveransers driftbevis är oförändrade.

| Berörda områden | Före | Efter | Nytt avgränsat bevis | Kvarstående gräns |
| --- | ---: | ---: | --- | --- |
| 7 Kundfakturor; 13 Dubblettkontroll; 14 Dokumentgranskning | 8 | 8 | Företagets policy härleds från bevarade original; atomiska importkvitton och konflikter bevarar accepterat underlag genom omstart. | Ingen automatisk reparation av äldre kunddata eller verklig originalinventering. |
| 15 Bankanslutning; 17 Bankgiroimport | 8,5 | 8,5 | Exakt företag/konto/medgivande, samma konto efter förnyelse och separata AIS-/Bankgirobevis. Saknad källa förblir otillgänglig. | Verkliga behörigheter, konto-/rapportrelationer och Agent 4:s företagsbundna källa måste integreras. |
| 16 Automatisk bankhämtning | 8 | 8 | Aktuellt medgivande även före allokering, beständiga anropsreservationer, lång/okänd 429-spärr, sena svar och återförsök. | Verifierade faktiska bankkvoter krävs; applikationskvoter över separata databaser kräver delad providerbegränsare. |
| 18 Verklig betalare; 19 Verklig OCR/referens | 7 | 7 | Företag A/B/C, exakt referens med inledande nollor, separat OCR och fel kund/konto hålls isär. | Syntetiska svar styrker inte verklig betalaridentitet eller saknad rapporttäckning. |
| 20 Automatisk betalningsmatchning; 23 Flera fakturor i en betalning | 7,5 | 7,5 | Befintliga bevis-/beloppsregler återanvänds; samlingsinsättning och två rapporter skapar inte extra pengar. | Faktisk automatiserad kundacceptans och fullständiga bank-/rapportbevis återstår. |
| 21 Delbetalningar; 22 Överbetalningar; 24 Betalningshistorik; 25 Betalningsstatus; 26 Utebliven betalning | 8 | 8 | Osäker del-/överbetalning allokeras inte; verifierat exakt restsaldo kan matchas. Original, audit och bokade saldon bevaras vid spärr/återkallelse. | Ingen ny produktionsallokering eller full historisk omverifiering. |
| 28 Automatiska scheman | 6,5 | 6,5 | Befintlig scheduler, 100 isolerade syntetiska företag under parallell körning och 101 riktiga lokala SQLite-företagsdatabaser med rättvis fortsättning efter omstart. | Betrodd företagsregistrering och verkliga schemakvitton saknas i denna avgränsade leverans. |
| 29 Säkerhetskopiering | 7,5 | 7,5 | Alla fyra nya tabeller ingår; exakta äldre 20/22-tabellformat accepteras utan att aktivera företag. | Ingen ny produktionsbackup-/offsite-verifiering. |
| 30 Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Exklusiv databas/ägarscope, beständiga skrivstängsel och spärrade legacyvägar; oberoende reproducerat återkallelsefynd rättat. | Agent 1:s medlemskapsintegration och bred produktions-/penetrationsacceptans återstår. |
| 31 Katastrofåterställning | 5,5 | 5,5 | Isolerad återställning bevarar kvoter/spärrar/kvitton och ogiltigförklarar fångade leaser; migration/schema/journal jämförda. | Ingen tjänsteaktivering, produktionsrestore eller verklig RPO/RTO-övning. |
| 32 Kodkvalitet och tester | 8,5 | 8,5 | 1 704 Node + 3 207 Sites + 47 bridge = 4 958 pass, 0 fail/skip/cancel/todo; syntax/typer/audits/exakt mitigering/separat bygge godkända. Oberoende review och felaktiga försök redovisas. | Lokal Node 24 är inte Node 22-CI. Åtta moderate utvecklingsfynd och tidigare lintskuld kvarstår; inga paket ändras. |
| 33 Verifiering i verklig produktion | 6,5 | 6,5 | Egen branch och PR är leveransgränsen; verkliga bankanrop och driftsättning ingår inte. | Ingen ny produktionscertifiering eller Sites-publicering. |

Exakt commit och Node 22-workflow redovisas i PR. Root-/bridge-audit har 0 fynd; Sites high-grind passerar med 8 moderate och 0 high/critical. Testgrupper överlappar helsviterna och adderas inte en andra gång. Den konkreta integrationen kräver en Node-databas eller Sites-arbetsyta per företag samt betrodda, aktuella medlemskaps-/provider-/Bankgirokontrakt.

## Automatic Bankgiro source readiness — 2026-11-03

[Current readiness report](docs/BANKGIRO-AUTOMATIC-SOURCE-READINESS.md) covers the new normalized HTTPS transport, isolated pinned SFTP bridge, trusted registration/revocation, durable receipts and existing-scheduler integration. Final local **1565 Node +3121 Sites +47 bridge =4733 pass**,0fail/skip/cancel/todo; types/syntax/audits/build and independent review pass. Bridge also verified on exact Node22.13.0. Ordinary PR34 merged runtime main c367fcd; exact PR/push/main CI passed all three jobs. Sites60 succeeded, source0b0aa755/tree145fe442 match approved main. Read-only postchecks confirm source absent/queue empty and selected economic counts1+0/zero allocations. Delayed postcheck observed Gmail schedule disabled externally; no schedule update was invoked, and this drift is documented in the report. Real source configuration/authorization/profile and production fetching remain absent. **All33 scores remain255/330=7.73/10,0/33≥9.5**; no production score increase is inferred from synthetic success. Earlier dated sections below retain their historical scope.


## Combined seven-agent delivery — current receipt

[Final delivery and exact receipts](docs/MGEORGE-SEVEN-AGENT-FINAL-DELIVERY.md) supersede earlier pending-delivery observations. All six producer implementations are merged with their histories through PR27/31; PR32 fixes selected-proposal display. Runtime main `93312189b52fc651a3ccc659272041282b937f03`, exact main CI41550351322: **1563 Node + 2980 Sites = 4543**,0fail/skip/cancel/todo; guarded types/audits and production build pass. **Sites59 succeeded**, source503448c, exact Sites subtree97b5de1; runtime9, auth/bindings/three schedules preserved. Selected0599 remains revision43 with zero allocations; backup267/267 verified. Gmail00:00UTC run completed, but fresh unattended cloud OCR remains unverified. **All33 numeric scores remain255/330=7.73/10,0/33≥9.5**. Real Bankgiro authorization, account/deposit proof, physical/authenticated browser acceptance and complete production recovery remain external or separately unverified limits. The following dated producer sections retain their historical scope.


## Agent 2 — avgränsat bankbevis, 2026-11-02

Ny separat leverans på `feature/mgeorge-swedbank-account-evidence`, [PR25](https://github.com/sharbel0022/Mgeorge/pull/25), integrationbas `a779b0d`. [Verifieringsrapport](docs/integration/agent-2-swedbank-verification.md) skiljer syntetiska tester, slutgrindar och kvarstående extern evidens. Inga numeriska poäng ändras; alla33 områden ligger kvar på **255/330 = 7,73/10**.

| Berört område | Före | Efter | Nytt bevis inom Agent 2 | Kvarstående gräns |
| --- | ---: | ---: | --- | --- |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Aktuell bank/SE/business/medgivandetid, ägarbundet kontocensus och exakt bankstyrkt alias testas; ett versionerat identitetskontrakt tillkommer. | Verkliga tillgängliga kontofält, bankgirokoppling och förnyad produktionsåtkomst är inte verifierade av syntetiska svar. |
| 16. Automatisk bankhämtning | 8 | 8 | Node import/checkpunkt/audit/jobb commit är atomisk; Sites behåller okänd spärr även efter avbruten resultatlagring eller synkframgång. | Ny produktionsexekvering och full tillgänglig historik behöver separat auktoriserat kvitto. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Befintligt ägarlås och skrivstängsel skyddar väntande anrop. Fälthämtare/proxyer och klientuppgifter kan inte skapa providerbevis eller häva spärren. | Ingen ny penetrationstest, produktionsmigration eller automatisk lösning av okända äldre spärrar. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | Oberoende reviewfynd reproduceras och rättas med regressionsprov i kontoläsning, synk och detaljhämtning. Exakta slutgrindar finns i rapporten. | Befintlig lintskuld och16 moderate utvecklingsberoendefynd kvarstår; lokal Node24 ersätter inte exakt Node22 PR-CI. |

Övriga områdens bedömningar och tidigare publiceringsbevis nedan behåller sin angivna historiska omfattning. Ett verifierat kontoalias ger ingen separat Bankgirorelation eller rätt att allokera en betalning.

Exakt Agent2-implementationshuvud04667ef, [CI41536046223](https://github.com/sharbel0022/Mgeorge/actions/runs/41536046223): **1 327Node +2 497Sites =3 824pass, 0fail/skip/cancel/todo**, båda jobb success. Lokala miljö-/testavvikelser redovisas öppet i rapporten; inga poäng höjs och inget produktionsbevis tillskrivs dessa syntetiska tester.
## Agent 5 — avgränsad jobb- och återhämtningsverifiering, 2026-11-02

Branch `feature/mgeorge-automation-orchestration`, integrationsbas `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`. [Exakta ändringar, tester och begränsningar](docs/integration/agent-5-automation-orchestration.md). Samtliga 33 poäng är oförändrade: **255/330 = 7,73/10; 0/33 ≥9,5**. Följande avgränsade teknikbevis kompletterar den tidigare bedömningen; de ersätter inget produktionsbevis.

| Berörda områden | Nya faktiska bevis | Kvarstående gräns |
| --- | --- | --- |
| 10–14: OCR, Gmail, automatisk registrering, dubbletter och dokumentkö | Nya regressionsfall för sena timeout-/fel-/OCR-svar, samma lease med flera svar, återstart och bibehållet accepterat underlag. Gmail och registrering går genom befintliga gränser. | Syntetiska original och styrda arbetare; inget nytt verkligt schema- eller OCR-körkvitto. |
| 15–17 och 28: bankhämtning, Bankgiro och scheman | Beständig 429-spärr även för manuella försök, separat senaste försök/resultat, generation och tidsbegränsad lease, atomiska bankkvitton och återläsning efter förlorat commitsvar. Ägarbunden statusläsning och spärrad Bankgiroförberedelse. | Verklig Bankgirokälla och C2/C3-integration saknas ännu. Ett generiskt OAuth-lås bevisar inte pågående synk. |
| 29: säkerhetskopiering | Ett reproducerat sent objektanrop kan inte ersätta ersättningsarbetarens verifierade ciphertext; verifierad kopia återanvänds och felaktig kopia stoppas. | Ingen ny full produktionsrestore, offsite-kontroll eller RPO/RTO-övning. |
| 30 och 32: åtkomstkontroll och kodkvalitet | Ägarfilter före DB-läsning, inga råa fel/leaseuppgifter i status, 77 nya fall och oberoende granskning. Slutliga fullsviter: 1 324 Node + 2 399 Sites, 0 fel/överhoppade/avbrutna; övriga grindar i leveransrapporten. | 16 ärvda moderate utvecklingsfynd kvarstår; full lint har inte omkörts eller åtgärdats i detta avgränsade uppdrag. |
| 33: verklig produktion | Skrivfri inventering styrker samma tre externa automations-ID i ChatGPT och Sites. | Ingen ny driftsättning eller real bank-/verksamhetsacceptans. Tidigare Sites57-kvitto förblir historiskt bevis för den tidigare leveransen. |
## Agent 6 — avgränsade frontendbevis, 2026-11-02

Poäng före och efter: **255/330 = 7,73/10; 0/33 ≥9,5**. [Agent 6:s rapport](docs/integration/agent-6-payment-ui.md) och [browseracceptans](docs/integration/agent-6-browser/README.md) kompletterar evidensen för design, mobil, tangentbord/fokus, sökning/filter, banköversikt, fakturareferenser, individuella betalare och granskningsstatus.

Fryst lokal kod passerar **1309/1309 Node + 2411/2411 Sites** samt **19/19 Chromiumfall** med fem faktiska bredder och hashbundna produktresurser. Syntaxkontroll av 121 filer, TypeScript, exakt minimatch-mitigering och high-auditgrindar är gröna. Separat produktionsbygge godkänt på samma frysta kod. Exakt leverans-SHA och Node 22-CI redovisas i PR:ns leveranskvitto. Inga verkliga bankfakta, fullständig rapportbehörighetskedja, fysisk mobil, skärmläsarprov eller ny inloggad produktionsacceptans påstås. 16 befintliga moderate utvecklingsfynd och tidigare lintskuld kvarstår. Inga numeriska områdespoäng ändras; Agent 6 publicerar inte Sites.

## Ny sjuagentsintegration — kontrakt och syntetisk kedja, 2026-11-02

[Aktuell rapport](docs/SEVEN-AGENT-INTEGRATION-REPORT.md) redovisar mergade kontrakts-PR #22 och regressions-/rapport-PR #23. Exakt slutlig #23-head-CI 41534249801 passerar **1 309 Node + 2 337 Sites = 3 646 tester**, inklusive alla sex nya namngivna 0599-fall, utan fel eller överhoppade/avbrutna tester. Integrationsmain före slutkvittot är `12c9868606a0a45b31b722ddee8f897541687e64`; separat main-CI finns i rapporten. De sex nya implementationerna, inklusive företagspolicy och BankgiroReportSource, väntar fortfarande på PR-leverans. Kontrakt och tester bevisar inte bankens verkliga behörighet, konto-/insättningsrelation eller ett nytt externt schemakvitto. **Samtliga 33 betyg är kvar på 255/330 = 7,73; förändring 0 och 0/33 på 9,5.** Alla före/eftervärden och aktuella test-/produktionsgränser dokumenteras. Äldre tabeller nedan behålls som detaljerad evidens/historik.

## Samordnad sex-PR-integration — 2026-11-02

Aktuell integrationsrapport: [SIX-PR-INTEGRATION-REPORT.md](docs/SIX-PR-INTEGRATION-REPORT.md). Före och efter **255/330 = 7,73/10; 0/33 ≥9,5**. Tabellen nedan ersätter äldre observationsbeskrivningar som aktuell bedömning, men bevarar deras historik. Inga poäng höjs för fler tester eller ett mål utan komplett acceptans. Exakt acceptansmain4d20b3e/Actions41524529308 och oberoende lokal körning: **1309Node+2331Sites=3640pass/0fail/skip**. **Sites57 succeeded**, identiskt Sites-källträd45761f430862a3ecbf31bbba2c2c116db7b210a0, runtime9, auth/bindningar/tre scheman bevarade; valda ekonomiska originalprojektioner43→43 lika. Autentiserad desktopresa och originalvisning verifierade. Viewportändringen slog inte igenom: faktisk1920px, ingen ny mobilacceptans. Gmail anslutet men nytt externt schema/cloudkvitto och full produktionsrestore kvarstår. Alla skrivtester använder isolerad syntetisk data; verkliga ekonomiska uppgifter läses endast.

| Nr / område | Före | Efter | PR | Nytt testbevis | Produktionsbevis och kvarstående risk |
| --- | ---: | ---: | --- | --- | --- |
| 1. Design och färger | 8 | 8 | 17 | CSS/kontrast, semantisk svartvit UI; fulla kumulativa CI-grindar. | Publicerad desktopbild inspekterad; fysisk hjälpmedelsacceptans saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 2. Startsida | 8,5 | 8,5 | 17 | overview/readiness/zero-unknown pengar; fulla kumulativa CI-grindar. | Inga nya bankbevis eller full produktionsacceptans. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 3. Navigering | 8,5 | 8,5 | 17 | workspace-location, fokus och Back/Forward; fulla kumulativa CI-grindar. | Fysisk enhet/screen reader återstår. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 4. Mobilanpassning | 8,5 | 8,5 | 17 | responsiva fokus-/dialogregressioner; fulla kumulativa CI-grindar. | Browseroverride behöll1920px: färsk mobil-/fysisk acceptans saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 5. Sökning och filtrering | 7,5 | 7,5 | 17 | normalisering, listpagination, stale epochs; fulla kumulativa CI-grindar. | Större representativ användaracceptans återstår. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 6. Minimal manuell hantering | 6,5 | 6,5 | 18/19/17 | Gmail PDF cross-flow; strikt parser; färre renderade rader; fulla kumulativa CI-grindar. | Okända motparter och svåra raster ska granskas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 7. Kundfakturor | 8 | 8 | 14/19/17 | strikta identiteter, aktuella betalningsbevis, lista; fulla kumulativa CI-grindar. | Verklig bank-/verksamhetsacceptans saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 8. Leverantörsfakturor | 8 | 8 | 18/19/17 | PDF/source/dedup/held supplier proposal; fulla kumulativa CI-grindar. | Ingen riktig registrering gjord för integrationstest. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 9. PDF-tolkning | 8 | 8 | 19 | frozen40text+9binary; faktisk permuterad PDF; fulla kumulativa CI-grindar. | Begränsad korpus och textmånader kvar. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 10. Bild-OCR | 7 | 7 | 19 | rasterprecision96,67%/recall70,73%; optical hold; fulla kumulativa CI-grindar. | Rasterförbättring och representativt facit saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 11. Gmail-anslutning | 7,5 | 7,5 | 18 | retry/kvot/OAuth/strömfel; aktuell status; fulla kumulativa CI-grindar. | Ny kod behöver nytt externt körkvitto. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 12. Automatisk fakturaregistrering | 8 | 8 | 18/19 | atomiskt granskningsarv, post-COMMIT kvitto, strikt motpart; fulla kumulativa CI-grindar. | Ingen massregistrering eller ny produktionsregistrering. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 13. Dubblettkontroll | 8 | 8 | 14/18/19 | hash/source race, stabil bank-ID, normaliserad BG-reservation; fulla kumulativa CI-grindar. | Riktiga ofullständiga original kräver fortsatt granskning. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 14. Dokumentgranskning | 8 | 8 | 18/19/17 | lease/restart/queue, A→B→A original, exakta förslag; fulla kumulativa CI-grindar. | Publicerad fakturadialog/original visad läsande; verkliga granskningsbeslut och full köresa återstår. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 15. Swedbank-anslutning | 8,5 | 8,5 | 16 | medgivande/fence/valt konto; lässtatus; fulla kumulativa CI-grindar. | Anslutning bevisar inte komplett tillgänglig historik. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 16. Automatisk bankhämtning | 8 | 8 | 16 | UTC/periodåterhämtning/429/checkpoint; invalid BOOK stop; fulla kumulativa CI-grindar. | Frisk sparad drift föregår publicering; nya återhämtningskoden saknar livekörkvitto. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 17. Bankgiroimport | 8,5 | 8,5 | 14/17 | XLSX integritet, alias, flera betalare, ny paddingregression; fulla kumulativa CI-grindar. | Bankens verkliga konto-/insättningsrelation saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 18. Identifiera verklig betalare | 7 | 7 | 14/17 | inga gissade alias; positiv aktuell allokering/evidens för etikett; fulla kumulativa CI-grindar. | Namn i rapport bevisar inte individuell AIS-betalare. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 19. Verklig OCR/fakturareferens | 7 | 7 | 14/19/17 | ledande nollor, typad källa, synlig PDF-geometri; fulla kumulativa CI-grindar. | Generell referens förblir skild från formell OCR. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 20. Automatisk betalningsmatchning | 7,5 | 7,5 | 14/16/19 | identitet/original/atomisk commit, invalid BOOK, strikt referens; fulla kumulativa CI-grindar. | Ingen verklig allokering auktoriseras av integration. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 21. Delbetalningar | 8 | 8 | 14 | historiskt medlemskap och exakt öresaldo; fulla kumulativa CI-grindar. | Produktionssaldo endast avgränsat läst. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 22. Överbetalningar | 8 | 8 | 14 | överskott och konkurrerande allokeringar bevaras; fulla kumulativa CI-grindar. | Ingen verklig återbetalning eller saldoskrivning. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 23. Flera fakturor i en betalning | 7,5 | 7,5 | 14/19 | hela rapportgrupper och exakta referensgränser; fulla kumulativa CI-grindar. | Verkligt sammanhållet bankfacit återstår. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 24. Betalningshistorik | 8 | 8 | 14/15/16/17 | replay, originalsamband, exact restore och UI; fulla kumulativa CI-grindar. | Full produktionsledger kan inte jämföras via trunkerad rad. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 25. Betalningsstatus | 8 | 8 | 14/17 | känd kontospärr hindrar ny falsk verifiering; bokat bevaras; fulla kumulativa CI-grindar. | 0599 fortfarande blockerat och oregistrerat. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 26. Kontrollera alla betalningar | 8 | 8 | 14/16/18/19/17 | hela kontroll/regressionskedjan; tydlig huvudknapp; fulla kumulativa CI-grindar. | Ingen skrivande produktionskontroll startad. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 27. Automatiska mejlutkast | 8 | 8 | 18/17 | äkta registreringskvitto och separata säkra lästillstånd; fulla kumulativa CI-grindar. | Varje kundmejl kräver separat godkännande; inget skickat. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 28. Schemalagd automatisering | 6,5 | 6,5 | 16/18 | beständiga cooldowns, observed-run kontra schema; fulla kumulativa CI-grindar. | Förepubliceringskvitto certifierar inte ny kod. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 29. Säkerhetskopiering | 7,5 | 7,5 | 15 | exklusiv arkivpublicering, kryptering/hash/original/WAL; fulla kumulativa CI-grindar. | Sparat195manifest är inte nytt fullständigt DR-prov. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | 15/16/18/14/17 | sessionallokering/rotation, lease/consent, original och aktuella alias; fulla kumulativa CI-grindar. | Hotmodell, OS-/ACL- och bred produktionsacceptans kvar. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 31. Katastrofåterställning | 5,5 | 5,5 | 15 | riktig isolerad SQLite evidence restore, kill/retry/kvittogrind; fulla kumulativa CI-grindar. | Produktionsarkiv/ursprungsnyckel/offsite/RPO/RTO saknas. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | 14–19 | oberoende granskning,3integrationsrättningar,exakt kumulativCI; fulla kumulativa CI-grindar. | 16moderate devfynd och lintskuld kvar. Se aktuellt begränsat driftkvitto i integrationsrapporten. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | 14–19 | skrivfria status/original/0599,publiceringskvitto separat; fulla kumulativa CI-grindar. | Ingen full real bank/OCR/DR-census eller universell9,5. Se aktuellt begränsat driftkvitto i integrationsrapporten. |

Testgrindar: Node check/test/audit; Sites exact minimatch/check/test/audit/build. Följande är **inte** certifierat av CI: verkliga bankrelationer, fysisk mobil, skärmläsare, representativ universell OCRprecision eller full produktionsrestore. Äldre tabellers paus-/stale-/versionsuppgifter är historik; färsk anslutnings-/köstatus i integrationsrapporten gäller nu.



## Backup och isolerad katastrofövning — avgränsad verifiering 2026-11-02

Arbete från `a9f88ae1c0f697376b3ecd140e1e80a64405125a` på `codex/backup-security-stabilization-20261102`. Denna uppdatering gäller enbart backup, återställning och den granskade säkerhetsgränsen. [Verifieringsrapport och körinstruktioner](docs/DISASTER-RECOVERY-VERIFICATION.md) redovisar fullständiga testresultat, granskning, kvarstående beroendefynd och driftbegränsningar. Leverans sker via separat PR; ingen automatisk merge eller parallell Sites-publicering.

| Område | Före | Efter | Nytt faktiskt bevis | Kvarstående gräns |
| --- | ---: | ---: | --- | --- |
| 29. Säkerhetskopiering | 7,5 | 7,5 | Privat, flushad och återverifierad Node-publicering; avbrott och konkurrerande vinnare; befintlig nyckel får inte tyst ersättas när arkiv finns. Sites export autentiserar varje snapshot/original och exakt manifest. | Ingen ny dekryptering av den verkliga backupen, oberoende offsite-kopia eller full strömförlustverifiering. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Nekade HTTPS-anrop skapar inte persistenta anonyma sessioner. Befintliga ägar-/OAuth-/MCP-/krypteringsgränser regressionstestade; produktionsberoendena har 0 auditfynd. | Begränsad kod-/mönstergranskning, inte full penetrationstest. 16 moderate utvecklingsposter och ESLint 9:s supportbrist kvarstår. |
| 31. Katastrofåterställning | 5,5 | 5,5 | Riktig isolerad SQLite-återställning med alla Node-tabeller respektive Sites 20 beständiga tabeller, exakta original, WAL, historik och återtagna länkar. Sites-verktyget använder separata `evidence_`-tabeller. | Syntetiska data. Ursprunglig produktionsnyckel, fullständig export, oberoende lagring och faktisk RPO/RTO-övning saknas; ingen tjänsteaktivering eller native Windows-verifiering. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | 1 083 Node + 1 973 Sites, 0 fel/överhoppade; syntax/typkontroll, separat bygge och oberoende granskning godkända. Riktiga filsystem-/SQLite-/HTTP-prov och negativa felinjektioner; granskningsfynd har regressioner. | Testutfall gäller rapporterad branch och miljö; scoped sviter överlappar helsviterna. Ett parallellt bygge avbröts, separat omtag passerade. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Skrivfri aktuell status: backup 195/195 filer, 63 463 280 bytes, sparat `manifest_pass`; runtime revision 9 och 26 tabellnamn observerade. | Historiskt statuskvitto bevisar inte en ny filkontroll eller återställning. 112 äldre API-poster saknar kvitto. |

**Inga numeriska poäng ändras.** Nya regressionsbevis stärker de avgränsade kontrollerna men ger ingen produktionscertifiering. Övriga områden och andra parallella uppdrags poäng lämnas oförändrade.

## Slutlig UI-granskning inför samordnad integration — 2026-11-02

[Rapport för samtliga 33 områden](docs/FINAL-33-AREA-QUALITY-REPORT.md) och [fullständig UI-inventering](docs/UI-COMPONENT-INVENTORY.md). Egen branch `codex/final-ui-quality-2026-11-02`, bas `a9f88ae`; inga ändringar av ekonomimotorer, provider-/OCR-/backupimplementationer. Faktura- och banklistor begränsas till 50 synliga poster, käll-/betalarevidens och laddnings-/felstatus förtydligas, sökning/fokus förbättras. Mätningar och exakta testgränser finns i rapporten.

Samtliga 33 områdespoäng ligger kvar på **255/330 = 7,73/10; 0/33 på 9,5**. Färsk autentiserad läsning gäller den redan publicerade startsidan, inte den nya branchen. Färsk responsiv browseracceptans för ändringarna saknas. Extra full lint redovisas som underkänd med kvarstående teknisk skuld; den döljs inte av gröna CI-grindar. Användarens samordningsregel gäller: egen branch och PR, ingen main-push, automatisk merge eller Sites-publicering under parallellt arbete.

## Avgränsad avslutsleverans 2026-11-02

Granskad minimatchbackport och analyslokalt betalarindex. Färska kontroller: Node1063tester/1055pass/0fail/8befintliga WindowsEPERMskip; Sites1912/1909pass/0fail/3Linux-onlyskip; syntax105, TypeScript, build, highaudit passerar, produktionsaudit0. Första rootkörningen hade27PDFworkerfel; full omkörning grön, exakt transientorsak ej styrkt. Samtliga33poäng kvar255/330=7,73 och0/33på9,5. Faktisk inloggad Chrome-läsvy/fem dialogbredder styrks nu; bank0599 fortsatt spärrad/revision42. Sites55 är tidigare driftversion, ny publicering och exakt main-CI återstår att verifiera.

[Senaste rapport](docs/MAINTAINED-RUNTIME-DELIVERY-REPORT.md). Ofärdig Sitesexport/offlinerestore är privat hashbevarad och ingår inte. Ingen fortsatt obemannad körning.


## Originalreferenser och avstämningskostnad – samtliga 33 områden, 2026-11-02

Bas origin/main `38769f2`/Sites54, verifierad fortsättning Sites55. Områdespoängen använder samma dokumentära modell som föregående kompletta bedömning: **255/330 = 7,73/10 före och efter; 0/33 på 9,5**. De höjs inte för att uppfylla målet. Nya testbevis stärker avgränsade kontroller; de certifierar inte hela området. **Verifierad leverans:** maincc2be7b/exaktActions41491162166 success, Sites55 succeeded med samma Sites-källträd, runtime9/revision42→42. **Historiskt verifierad leverans:** main2410e4b/Actions41480737514 success, Sites54 med samma källträd, runtime9/revision42. [Aktuell rapport](docs/ORIGINAL-REFERENCE-INTEGRITY-REPORT.md), [plan](docs/superpowers/plans/2026-11-02-original-reference-integrity.md), [specifikation](docs/superpowers/specs/2026-11-02-original-reference-integrity-design.md). [Föregående leveransrapport](docs/MGEORGE-FINAL-ENGINEERING-REPORT.md) och [kvitto](docs/MGEORGE-FINAL-ENGINEERING-DELIVERY.json) behålls som historik.

Testnycklar: **T1–T5** beskriver föregående verifierade cykels avgränsade kontroller: T1 sex uppladdningsfall; T2 samma117 text-/metadatafall per motor,103→117 korrekta/14→0 falskt gröna/47 positiva bevarade samt syntetisk PDF-autoregistrering; T3 restore Linux55/55 och Windows48/56 med åtta faktiska EPERM-filsymlänkfall särredovisade; T4 identitets-/kontospärr/refund och ordningsoberoende allokeringar; T5 lokal syntetisk Chromiumdemo320/390/768/1024/1440px, filter/dialog/fokus/XLSX-filväljare. Befintliga automatiserade regressioner ingår åter i T6; tidigare OS-/UI-/privatprov återanvänds bara för oförändrad prövad kod/omfattning. De är inga nya produktionsprov. **T6** färska rena root-/Sitesinstallationer, Windows Node1037:1029pass/0fail/8befintliga faktiska EPERMskip, Sites1845/1845, syntax104, TypeScript och produktionsbygge. Root-/Sitesproduktionsaudit0; full Sites16moderate utvecklingsfynd/highgrind passerar. **T10** exakt main-CI41491162166 påcc2be7b: Linux1036/1036Node och1845/1845Sites,2881pass/0fail/skip, båda jobb success. Sites55 publicerad från exakt samma Sites-träd.

**T7** samtidiga ägar-/hashbundna uppladdningar och Gmail:15nya fall,12RED→15GREEN, scoped243/243. **T8** verkliga syntetiska SQLite-/snapshot-/krypterade arkiv:40nya Node- och216Sitesreferensfall; riktat totalt Node88pass/8befintliga faktiska EPERMskip och Sites257/257. Kända aktuella/historiska auditfält och aktiva/återtagna länkar inklusive hashkonflikter ingår; alla konkreta reviewfynd rättade. **T9** exakt namnnormalisering återanvänds bara inom samma analys i båda motorerna;5bokstavligt förväntade kontraktsfall per motor, lika runnerhash, fyra utvalda hashbundna källfiler och lika fynd-/allokeringshashar. Lokalt Sites100par51773→3761ms (cirka13,8×), ren400parsanalys Node732→162ms/Sites812→175ms. Stödimporter kommer från samma checkout; ingen fristående historisk miljö, produktions-SLA eller borttagen finansiell omkontroll. Scoped och samlad oberoende slutreview READY efter rättningar.

Produktionsnycklar, **före och efter denna publicering**: **P1** färsk ägarbunden skrivfri AIS-/rapport-/registerkontroll, Sites54→55/runtime9/revision42→42; jämförd avgränsad ekonomisk projektion identisk före/efter och med föregående cykel, AIS ekonomiskt1/rapport0,0allokeringar,automaticEligible=false, målregister komplett0 och rapportintegritet/fullständighet pass. **P2** Gmail anslutet men externt timschema pausat, senaste lyckade hämtning2026-10-29. **P3** sparad bankhämtning14:07Z; ingen account_details-retry när äldre deadline är okänd. **P4** historisk backupstatus195manifestfiler är inte omverifierad mot nya regler och inget fullständigt katastrofprov. Två historiska betalningskontroller är partial/0running. Användaren avser logga in, men autentiserad produktions-UI har ännu inte observerats i testfliken. **P5** Sites55succeeded/samma källträd/MCP aktivt; auth/policy/runtimeposter/revision9/tre scheman och D1översikt26tabeller lika. Backup/bankstatus lika; Gmailkö/konfiguration/fetch lika men heartbeat och läsningens beräknade nästa tid ändras. Ingen ny fetch eller färdig OCRkedja styrks. Detta är avgränsad skrivfri efterkontroll, ingen full ledger-/R2export eller inloggad UI/DRacceptans. Ingen produktionsberoende9,5 grundas på enbart T-bevis.

| Nr / område | Före | Efter | Fynd | Rättning | Testbevis | Produktionsbevis | Kvarstående risk | Nästa åtgärd |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| 1. Design och färger | 8 | 8 | Befintlig svartvit vy fungerar i lokal demo. | Ingen ny färg-/designändring. | T5 fem bredder. | Ingen ny autentiserad områdesacceptans. | Fiktiva data täcker inte alla verkliga texter. | Full ägarresa med verklig läsbehörighet. |
| 2. Startsida | 8,5 | 8,5 | Känd kontobrist kunde räknas som verifierad inbetalning. | Verifierad summa följer aktuell evidens; bokat saldo bevaras. | T4/T5/T6. | P1; ingen riktig ny allokering. | Historiska poster utan känd spärr kontrolleras inte genom ny bankfetch. | Verifiera autentiserad aktuell sammanställning. |
| 3. Navigering | 8,5 | 8,5 | Dialogfokus försvann vid desktop→mobil. | Stabil main-fallback när opener döljs/saknas. | RED4→GREEN6, T5 faktisk Escape/fokus. | Ingen ny inloggad produktionsresa. | Fysisk mobil/tangentbord i produktion saknas. | Upprepa ägarautentiserat navigationsprov. |
| 4. Mobilanpassning | 8,5 | 8,5 | Dold desktopkontroll kunde inte återfokuseras. | Faktiskt fokus kontrolleras före fallback. | T5 fem viewportbredder och390-dialog. | Inget fysiskt mobilbevis. | Viewporttest ersätter inte alla enheter. | Testa verklig mobil/rotation och produktionsdialog. |
| 5. Sökning och filtrering | 7,5 | 7,5 | Längre explicit metadata-ID kunde bli giltigt prefix. | Full token jämförs; bankfilter bevaras. | T2, T5 exakt1003/enrad och specifikationsfilter. | P1 komplett målregistersökning0. | Referenssökningen är inte övergripande komplett. | Bredare verkliga sök-/filteracceptansfall. |
| 6. Minimal manuell hantering | 6,5 | 6,5 | Upprepad namnnormalisering gjorde lokal avstämning dyr; T2:s granskningsbehov kvarstår. | Exakta strängar återanvänds inom samma analys utan ändrade beslut. | T9 lokalt100par cirka13,8× snabbare; T2/T6. | P2 fortsatt pausat/stale, ingen ny verksamhetsacceptans. | Syntetisk hastighet visar inte verklig granskningsvolym eller SLA. | Mät representativa godkända underlag och verkligt arbetsflöde. |
| 7. Kundfakturor | 8 | 8 | Backup kunde godkänna fakturareferens utan bevarad originalmetadata. | Originalreferenser/hash och kända historikfält valideras; T4:s identitetsgrind bevaras. | T8 faktura-/audit-/hashfall i båda motorerna, T4/T6. | P1 målregister komplett0; ingen registrering eller ny allokering. | Historiskt saknade original repareras inte automatiskt. | Behörig original-/auditgranskning och separat registreringsbeslut. |
| 8. Leverantörsfakturor | 8 | 8 | Saknat refererat underlag kunde döljas av komplett backupstatus. | Ägda deklarerade originalreferenser kontrolleras före certifiering; T2:s datumgrind bevaras. | T8 snapshot-/metadata-/historikfall, T2/T6. | Ingen ny verklig registrering; P4 är historiskt manifest. | Alla leverantörslayouter och äldre original är inte utvärderade. | Representativ leverantörskorpus och ägarbunden originalinventering. |
| 9. PDF-tolkning | 8 | 8 | Prefix/datumcensus gav falsk säkerhet. | Fullvärdesvalidering med bevarad census/proveniens. | T2, privat native9/9 per motor. | P1 ägd PDFhash/storlek passerar. | Nativefacit är ingen generell PDFgaranti. | Mät fler verkliga godkända layouter. |
| 10. Bild-OCR | 7 | 7 | OCRmotor är oförändrad; efterföljande fält kan vara tvetydiga. | Striktare gemensam fältgräns. | T2/T6 optiska regressioner, separat från textmätningen. | Ingen ny färdig moln-OCRkedja. | Ingen generell100%precision eller volym-SLA. | Representativ rasterkorpus och driftsprov. |
| 11. Gmail-anslutning | 7,5 | 7,5 | Anslutning och gammal hämtning är olika statusar. | Ingen ändring av avsiktligt pausat schema. | T6 Gmail-/dokumentregressioner. | P2 verifierad stale/paused. | Aktuell schemalagd hämtning saknas. | Relevant godkännande och faktisk lyckad schemakörning. |
| 12. Automatisk fakturaregistrering | 8 | 8 | Samtidiga Sites-källor kunde ge tvetydiga originalposter bakom granskning. | Gmail/uppladdning återanvänder atomiskt samma ägda original; registreringsgrind bevaras. | T7 verkliga syntetiska racefall; T2 parser/PDF/registrering och T6. | P1 målpost saknas; inget registrerat. | Syntetiska fall ger ingen generell produktionsprecision eller historisk reparation. | Separat godkänt verkligt registreringsprov efter originalgranskning. |
| 13. Dubblettkontroll | 8 | 8 | Identiska samtidiga Sites-uppladdningar skapade dubbla originalposter. | Atomisk ägar-/hashvillkorad infogning; faktisk vinnare återläses, osäkra bytes bevaras. | T7 12RED→15GREEN/scoped243; skilda ägare och förlorade svar ingår. | P1 AIS1/rapport0 ekonomiskt; inga nya allokeringar. | Historiska dubbletter eller saknade original repareras inte automatiskt. | Ägarbunden inventering och spårbar återanskaffning vid konstaterad brist. |
| 14. Dokumentgranskning | 8 | 8 | Original kvar enbart i audit eller återtagna länkar kunde undgå backupkontroll. | Kända producentfält, beslut samt aktiva/återtagna originalreferenser/hash valideras. | T8 nya Node40/Sites216; T7 samma Gmail-/uppladdningsdokument. | P2 pausat/stale; ingen individuell verksamhetsacceptans. | Okända historikformat och verkliga granskningsbeslut återstår. | Verksamhetsgranska prioriterade original och utvärdera representativ historik. |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Aktiv anslutning bevisar inget rapportkontoalias. | Befintlig strikta kontogrind bevaras. | T4/T6 konto-/consentregressioner. | P3 aktiv ordinariesynk. | Separat kontodetaljväntetid okänd. | Bankutfärdat bevis; inga nya detaljförsök utan tillåten tid. |
| 16. Automatisk bankhämtning | 8 | 8 | Ordinarieschema och detaljer har olika väntetider. | Ingen schemagissning eller rate-limitomväg. | T6 provider-/retry-/sessionregressioner. | P3 senaste14:07Z, nästa20:06Z. | Ingen ny kontodetaljverifiering. | Bevara schema och invänta verifierbart besked. |
| 17. Bankgiroimport | 8,5 | 8,5 | Motstridig bevarad länks originalhash kunde passera första backupkontrollen. | Aktiva/återtagna länkar och historiska filreferenser valideras mot original; bytes bevaras. | T8 nya RED/GREEN/hashfall; T1/T7 uppladdningsgräns och T6. | P1 rapportintegritet/fullständighet pass, rapport räknas0 gånger. | Bankalias och gemensam insättningsidentitet saknas. | Anskaffa uttryckliga bankunderlag före separat relationsbeslut. |
| 18. Identifiera verklig betalare | 7 | 7 | Individrapportnamn finns, individuell AIS-betalare saknas. | Inga namn fabriceras eller uppgraderas från kund. | T4/T6 identitet/proveniens; privat rapport. | P1 separat rapportnamn. | Rapporten är inte styrkt till just AIS-insättningen. | Styrk rapportrelationen och kundattesten separat. |
| 19. Verklig OCR/fakturareferens | 7 | 7 | Längre metadataidentifierare klipptes. | Komplett token; inledande nollor bevaras. | T2, T5 syntetisk0017, privat exakt0599. | P1 generell referens, ingen formell OCR. | OCR-avtal/checksumma och insättningsrelation återstår. | Behåll typgränser; inhämta erforderligt bevis. |
| 20. Automatisk betalningsmatchning | 7,5 | 7,5 | Samma namn normaliserades upprepade gånger i innersta jämförelserna. | Analyslokal normaliseringskarta i båda motorerna; alla ekonomiska omkontroller kvarstår. | T9 5kontraktsfall/motor, lika fynd-/allokeringshashar; T4/T6. | P1 automaticEligible=false,0allokeringar. | Lokalt volymprov bevisar ingen verklig automatisk matchning eller SLA. | Representativ volymacceptans samt bank-/motpartsbevis och separat beslut. |
| 21. Delbetalningar | 8 | 8 | Känd evidensbrist kunde döljas bakom bokad delbetalning. | Verifieringsstatus hålls utan ändrat paid/saldo. | T4/T6, T5 fiktiv delbetalning. | P1 noll verkliga allokeringar. | Verkligt delbetalningsutfall ej nytt prov. | Godkänt konto-/originalbundet acceptansfall. |
| 22. Överbetalningar | 8 | 8 | Befintliga beloppsgränser och överskott bevaras. | Ingen ny pengar-/saldomotor. | T4/T6 regressioner. | Inget nytt verkligt överskottsbeslut. | Produktionsåterbetalning är inte verifierad. | Separat verksamhetsgranskning utan testbetalning. |
| 23. Flera fakturor i en betalning | 7,5 | 7,5 | Första allokeringseffekten kunde dölja senare brist. | Alla aktiva effekter bedöms ordningsoberoende. | T4 båda ordningar, saldon0 bevarade. | Inget nytt verkligt flerfakturafall. | Historiska blandade typer kräver originalgranskning. | Godkända kompletta grupper och separat allokeringsbeslut. |
| 24. Betalningshistorik | 8 | 8 | Historiskt refererat original kunde saknas trots grön backup. | Kända auditfält och aktiva/återtagna länkar ingår i referens-/hashkontroll; bokningar bevaras. | T8 audit-/detalj-/bilagebytes-/länkfall; T4/T6. | P1 inga ekonomiska skrivningar; avgränsad projektion oförändrad. | Full produktionsaudithistorik är inte exporterad eller omverifierad här. | Ägarautentiserad historik-/återtagsacceptans och separat originalinventering. |
| 25. Betalningsstatus | 8 | 8 | Betald/Verifierad trots känd kontobrist. | Faktura/bank/ekonomi använder gemensam allokeringsevidens. | T4 konto-/föräldra-/refund-/ordningsfall. | P1 blockerad, ingen falsk betaldmarkering. | Okänd historisk spärr upptäcks inte av ren projektion. | Verifiera aktuella original/medgivanden inför beslut. |
| 26. Kontrollera alla betalningar | 8 | 8 | Lokal Sites-domänavstämning av100syntetiska par tog cirka52sekunder. | Återanvänd namnnormalisering inom analys; befintliga evidensgränser bevaras. | T9 51773→3761ms med lika fynd/allokeringar; T4/T6. | P1 skrivfri kontroll; två historiska partial/0running. | Ingen ny full verklig kontroll/allokeringskörning eller produktions-SLA. | Godkänt komplett produktionsacceptansprov med aktuella bankbevis. |
| 27. Automatiska mejlutkast | 8 | 8 | Osäker faktura-/betalningsstatus får inte bli säker utskicksgrund. | Stärkta underliggande fält/evidensregler; inget utskick. | T2/T4/T6 meddelanderegressioner. | P2 två väntande meddelanden, inget skickat. | Verkliga utkast kräver separat granskning. | Kontrollera aktuellt underlag och godkänn varje mejl separat. |
| 28. Schemalagd automatisering | 6,5 | 6,5 | Gmailpaused; heartbeat är inte körbevis. | Alla tre befintliga scheman bevaras. | T6 schemalogik/sessionsgränser. | P2/P3/P4. | Aktuell Gmail-/moln-OCRkörning saknas. | Godkänt schema och observerat lyckat jobb. |
| 29. Säkerhetskopiering | 7,5 | 7,5 | SQLite-FKfel och saknad originalmetadata kunde ge falskt komplett backup. | FK- och deklarerad originalreferens-/hashkontroll före Node create/verify/restore och Sites snapshot/verifiering. | T8 Node40/Sites216 nya; scoped88pass/8EPERMskip och257/257, T6. | P4 historiska195manifestfiler; inte omverifierade mot nya regler. | Gammal complete-status och manifestpass är ingen atomisk DRgaranti. | Ny godkänd oberoende backupverifiering och kontrollerad restoreövning. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Samtidighet/ägargräns och saknade eller motstridiga original behövde starkare kontroll. | Atomisk ägarbunden deduplicering och frysta ägda referens-/hashgrindar; åtkomstregler bevaras. | T7 skilda ägare/okända utfall; T8 främmande metadata/hashkonflikter; READY och T6. | P1 skrivfri förebaslinje; ingen observerad autentiserad ny UI-acceptans. | Ingen allmän felfrihetsgaranti; Node är gemensamt adminregister. | Fortsatt konkret hot-/raceprov och ägarautentiserad acceptans. |
| 31. Katastrofåterställning | 5,5 | 5,5 | Ett strukturellt läsbart arkiv kunde sakna refererat original. | Node avvisar FK-/referensfel före nytt restoremål; Sites stoppar falsk certifiering. | T8 faktisk krypterad SQLitebackup/restore; T3 tidigare oförändrade OS-filgrindar, T6. | P4 ingen faktisk produktionsrestore eller ny manifestverifiering. | Betrodd föräldrakatalog krävs; åtta verkliga Windowsfilsymlänkfall är EPERMskip. | Isolerat faktiskt katastrofprov med betrodda nycklar/kopia. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | Nya race-/referensfel och uppmätt normaliseringskostnad reproducerade. | RED/GREEN, avgränsade rättningar och scoped/samlad oberoende READY efter rättade reviewfynd. | T6–T10;1037Node/1845Sites lokalt och exakt LinuxCI1036/1845 utan fail/skip. | Maincc2be7b/Actions41491162166/Sites55 samma träd; P5. | 16moderate utvecklingsfynd, ESLint utanför support och begränsad representativ acceptans kvarstår. | Granskad kompatibel beroendefix och bredare representativ acceptans. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Bank-/verksamhetsbevis, ägarinloggad verklig kedja och full DR saknas fortsatt. | Ingen fabricerad relation, registrering eller allokering; skrivfri förebaslinje bevarad. | T6–T9 är lokala syntetiska kodbevis; T5 tidigare lokal UI-demo. | P1–P5: Sites55succeeded/revision42→42/valda ekonomifält och original lika; ingen inloggad UI eller full DR. | Verifierad avgränsad efterkontroll ersätter inte inloggad UI, bank-/verksamhetsacceptans eller full DR. | Slutför ägarinloggad acceptans, isolerat katastrofprov och separata bank-/verksamhetsbeslut. |

Deterministisk textprecision100% i T2 är ingen universell OCRgaranti. T9:s lokala syntetiska hastighet är ingen produktions-SLA. Alla nya ekonomiska skrivtest är syntetiska; riktig registrering/allokering kräver separata konkreta beslut. [Beroendegränsen](docs/DEPENDENCY-COMPATIBILITY-FOLLOWUP.md) skiljer konfigurerade regler från installerade kapabilitetsprober; granskad backport är tekniskt möjlig men ännu inte levererad. De16moderate utvecklingsfynden och underhållsbegränsningen hålls öppna. Tidigare godkänd branchrensning kvarstår: endast main på GitHub, PR9/10 closed/unmerged och unikt arbete privat återställningsbart. Ingen ny rensning eller obemannad automation genomförs i denna cykel.

## GitHub och bankens väntetidsbevis — 2026-11-02

| Område | Före | Efter | Nytt verifierat underlag / gräns |
| --- | --- | --- | --- |
| GitHubrensning |5fjärrbrancher utövermain|5kvar|Arkiv11refs/träd verifierat igen; specifikt raderingsgodkännande saknas, ingen dialog simuleras.|
| Bankgiroimport/konto |8,5|8,5|12privata workbookkontroller passerar; inget kontoalias hittas på.|
| Betalare/referens |7|7|Exakt original och inledande nolla; generell referens förblir separat från OCR/AIS.|
| Konto-/rapportidentitet |Blockerad|Blockerad|Ordinariesynkens planerade tid är inte account_details-behörighet; äldre leverantörsdeadline okänd.|
| Fakturaverifiering |Oförändrad numerisk bedömning|Oförändrad|9fält per faktisk parser passerar; komplett register0; ingen riktig registrering/allokering.|
| Automatisk matchning |7,5|7,5|PreviewautomaticEligiblefalse, ekonomisk insättning1/rapport0, inga pengar skapade.|
| Säkerhet/åtkomst |8,5|8,5|Betrodd WeakMap-retryproveniens och konstruktörskod, inget getter-/råheaderläckage i regressionsfallen.|
| Kod/tester |8,5|8,5|OberoendeREADY,847Node/1451Sites/syntax99/TS/bygge/highgrindar;0produktion/16moderate devfynd.|
| Produktion |6,5|6,5|Exakt CI41470820370 och Sites53 succeeded med identiskt källträd; revision42/ekonomifält/original/auth/runtime9/scheman oförändrade; inloggad browserresa och bankrelation kvar.|

Samtliga33områdespoäng i föregående kompletta tabell behålls:255/330=7,73. Ingen9,5 eller universell100%OCR påstås. [Aktuell samlad rapport](docs/FINAL-GITHUB-AND-BANK-VERIFICATION.md).

## Stabilisering och branchrensning — 2026-11-02

| Nr | Område | Före | Efter | Evidens / kvarstående gräns |
| --- | --- | ---: | ---: | --- |
| 1 | Design och färger | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 2 | Startsida | 8,5 | 8,5 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 3 | Navigering | 8,5 | 8,5 | Navigation och fokus i offentlig bankvy; inloggad resa ej tillgänglig. |
| 4 | Mobilanpassning | 8,5 | 8,5 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 5 | Sökning och filtrering | 7,5 | 7,5 | Revisions- och evidensbundna kandidater, sena/felaktiga svar hålls. |
| 6 | Minimal manuell hantering | 6,5 | 6,5 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 7 | Kundfakturor | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 8 | Leverantörsfakturor | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 9 | PDF-tolkning | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 10 | Bild-OCR | 7 | 7 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 11 | Gmail-anslutning | 7,5 | 7,5 | Gmail efterkontrollerar accepterat arbete även vid HTTP429; skyddade Node-anrop fencas. |
| 12 | Automatisk fakturaregistrering | 8 | 8 | Registreringstester syntetiska; inga verkliga registerposter skapade. |
| 13 | Dubblettkontroll | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 14 | Dokumentgranskning | 8 | 8 | Förändrade dokument uppdaterar ordinarie/fokuserad vy även utan ekonomisk revision. |
| 15 | Swedbank-anslutning | 8,5 | 8,5 | Ingen bankaliasrelation uppfinns; aktuell behörig läsning krävs fortsatt. |
| 16 | Automatisk bankhämtning | 8 | 8 | Node-bankens fortsättningsanrop stoppas efter sessionsrevokering. |
| 17 | Bankgiroimport | 8,5 | 8,5 | Befintliga XLSX/CSV/camt-original- och idempotensregler bevarade. |
| 18 | Identifiera verklig betalare | 7 | 7 | Bankbetalare förblir separat från fakturaförslag. |
| 19 | Verklig OCR/fakturareferens | 7 | 7 | Kandidatval följer samma faktiska rapport-/detalj-/AIS-referens som vyn. |
| 20 | Automatisk betalningsmatchning | 7,5 | 7,5 | Inga ändringar av ekonomimotorns saldon eller allokeringar. |
| 21 | Delbetalningar | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 22 | Överbetalningar | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 23 | Flera fakturor i en betalning | 7,5 | 7,5 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 24 | Betalningshistorik | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 25 | Betalningsstatus | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 26 | Kontrollera alla betalningar | 8 | 8 | Tidigare numerisk bedömning behålls; ingen ny fullständig områdescertifiering. |
| 27 | Automatiska mejlutkast | 8 | 8 | Meddelandeåtgärders föräldrauppdatering inväntas; inga kundmejl skickade. |
| 28 | Schemalagd automatisering | 6,5 | 6,5 | Befintliga scheman bevaras; ingen ny loop eller automatisering startas. |
| 29 | Säkerhetskopiering | 7,5 | 7,5 | Verifierat privat Git-arkiv och syntetiska backup-/originalkontroller; manifestpass är historisk scan. |
| 30 | Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Session återkontrolleras efter body/provider; parallella inloggningsförsök räknas korrekt. |
| 31 | Katastrofåterställning | 5,5 | 5,5 | Främmande WAL/sidecars får inte påverka återställda bytes; syntetisk återställning verifierad. |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 | RED/GREEN, oberoende slutreview READY;847Node/1426Sites, syntax99/TS/bygge och exakt CI41456514768 passerar. |
| 33 | Verifiering i verklig produktion | 6,5 | 6,5 | Sites52 publicerad/ägarbundna original/registerkontroller passerar; ny konto-GET BANK_RATE_LIMIT och tidigare saknat alias; inloggad UI saknas. |

Dokumentär startsumma och oförändrad slutbedömning: **255/330 = 7,73/10**, 0/33 områden når9,5. Detta är summering av tidigare explicita områdespoäng med senare överlagringar, inte en ny statistisk produktmätning. Äldre tryckta253,5/7,68 avser poäng före höjningarna för områden17–19. Numeriska poäng höjs inte för att uppfylla målet; nya regressionsbevis redovisas separat. Äldre backup-/restore-motiveringar nedan är historik och ersätts av den nya fel-/testredovisningen.

[Aktuell samlad rapport](docs/FINAL-MAIN-CLEANUP-REPORT.md), [leveranskvitto](docs/FINAL-MAIN-CLEANUP-DELIVERY.json). Lokal rensning klar; fjärrradering avvisad av automatisk godkännandekontroll och väntar åtgärdsspecifik bekräftelse. Poängen höjs inte för en blockerad handling.

## Samlad betalningskedja — ny verifiering 2026-11-02

| Område | Före | Efter | Ny evidens och gräns |
| --- | ---: | ---: | --- |
| Konto/Bankgiroimport | 8,5 | 8,5 | Verkligt schemafel observerat och rättat; entydigt bankalias får inte uppfinnas. Slutlig livekontroll återstår efter publicering. |
| Betalare/referens | 7 | 7 | Privat individoriginal, ledande nollor och primär juridisk identitetskälla omgranskade; bankens rapport-/AIS-samband är separat. |
| Automatisk matchning | 7,5 | 7,5 | Samma13-fallskorpus5/13→13/13 för read-onlypreview,0 tillståndsändringar. Ingen verksamhetsallokering eller ny ekonomimotor. |
| Säkerhet/åtkomst | 8,5 | 8,5 | Explicit ägar-/origin-/revisionsbunden konto-POST, trusted serverval och oförändrade publika MCP-selectorer; otillräckliga/motstridiga svar hålls. |
| Kod/tester | 8,5 | 8,5 | Baseline775/1323; slutligSites1381, TS/syntax98/rent bygge och oberoende review. Produktionsaudit0,16 moderate utvecklingsfynd. |
| Verklig produktion | 6,5 | 6,5 | Aktuell bank-/original-/registerläsning fungerar; browser-QA/inloggad resa och återstående bankbevis förhindrar högre slutbetyg. |

Övriga områden och senaste användbarhetsbetyg behålls. [Full rapport, mätningar och begränsningar](docs/REAL-PAYMENT-0599-FINAL-REPORT.md). Ingen9,5-inflation eller falsk betaldmarkering. Slutligt leveranskvitto tillkommer efter exakt CI/publicering och läsande efterkontroll.


Slutlig läsande produktionskontroll efter main991214e/exakt CI41432323395/Sites51: aktuellt konto2/2 komplett men ingen matchande bankaliasrelation; ägda fakturabytes lika Gmail; registerkontroll komplett/0träffar; AIS ekonomiskt1, rapport0, båda0allokeringar och automaticEligiblefalse. Revision41 och kontrollerade ekonomiska fält oförändrade. D1struktur26tabeller, runtime9, policy/auth/scheman jämförda oförändrade. [Leveranskvitto](docs/REAL-PAYMENT-0599-DELIVERY.json). Poängen behålls; betalningsutfallet EXTERNT BLOCKERAT.

## OCR och fullständig evidens — aktuell mätning

| Berört område | Före | Efter | Evidens och gräns |
| --- | ---: | ---: | --- |
| Faktura-/OCR-läsning | Behåll tidigare | Behåll tidigare | Exakt textkorpus42/100→100/100; faktisk optisk54/55→55/55; privat native9/9 per motor. Avgränsade layouter, ingen universell100%-garanti. |
| Betalare och referens | 7 | 7 | Primär registerkälla löser namnvariation; komplett token14/40→40/40, falskt säkra26→0. Rapporten bevisar ingen formell OCR. |
| Bankgiro/kontorelation | 8,5 | 8,5 | Avgränsade ägarbundna aktuella provider-GET, exakt medlemskap/alias, inga härledda konton. Faktisk relation återstår att styrka. |
| Automatisk matchning | 7,5 | 7,5 | Ofullständiga token/källor och OCR hålls; inga verkliga allokeringar eller saldoförändringar. |
| Säkerhet och åtkomst | 8,5 | 8,5 | Läsverktygens ägare, original, aktuell consent, sekretess och skrivfrihet granskade; fjärrarbetare kan inte ge sig PDF-tillit. |
| Kodkvalitet/tester | 8,5 | 8,5 | TDD och oberoende scoped/integrerad review; 775/775 Node,1323/1323 Sites, syntax97, TS/build passerar; exaktCI41362005970 success, main`ee3d8aa` och Sites49 succeeded. Befintliga16 moderate utvecklingsfynd kvarstår. |
| Verklig produktion | 6,5 | 6,5 | Ingen höjning för syntetisk precision eller ansluten bank; aktuell fullständig kontorelation/AIS/register krävs. |

[Rapport och mätfiler](docs/COMPLETE-OCR-EVIDENCE-VERIFICATION.md). Övriga33 områden och historiska bedömningar behålls. Ingen9,5 utan verksamhetens fullständiga bevis. [Exakt leverans och begränsningar](docs/COMPLETE-OCR-EVIDENCE-DELIVERY.json): bådaCI-jobb success, Sites49/samma källträd/runtime9, revision40 oförändrad. Tre nya läsverktyg saknas i denna chatts register trots publicering; komplett aktuellt AIS-/konto-/registerunderlag fortfarande oläst. Ingen verklig betalning godkänd.


## Originalverifiering — aktuell, konservativ bedömning

| Berört område | Före | Efter | Evidens och begränsning |
| --- | ---: | ---: | --- |
| Bankgiroimport/kontorelation | 8,5 | 8,5 | Sex nya negativa aliastester och båda apparnas valutaspärr; verkligt rapport-/AIS-samband ej styrkt. |
| Verklig betalare och referens | 7 | 7 | Privat original och faktura-PDF jämförda; generell referens förblir generell. Olika motpartsnamn kräver separat bevis. |
| Automatisk matchning | 7,5 | 7,5 | Förslag/källrelationer skapar inte pengar; inga riktiga allokeringar prövas. |
| Säkerhet och åtkomst | 8,5 | 8,5 | Aliasambiguitet och påhittad explicit valuta stoppas; original/medgivande krävs fortsatt. |
| Kodkvalitet och tester | 8,5 | 8,5 | 646 Node +1142 Sites, syntax92, TS/build/high-audit och oberoende review. Sites16 moderate utvecklingsfynd kvarstår. |
| Verklig produktion | 6,5 | 6,5 | Aktiv Swedbank läst, men full aktuell AIS-/konto-/registerläsning blockerad av trunkering/inloggning. |

Poängen behålls trots mätbara kontrollförbättringar: ingen9,5 utan verksamhetens bevis. Övriga områden oförändrade. Fem valuta-/datumregressioner79/84→84/84; sex tidigare felaktigt tillåtna aliasfall→0. [Rapport och exakt avgränsning](docs/BANKGIRO-ORIGINAL-VERIFICATION.md). Kod8962254/exakt CI41357990960 båda success; Sites48 succeeded, samma källträd/runtime9; efterkontroll revision40/oförändrad ändringstid. [Verifierat leveranskvitto](docs/BANKGIRO-ORIGINAL-VERIFICATION-DELIVERY.json). Aktuell full AIS-/registerläsning återstår, poängen behålls.

## Kravkontrollens alias- och fältkällor — 2026-11-01

[Samlad kravmatris](docs/PAYMENT-VERIFICATION-ACCEPTANCE.md), [kompletteringsrapport](docs/PAYMENT-EVIDENCE-SOURCES-VERIFICATION.md). Berörda bankimport-/konto-, betalar-/referens-, fakturavy-, historik-/saldo-, användbarhets-, säkerhets-, test- och produktionspoäng behålls. Ett uttryckligt provider-alias kan nu kontrolleras även vid Nodes manuella originalrelation utan att ändra parserns råa kontobevis eller ge allokeringsrätt. Node visar rapportens fulla råevidens/celler och döljer AIS-baserade förslagsmarkeringar som inte stöds av den visade rapportreferensen. Sites håller visat fält, identifierartyp/råvärde/fältsökväg och fakturaoriginal på samma källkedja; verkliga tidigare bokningar bevaras med referenskonflikt.

Lokalt **645/645 Node +1126/1126 Sites**, syntax92, TypeScript/produktionsbygge och auditgrindar passerar. Oförändrade paket-/lockfiler; produktionsaudit 0, full Sites 16 moderate utvecklingsfynd/0 high/critical. Samma 15-fallskorpus: 10/10 korrekta manuella relationer, 0 felaktiga relationer/allokeringar/dubblettfall, 15/15 oförändrade saldon och 8/8 namn/referenser före/efter. Granskning utan kvarstående konkreta fynd. Mobilprovet vid 390 px gäller faktisk komponent/CSS med syntetiskt tillstånd.

**Faktisk leverans:** main `cda00d9`, [exakt CI 41354521234](https://github.com/sharbel0022/Mgeorge/actions/runs/41354521234) med båda jobben success/rena installationer, **Sites 47 succeeded**, identiska källträd. Läsande produktions-GET och dialog: revision 40 → 40, hela tillståndet/ekonomiska projektionen oförändrade, fem fakturor/noll allokeringar. Policy/auth, DB/R2-deklarationer/tabellista, miljörevision 9/metadata och scheman bevarade. [Leveranskvitto](docs/PAYMENT-EVIDENCE-SOURCES-PUBLICATION.json). Produktionspoäng 6,5 och övriga berörda senaste poäng oförändrade, inget 9,5. Verkligt kontoalias/rapport-/AIS-samband och separat registrering/kundattest för 0599 återstår; hela produktionskedjan är inte godkänd.

## Hela betalningskedjan — 2026-11-01

Leverans verifierad: main `a8453a1`, [exakt Actions success](https://github.com/sharbel0022/Mgeorge/actions/runs/41351500449), Sites **46 succeeded**, samma Sites-träd och runtime 9. Läsande verklig elvastegskontroll och faktisk dialog: revision **40 → 40**, hela tillståndet/ekonomiska projektionen oförändrade, fem fakturor och noll allokeringar. Kontoalias/rapportidentitet och registrering/kundrelation återstår. Policy, auth, DB/R2-deklarationer, tabellista och scheman bevarade. [Exakta bevis](docs/END-TO-END-PAYMENT-PUBLICATION.json). Poängen är fortsatt oförändrade; leveransframgång är ingen färdig verksamhetsavstämning.

[Arkitektur](docs/PAYMENT-VERIFICATION-ARCHITECTURE.md) och [före-/efterrapport](docs/END-TO-END-PAYMENT-VERIFICATION.md). Samtliga berörda poäng behålls; ingen produktionsberoende poäng höjs till9,5. Nytt faktiskt fel reproducerades och rättades i båda motorerna: intakt AIS-original kunde allokeras utan aktuellt kontomedgivande. Samma11-fallskorpus per motor ger2/11→11/11 korrekta beslut och9→0 felaktigt tillåtna allokeringar, med positivfallet kvar1/1. Det är syntetisk regressionsprecision, inte ett produktionsestimat.

| Berört område | Före → efter | Ny verifierbar evidens | Kvarstående gräns |
| --- | --- | --- | --- |
| Startsida, kundfakturor och fakturasaldon | Behåll senaste poäng | Blockerade fall lämnar bokat saldo; Node skiljer verifieringsstatus från redan bokade belopp | Verklig0599 är inte registrerad eller allokerad |
| Swedbank/bankhämtning | Behåll senaste poäng | Aktuellt ägt valt entydigt SEK-konto krävs även efter AIS-import | Ansluten bank är inte generell individuell rapportbehörighet |
| Bankgiroimport | 8,5 → 8,5 | Rapportpromotion och allokering får commit-tida kontomedgivandefence;15/15 korrekta och oförändrade saldon i relationskorpusen | Autentiskt kontoalias och gemensam rapport-/AIS-identitet saknas |
| Verklig betalare / referens | 7 / 7 → oförändrat | Bankfakta, generell0599, manuellt beslut och kund hålls isär;8/8 namn/ref kvar i syntetisk relationskorpus | Formellt OCR-avtal och färdig kund-/tredjepartsrelation inte verifierade |
| Automatisk betalningsmatchning | 7,5 → 7,5 |18 falska allokeringar i riktade negativa fall→0 över två motorer; befintlig Node23-fallskorpus fortsatt23/23,TP5/5,FP0 | Ingen automatisk produktionsmatchning styrkt genom syntetiska data |
| Dubbletter, del-/överbetalning, historik och status | Behåll senaste poäng | Återimport/avbrott/återtag bibehålls; nya kontogränser bevarar gamla pengar och lärda relationskällors evidens | Full autentisk saldo-/historikavstämning återstår |
| Säkerhet och åtkomstkontroll | 8,5 → 8,5 | Node manuell HTTP-original-/ägarkontroll under skrivlås; Sites atomisk snapshot+SQL-fence,24 nya commitfall och18 oberoende extra racefall | Node är fortsatt ett företagsgemensamt administratörsregister |
| Mobil och betalningsvyns användbarhet | Behåll senaste poäng | Ny läsande elvastegspanel med källor/regler/nästa steg; Chromium1440/390px, tangentbordsutfällning och ingen dokumentoverflow | Browserbeviset använder faktisk komponent med syntetiskt tillstånd; produktion verifieras separat |
| Gmail och schemalagd automatisering | Behåll senaste poäng | Läsande driftstatus skiljer anslutet Gmail från pausat timschema och gammal lyckad hämtning | Ingen ny Gmail-körning eller schemaändring gjord |
| Säkerhetskopiering / katastrofåterställning | Behåll senaste poäng | Aktuellt komplett manifestpass191/191 läst |113 äldre API-kvitton saknas i backupomfattningen; ingen full katastrofövning |
| Kodkvalitet och tester | 8,5 → 8,5 | Röda/gröna regressioner, oberoende granskningar och obligatoriska slutgrindar redovisas i leveranskvittot | Sites fullaudit har16 moderate utvecklingsfynd; produktion0, high/critical0 |
| Verifiering i verklig produktion | 6,5 → 6,5 | Privata original omgranskade läsande, revision40/fem fakturor/noll allokeringar; exakt leverans redovisas separat | Kontoalias, rapportidentitet, registrering, kundrelation och separat allokeringsgodkännande återstår |

Övriga områden och äldre bedömningar behålls som historik. För slutliga testantal, exakt GitHub-/CI-/Sites-identitet och läsande efterkontroll gäller denna cykels leveranskvitto, inte äldre publiceringsuppgifter. Lokalt 625 Node + 1111 Sites, syntax 92, TypeScript och produktionsbygge. En driftfunnen felklassificering av ett giltigt äldre AIS-kvitto i Sites 45 rättades med sex regressioner utan ändrad ekonomisk evidens eller lagring. Mellanversionen ersätts av den korrigerade leverans som anges i kvittot; inga poäng höjs av publiceringen.

## Färskt AIS-kvitto i drift — 2026-11-01

Poäng oförändrade för bankhämtning, Bankgiroimport, betalare/referens, matchning, saldon, åtkomst, tester och produktionsverifiering. Nödvändig kvittoevidens har förbättrats: riktad färsk bankhämtning adopterade ett giltigt kvitto till äldre rad i Sites44, revision37→38, utan ändrade ekonomiska fält/fakturor/krediter/allokeringar. Noll allokeringar; ingen originalrelation eller fakturakoppling bekräftad. Privat bank-PDF kompletterar konto-/rapportkontrollen, men aktivt kontoalias och gemensam stabil rapport-/AIS-identitet saknas fortsatt. Sådant underlag kan inte ersättas av syntetiska tester eller fri text.

Slutlig verifiering: 606 Node +1022 Sites, syntax89, TypeScript/bygge; produktion audit0 och full Sites16 moderate utvecklingsfynd. Oberoende review utan Critical/Important, exakt kod-CI grönt och Sites44 succeeded med samma källträd. Separat referensprofil bevarar giltiga äldre kvittons tolkning; Node-standardflödet är oförändrat. [Rapport](docs/FRESH-AIS-RECEIPT-VERIFICATION.md), [leveransbevis](docs/FRESH-AIS-RECEIPT-PUBLICATION.json), [fortsättningspunkt](PROGRESS.md). Ingen produktionsberoende poäng höjs till9,5.

## Aktuell underlagsevidens — 2026-11-01

Samtliga poäng behålls. En riktad produktionshämtning har nu bevarat färskt autentiskt AIS-original, och det sökta fakturaoriginalet har hittats och visuellt granskats. Nuvarande offentlig Bankgiro-motpartsrelation stöder fakturans organisationsnummer. Detta ersätter den tidigare uppgiften att själva originalfakturan inte var hittad, men innebär ingen registrerad eller betald faktura.

Swedbank/bankhämtning, Bankgiroimport, betalare/referens, automatisk matchning, saldon och produktionsverifiering höjs inte: fullständigt kontoalias och rapportens relation till den aktuella insättningen är ännu inte verifierade; äldre AIS-rad saknar fortsatt adopterat ankomstkvitto. Riktad hämtning ändrade revision35→36 med oförändrade ekonomiska fält/fakturor/krediter/allokeringar; slutkontroll gav fem registrerade fakturor och noll allokeringar. Ingen koppling, ny import, kodändring eller publicering. Skrivfri filförhandsgranskning kunde inte slutföras på grund av webbläsartilläggets filbehörighet. Underlag och exakt fortsättningspunkt bevaras privat; [framstegsanteckningen](PROGRESS.md) redovisar gränserna. Befintliga tester är tidigare leveransbevis, inte nya testkörningar för denna undersökning.

## AIS/Bankgiro underlagskoppling — 2026-11-01

[Mät- och leveransrapport](docs/BANKGIRO-AIS-LINKING-IMPROVEMENT.md). Separat ägarbunden, manuell och återtagbar originalrelation i båda befintliga applikationerna; inga nya ekonomiska poster eller allokeringar från relationen. Samma 15 syntetiska scenarier: korrekta manuella relationer 0/10→10/10, ekonomiska dubblettfall 0/15→0/15, felaktiga relationer 0/5→0/5, oförändrade saldon/allokeringar 15/15. Åtta huvudinsättningar visas på 16→8 rader med bevarade rapportoriginal.

| Berört område | Före → efter | Ny evidens | Verifieringsgräns |
| --- | --- | --- | --- |
| Startsida och fakturasaldon | 8,5 / 8 → oförändrat | 15/15 oförändrade ekonomiska totaler och fakturasaldon; del/full betalning behåller status | Ingen riktig produktionsallokering prövad |
| Swedbank/bankhämtning | 8,5 / 8 → oförändrat | AIS-kvitto, aktivt ägt konto och aktuellt medgivande krävs; historiska osignerade kvitton uppgraderas inte | Berörd verklig AIS-rad saknar ankomstkvitto |
| Bankgiroimport | 8,5 → 8,5 | Kompletta grupper, överlappande del-/helrapporter, ägt omtolkat original och originalrelation | Autentisk stabil XLSX/AIS-identitet saknas |
| Verklig betalare / referens | 7 / 7 → oförändrat | Syntetisk visning 2/8→8/8 namn och 0/8→8/8 exakt generell referens; tydlig manuell proveniens | Ingen generell referens uppgraderas till OCR |
| Automatisk matchning | 7,5 → 7,5 | Metadata undantas helt från avstämning/utkast; gamla reviewgrupper kräver aktuellt kontomedgivande före automatisk promotion | Ingen automatisk XLSX-koppling utan bankbevis |
| Dubblettkontroll / delbetalningar / historik / status | 8 → 8 | Samtidighet, återtag, avbrott, oförändrade allokeringar, separat ägarfiltrerad audit | Ingen ekonomisk dubblering reproducerades i startrevisionen; noll sådana rättningar påstås |
| Säkerhet och åtkomstkontroll | 8,5 → 8,5 | Ägargränser, originalhash/version/omtolkning, CAS/SQLite-transaktion och reviderbart återtag | Bankmedgivandet läses ur bevarad konfiguration; ingen ny providerauktorisering görs |
| Mobil / användbarhet | 8,5 / 8 → oförändrat | Verklig Chromium-komponentkontroll 1440/390 px, bekräftelse/återtag, ingen dokumentoverflow | Isolerade syntetiska minnesdata; full driftkedja separat |
| Kodkvalitet och tester | 8,5 → 8,5 | 595/595 Node + 951/951 Sites, syntax89, TS/build; oberoende fynd reproducerade och rättade | Produktionsaudit0; full Sites16 moderate utvecklingsfynd, 0 high/critical |
| Verifiering i verklig produktion | 6,5 → 6,5 | Sites41 succeeded, exakt kod-Actions green; autentiserad kandidat-/spärrkontroll och mobil390px, revision35 oförändrad | Ingen faktisk produktionskoppling; AIS-kvitto och faktura0599 saknas. [Leveranskvittot](docs/BANKGIRO-AIS-LINKING-PUBLICATION.json) |

Övriga områden oförändrade. Ingen 9,5-poäng ges för syntetiska tester eller enbart ansluten integration.

## Direkt Bankgiro-XLSX — 2026-11-01

[Implementationsrapport](docs/BANKGIRO-XLSX-IMPLEMENTATION.md). Privat original verifierat13/13; inga verkliga bankvärden publicerade. Identisk22-filerskorpus: avsändare/referens/rader0/11→11/11, felaccept0/13→0/13. Fulla sviter578 Node+912 Sites; syntax84, TS/build och obligatorisk auditgrind godkända. Sites fullaudit har fortsatt16 moderate utvecklingsberoenden; produktionsaudit0. Kod417fd4c (implementation359055c), exakt Actions41313420001 success; senaste Sites39 succeeded, samma Sites-källträd. Arbetsyterevision31→31, oförändrad ändringstid/policy/tabellista/scheman/runtime9. Publicerad importknapp/XLSX-filter och syntetisk minnesdemo verifierade; tydligt huvudvärde för referens. Inget riktigt import-/matchningsprov. Kvitto: docs/BANKGIRO-XLSX-PUBLICATION.json.

| Berört område | Före → efter | Testbevis | Kvarstående begränsning |
| --- | --- | --- | --- |
| Bankgiroimport | 8 → 8,5 | Direkt XLSX,35 parser+18 API, privat original13/13 | Stabil rapport/AIS-identitet saknas; review utan pengar |
| Verklig betalare | 6,5 → 7 | Faktisk export läst privat;11/11 syntetiska avsändare | Bankautenticitet/kontorelation måste verifieras |
| Verklig OCR/fakturareferens | 6,5 → 7 | 11/11 exakta referenser; generisk referens blir inte OCR | Formellt OCR-avtal och verklig avstämning ej verifierade |
| Automatisk betalningsmatchning | 7,5 → 7,5 | Inga osäkra XLSX-allokeringar/dubbelpengar | Ingen förbättring av produktionsmatchning påstås |
| Betalningshistorik/säkerhet | 8 → 8 | SHA/original/ägare/CAS/rollback, oberoende review | Full produktionshistorik inte återberäknad |
| Betalningsvyns användbarhet | 8 → 8 | Verklig filväljare, demoimport,1280/390px | Autentiserad produktionsimport ej utförd |
| Kodkvalitet och tester | 8,5 → 8,5 | +62 fullsvitstester;0 fel | Syntetisk omfattning, inte felfrihetsgaranti |

Övriga områden oförändrade. Höjningarna gäller den avgränsade verifierade Excel-funktionen; ingen9,5-poäng delas ut.


**Aktuell komplettering: 2026-11-01. Verklig betalare och OCR: MÅLET 9,5/10 ÄR INTE UPPNÅTT.**

Den nya [uppmätta före-/efterrapporten](docs/BANK-PAYER-OCR-IMPROVEMENT.md) utgår från senaste `origin/main` `9d45656`. Samma korrigerade 26 syntetiska original kördes före/efter: 49 parserutvärderingar, betalaridentitet 35/42 → 42/42, OCR-recall 34/37 → 37/37, fakturanummer 12/14 → 14/14, felaktiga organisationsfält 5 → 0 och inga falska betalarnamn. Separat faktisk SQLite-matchningskorpus: felaktig automatchning 3 → 0, säkra TP 5/5, manuell granskning 14/22 → 17/22. Den ursprungliga baslinjen före första kodändring är också bevarad; korrigeringen av COID-facit redovisas öppet.

Lokalt **570/570 Node + 858/858 Sites**, syntax 82 filer, TypeScript och produktionsbygge godkända; oberoende slutreview utan kvarstående publiceringsblockerande fynd. Node audit 0, Sites produktionsaudit 0; full Sites-audit har 16 moderate i utvecklingsverktyg, 0 high/critical. Den obligatoriska high-grinden passerar. Allt detta är syntetisk kod-/testbevisning; autentisk bankprofil, företagsavtal och individuellt produktionsfacit saknas.

Kompletterad mätkontroll skiljer parserkandidater från faktiska felbeslut: falsk automatisk acceptans vid osäker betalaridentitet **2/6 → 0/6**, vid ogiltig/egen OCR **1/3 → 0/3**. Hela lokala import-/originalkontroll-/avstämningskedjan mäts i22 scenarier/27 indataförsök: **3,4344 → 3,4620 ms per bankradsförsök**. Samma runner/facit före/efter, med dokumenterade undantag; ingen produktions-SLA eller produktionsidentitetsprecision påstås. Publicerad programkod/Sites37 ändras inte av mätkompletteringen.

| Område | Före → efter | Förbättring och testbevis | Produktionsbevis | Kvarstående problem |
| --- | --- | --- | --- | --- |
| Verklig betalare | 6,5 → 6,5 | Typad råevidens, svensk utfärdare, full fältväg, ärvd konflikt; 42/42 i korrigerad korpus | Endast läsande status före publicering | Individuellt autentiskt original/MIG/kanal |
| Verklig OCR/fakturareferens | 6,5 → 6,5 | SEBG/OCR-typ, råvärde, flera referenser/CSV, ledande nollor; 37/37 OCR | Verkligt OCR-avtal/individfacit ej verifierat | Avtalad regel/profil och rapportoriginal |
| Bankgiroimport | 8 → 8 | Multi-kolumn, typade ID, källspårning och hela import-/originalsviter | Publiceringskvitto redovisas separat | Autentisk bankprofil och leverans |
| Automatisk betalningsmatchning | 7,5 → 7,5 | FP 3 → 0; TP 5/5; atomisk betalarrelation; refund/ancestorstopp | Inga testallokeringar i produktion | Representativa verkliga utfall |
| Betalningshistorik | 8 → 8 | Audit och gamla pengar bevaras vid konflikt/rollback | Ingen ny testhistorik i produktion | Node har fortfarande global senaste-100-audit |
| Betalningsstatus | 8 → 8 | Bankkonflikt före del-/överskottslabel; aktuell ursprungskontroll | Nytt faktiskt betalningsutfall ej prövat | Verklig historik-/saldojämförelse |
| Automatisk bankhämtning | 8 → 8 | Befintlig AIS/intervall/medgivande behålls; striktare härledning | Ansluten sex-timmarsbank, inget nytt sync-anrop | AIS ger inte individuell rapportbehörighet |
| Betalningsvyns användbarhet | 8 → 8 | Svartvit desktop/mobil, utfällbara råvärden, Enter/Escape/fokusretur | Kvitto för exakt revision anges separat | Autentiserat individuellt flöde; filväljarprov blockerades av tilläggsinställning |

Varken hög syntetisk precision eller en lyckad publicering får ersätta den saknade produktionsbevisningen. **Leverans verifierad:** main-kod `c031b2e`, Actions 41307488778 godkände Node/Sites; Sites **37 succeeded**, runtime-revision 9. Autentiserade översikts-/banklisteläsningar verifierade de nya förklaringarna. Arbetsyterevision **31 → 31**, samma ändringstid, oförändrad policy/DB/R2/scheman. Inget individuellt produktionsimport-/matchningsprov utfördes. Exakt kvitto: `docs/BANK-PAYER-OCR-PUBLICATION.json`. De historiska cyklerna nedan behålls som historik.

**Historiskt bedömningsdatum: 2026-10-30. Status då: MÅLET ÄR INTE UPPNÅTT.**

Baslinjen nedan är den första samlade, dokumenterade bedömningen mot användarens33 områden; aktuella cykelresultat anges separat. Det är **inte** en uppfunnen historisk baslinje och visar ingen påstådd poängförbättring jämfört med tidigare körningar. Befintlig grund är `origin/main` på `b5a25e7`; denna körnings kodändringar, tester och begränsade observationer bedöms separat från äldre leveranser. Ingen poäng på 9,5 eller högre delas ut i denna version.

Bedömningen är konservativ och avser **verifierad kvalitet inom den redovisade omfattningen**, inte en statistiskt uppmätt felfrihetsgrad. En godkänd kodleverans är inte bevis för bankens rapporttäckning, avslutad moln-OCR eller fullständig företagsavstämning. Alla lokala testdata är syntetiska. Baslinjen saknade autentiserade produktionsflöden. Cykel1B har därefter verifierat de avgränsade vy-/menyflöden som redovisas i publiceringsrapporten.

## Aktivt åttatimmarsarbete: cykel 4

Start **2026-10-30 15:31:15 UTC**, sista budgettid **23:31:15 UTC**, startbetyg245/330. Senast verifierade main är `6660bd712ba523b0cdbcb619e30c3bf43d9bc9b9` med [Actions41102309328 success](https://github.com/sharbel0022/Mgeorge/actions/runs/41102309328), faktiskt publicerad som **Sites35**. [Publiceringsrapporten](docs/QUALITY-8H-SITES-CYCLE3-PUBLICATION.md) innehåller exakta käll-/arkiv-/deploykvitton och begränsade läsande driftkontroller. Autentiserad produktionsbrowser efter version35 är ännu inte verifierad; senaste sådan är version34.

Cykel4 är en separat **opushad och opublicerad** kandidat med28 hashbundna filer: **519/519 Node +831/831 Sites =1350**, syntax70, TypeScript, produktionsbygge och fulla audits0/0. Navigation/historik, RAM-filter/utkast, kryptografisk HTTP-UUID, ärliga bank-/faktura-/Gmail-tillstånd, bevisetiketter, kontrast, mobilfokus och parserkorpus är avgränsat granskade. Faktisk lokal Chromium verifierar navigation och mobilfokus; slutkandidatens utloggade tre listvyer visar inloggning och spärrad CSV. [Rapport](docs/QUALITY-8H-CYCLE4.md) och [maskinläsbar33-områdesbedömning](docs/QUALITY-8H-CYCLE4.json).

Aktuell lokal bedömning är **253,5/330 = 7,68/10**, **0/33** på minst9,5. Uttryckliga höjningar ger+4,5; backupsäkerhet/katastrofåterställning sänks sammanlagt1,0 efter nytt reproducerat false-complete-fel. Exakt netto+3,5 från250; ingen extra höjning görs för att nå planeringsuppskattningen254.

Två interna Important-fynd är öppna i denna kandidat:401 kan radera modalutkast, och backup kan bli complete när en tidigare verifierad kopia försvinner mellan steg. Separata rättningar är på review. Native beforeunload är miljömässigt overifierad efter att även fristående positiv kontroll saknade varning; det är inget bekräftat appfel. B1–B6 kvarstår och Gmail-schemat förblir pausat.

Poängöversikten och senaste33-raders delta nedan är aktuella. Äldre evidensavsnitt och områdesmotiv är historiska baslinjer; senare cykelbevis gäller endast sin angivna omfattning. Arbetet fortsätter inom samma budget.

## Reproducerbar bedömningsmodell

Varje område får fem delpoäng om 0–2, i steg om 0,5. Områdespoängen är exakt **F + S + K + U + P**. Översiktstabellen redovisar varje delpoäng; motiveringen och granskningsbara källorna står under respektive område. En annan granskare kan sänka en delpoäng om angivet bevis inte stödjer den.

| Del | Vad bedöms? | Förankrade nivåer |
| --- | --- | --- |
| F | Funktion mot angivna acceptanskriterier | 0: inget körbart bevis. 0,5: endast implementation identifierad. 1: ett begränsat lyckat fall. 1,5: flera centrala flöden verifierade men betydande omfattning återstår. 2: områdets centrala lokala funktioner verifierade i angiven omfattning. |
| S | Felhantering, säkerhet och dataintegritet | 0: inget bevis. 0,5: endast kodskydd identifierat. 1: konkret negativt fall. 1,5: flera oberoende felklasser. 2: dokumenterade kritiska felklasser och positiva kontrollfall täcks av exekverade regressioner. |
| K | Sammanhängande kedja | 0: ingen körning. 0,5: rena hjälpfunktioner. 1: flera samverkande delar i isolering. 1,5: verklig renderings-/HTTP-/lagringsgräns kontrollerad i en del av kedjan. 2: relevant sammanhängande lokal kedja med faktisk databas/lagring eller motsvarande realiserad integrationsgräns. |
| U | Användbarhet och driftbarhet | 0: inget bevis. 0,5: begränsad status/åtgärd. 1: användbar grund men tydliga gränssnitts-/driftluckor. 1,5: tydliga statusar, spårbarhet och betydande verifiering; minst en relevant användar-/driftkontroll återstår. 2: samtliga relevanta användar-/driftkontroller, inklusive tillgänglighet där tillämpligt, är dokumenterat accepterade. |
| P | Aktuell produktions- och leveransevidens | 0: nödvändigt verkligt utfall saknas eller krävd automatik är pausad. 0,5: befintlig publicerad grund eller begränsad läsande produktionsstatus. 1: aktuellt konkret driftutfall för området, utan full verifiering av ny kod och användarkedja. 1,5: aktuell leverans och representativt autentiserat flöde verifierade. 2: alla kritiska produktionskrav verifierade med rätt autentiska underlag och driftbevis. |

**Obligatoriska spärrar:**

- Utan erforderligt autentiserat produktionsbevis är områdets slutpoäng högst **8,5**, oavsett delsumma.
- **9,5 kräver** uppfyllda kritiska acceptanskriterier, inga kända blockerande/allvarliga fel, relevant produktionsbevis, dokumenterade gröna slutgrindar och korrekt publicerad revision när publicering ingår. En hög lokal testtäckning får inte ersätta detta.
- Saknat bevis räknas som saknat. Ett anslutet konto, konfigurerat schema, worker-kontakt eller deploymentstatus bevisar inte respektive genomfört verksamhetsflöde.
- Samtliga 33 områden väger lika i det aritmetiska totalbetyget. Kritiska blockerare redovisas separat och får inte döljas av medelvärdet.
- Halva poäng är evidensklasser, inte påstådd mätprecision. Ingen automatisk poänghöjning sker när en ny testsiffra eller SHA fylls i.

## Evidensregister och slutgrindar – historisk baslinje

Senaste grindar och browser-/produktionsgränser finns i [cykel4rapporten](docs/QUALITY-8H-CYCLE4.md) och [Site35-kvittot](docs/QUALITY-8H-SITES-CYCLE3-PUBLICATION.md). Följande tidigare register är bevarat som historik.

### E-N — Node

Slutlig full Node-körning: **377/377 tester passerade**, inga fel eller överhoppade, exit 0. `npm run check` passerade för **63 JavaScript-filer** efter sista Node-rättningen. Dokumentcykelns tidigare 368/368 avser ett tidigare källtillstånd. Revisions- och publiceringsbevis kopplas separat till leveransen.

Reproducerbara kommandon från repositoryroten:

```bash
npm ci
npm run check
npm test
npm audit
```

### E-S / G-S — Sites

**G-S: GODKÄND.** Full Sites-svit efter den sista fokusåterställningen: **456/456**, 0 fel, 0 överhoppade, exit 0. TypeScript passerade efter samma ändring. Därefter slutfördes produktionsbygget med exit 0 och `Build complete`. Den tillfälliga QA-sidan togs bort före bygget.

`sites/tests/bank-original-quality-cycle.test.mjs` täcker bland annat att borttagning av ett otillgängligt motpartsbevis inte får släppa fram ett annat okontrollerat original. Denna rättelse och den slutliga fokusåterställningen granskades oberoende. Dokumentcykelns 438/438 är historisk evidens.

```bash
cd sites
npm run install:ci
npm run check
npm test
npm run build
npm audit
```

`node --test` behöver tillåten lokal process-/socketmiljö för integrationstesterna. En sandboxspärr eller en misslyckad testkörning är inte ett godkänt resultat. Riktade red/green-körningar och fulla sviter har hållits åtskilda.

### E-UI — aktuell Chromium-kontroll

Samordnaren har använt riktig Chromium-rendering i förhandsvisning med syntetiska data och CSS-viewport i iframe vid **320, 390, 768, 1024 och 1440 px**. Varje bredd visar **fyra kort och en huvudknapp**; översikt och bankvy hade inget horisontellt överflöde. Sökning `1003` gav en träff och specifikationsfiltret en rad. Vid 390 px är den öppna native-dialogen 370 px bred utan internt överflöde. Enter öppnar och Escape stänger. Ett verkligt fokusfel reproducerades på toppnivå: Escape lämnade fokus på BODY. Efter rättelsen återställs fokus till öppningsknappen med synlig solid 3 px-kontur.

Maskinläsbar aktuell evidens: [ui-verification.json](docs/screenshots/quality-33/ui-verification.json). Syntetiska bilder: [översikt](docs/screenshots/quality-33/overview-desktop.jpg), [mobil betalningsdialog](docs/screenshots/quality-33/payment-detail-mobile.jpg), [tangentbord/fokus](docs/screenshots/quality-33/bank-keyboard-desktop.jpg).

**Avgränsning:** CSS-viewport är inte fysisk enhet eller certifiering över flera webbläsare. Mobilmenyns peksekvens är inte entydigt verifierad. Shift+Tab kunde lämna test-iframe; någon full fokusfällescertifiering påstås inte. Toppnivåns Enter/Escape/fokusretur är separat verifierad. Detta är lokal UI-evidens, **inte** ett inloggat produktionsflöde. Äldre V4-bilder är endast historiska kompletteringar.

### E-PROD — läsande observationer den 30 oktober 2026

Följande statusvärden har rapporterats från samordnarens aktuella läsande produktionskontroller. Ingen kundtext, kontouppgift, token eller originalfil återges här. Tiderna är UTC och beskriver det observerade tillståndet; de är inte löften om fortsatt drift.

| Område | Faktiskt observerat | Vad observationen inte bevisar |
| --- | --- | --- |
| Backup | 2026-10-30: komplett, **191/191 filer**, **63 448 066 byte**, verifieringstid **2026-10-30T01:27:38Z** | Inte ett utfört isolerat återställningsprov av just denna produktionsbackup eller bevis för oberoende katastrofkopia. |
| Bank | Aktiv/ansluten, befintligt **sex-timmarsintervall**, senaste synk **2026-10-30T14:09:57Z**, inga rapporterade fel | Inte individuell Swedbankrapport, samtliga rapportfält eller korrekt matchning av verkliga fakturor i den nya revisionen. |
| Gmail | Externt timschema **DISABLED**; senaste observerade hämtning **2026-10-29T15:00:48Z** | Inte fungerande aktuell timvis automatik. Ingen aktivering utförd eller antagen. |
| Moln-OCR | Senaste observerade worker-kontakt **2026-10-30T09:54:51Z** | Inte ett slutfört aktuellt OCR-jobb eller verifierad körning med användarens dator avstängd. |

Äldre rapporter kan beskriva andra antal original eller aktiva scheman. Dessa historiska värden ersätter inte observationerna ovan.

### G-D / G-P — verifierade leveransgrindar

- **G-D:** Båda projektens senaste `npm audit` rapporterar **0 sårbarheter i samtliga allvarlighetsklasser**, enligt samordnarens slutkontroll. **G-D är godkänd lokalt:** Node 377/377, Sites 456/456, syntax 63 filer, TypeScript, produktionsbygge och oberoende slutreview passerade. Exakta kommandon och omfattning finns i `docs/QUALITY-33-DELIVERY.md`. GitHub Actions för exakt programcommit är också godkänd enligt G-P.
- **G-P: GODKÄND för kod/publicering.** Programcommit `791bfae7fea426eabf277948b4be4be4b445711d` finns på main; [Actions 41077406198](https://github.com/sharbel0022/Mgeorge/actions/runs/41077406198) godkände både Node och Sites. Sites-källa `df99151555015dd5cb3e99247f6baef094847577` publicerades som **version 32**, deployment `appgdep_6ae4b30ac7b08191a538a3bf9eb0877a`, **succeeded**, runtime-revision 9. Identitet, policy, DB/R2 och schema-ID/lägen är bevarade. Läsande status och utloggad webbsida verifierade. Fullständigt inloggat webbflöde är fortfarande B2, inte godkänt genom publiceringen. Se `docs/QUALITY-33-PUBLICATION.json` och `docs/QUALITY-33-DELIVERY.md`.
- Historiskt bevis: `docs/V4-PUBLICATION.md` dokumenterar Sites **version 31** och tidigare publicering. Detta verifierar inte denna körnings ändringar.
- Produktionsdatabas, dokumentlagring, projekt/domän, användaridentitet, runtimehemligheter och anslutningar ska bevaras. Ingen destruktiv återställning, automatisk bankbetalning eller riktig kundsändning ingår i verifieringen.

## Externa blockerare

| ID | Saknat bevis eller förutsättning | Vad krävs för att stänga blockeraren? |
| --- | --- | --- |
| B1 | Autentisk individuell Swedbankrapport, rätt avtalad MIG/XSD, OCR-regel och behörig rapportkanal saknas. | Bank-/avtalsbekräftad profil och läsande kanal samt uttryckligen tillåtet anonymiserat original med kända konto-, datum-, belopps- och individuppgifter. Se `docs/V4-SWEDBANK-CHANNELS.md`. BankID och bankens skydd får inte kringgås. |
| B2 | Aktuellt autentiserat produktionsflöde för den nya leveransen är inte verifierat. | Verifiera rätt publicerad revision i befintligt projekt och tillåtna inloggade användarflöden; håll produktionsdata privata. |
| B3 | Befintligt externt Gmail-timschema är avstängt. | Fastställ om pausen är avsiktlig, hantera befintlig schemastyrning inom mandatet och verifiera verkliga efterföljande körningar/checkpoints. Ett runtimefält räcker inte. |
| B4 | Moln-OCR med avstängd användardator och aktuell lyckad slutföring är inte bevisad. | Kör godkänt syntetiskt original genom befintlig molnkanal när lokal OCR är stoppad; dokumentera originalhash, lease, sparat resultat och tider. |
| B5 | Representativ godkänd fakturakorpus och verksamhetens fullständiga acceptanspolicy saknas. | Tillåtna anonymiserade PDF-/bildoriginal med facit och dokumenterade regler för motparter, kontoändringar, krediter och undantag. |
| B6 | Produktionsbackupens isolerade katastrofprov, oberoende kopia/nyckeltillgång samt RPO/RTO saknar aktuellt bevis. | Separat tillåten återställningsmiljö, godkänd kopia och nyckelhantering; mät fullständighet och tid utan destruktiv produktionsåterställning. |

G-S, G-D och G-P är **interna leveransgrindar**, inte externa blockerare. Bristande tangentbords-, kontrast- eller navigationskontroll är också internt kvarstående arbete.

## Poängöversikt

| Nr | Område | F | S | K | U | P | Poäng / 10 | Prioritet |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Design och färger | 2 | 1,5 | 1,5 | 1,5 | 1,5 | **8** | P3 |
| 2 | Startsida | 2 | 2 | 1,5 | 1,5 | 1,5 | **8,5** | P3 |
| 3 | Navigering | 2 | 1,5 | 2 | 1,5 | 1,5 | **8,5** | P3 |
| 4 | Mobilanpassning | 2 | 2 | 1,5 | 1,5 | 1,5 | **8,5** | P3 |
| 5 | Sökning och filtrering | 2 | 1,5 | 2 | 1,5 | 0,5 | **7,5** | P3 |
| 6 | Minimal manuell hantering | 1,5 | 2 | 1,5 | 1 | 0,5 | **6,5** | P2 |
| 7 | Kundfakturor | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 8 | Leverantörsfakturor | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 9 | PDF-tolkning | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 10 | Bild-OCR | 1,5 | 2 | 2 | 1 | 0,5 | **7** | P2 |
| 11 | Gmail-anslutning | 2 | 2 | 2 | 1,5 | 0 | **7,5** | P2 |
| 12 | Automatisk fakturaregistrering | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 13 | Dubblettkontroll | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 14 | Dokumentgranskning | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 15 | Swedbank-anslutning | 2 | 2 | 2 | 1,5 | 1 | **8,5** | P1 |
| 16 | Automatisk bankhämtning | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P1 |
| 17 | Bankgiroimport | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P1 |
| 18 | Identifiera verklig betalare | 1,5 | 2 | 1,5 | 1,5 | 0 | **6,5** | P1 |
| 19 | Verklig OCR/fakturareferens | 1,5 | 2 | 1,5 | 1,5 | 0 | **6,5** | P1 |
| 20 | Automatisk betalningsmatchning | 2 | 2 | 2 | 1,5 | 0 | **7,5** | P0 |
| 21 | Delbetalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 22 | Överbetalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 23 | Flera fakturor i en betalning | 1,5 | 2 | 2 | 1,5 | 0,5 | **7,5** | P0 |
| 24 | Betalningshistorik | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 25 | Betalningsstatus | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 26 | Kontrollera alla betalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 27 | Automatiska mejlutkast | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 28 | Schemalagd automatisering | 1,5 | 2 | 2 | 1 | 0 | **6,5** | P2 |
| 29 | Säkerhetskopiering | 2 | 1 | 2 | 1,5 | 1 | **7,5** | P0 |
| 30 | Säkerhet och åtkomstkontroll | 2 | 2 | 2 | 1,5 | 1 | **8,5** | P0 |
| 31 | Katastrofåterställning | 1,5 | 1 | 2 | 1 | 0 | **5,5** | P0 |
| 32 | Kodkvalitet och tester | 2 | 2 | 2 | 1,5 | 1 | **8,5** | P4 |
| 33 | Verifiering i verklig produktion | 1,5 | 1 | 1,5 | 1 | 1,5 | **6,5** | P4 |

**Aritmetisk summa:**253,5 av330. **Likaviktat medelbetyg:**7,68/10 (253,5 ÷33). **Områden på minst9,5:**0 av33. Lägsta områdespoäng:5,5; högsta:8,5. Medelvärdet är inte ett godkännande av betalningsidentifiering, automatisering eller produktion.

Cykel4 ändrar endast de uttryckligt redovisade delpoängen i senaste deltatabellen. Alla övriga delpoäng och prioriteringar är oförändrade. Den tidigare leveransens poängmotiv finns kvar som historik; ny push eller Site-version ger ingen automatisk höjning.

## Baslinjens acceptanskriterier och områdesmotiv

### 1. Design och färger — 6,5/10

- **Acceptanskriterier:** Svartvit sammanhängande design; tydliga tillstånd och kontraster; viktiga ekonomifakta ska kunna läsas utan tekniska detaljer.
- **Verifierat:** Neutrala översikts- och bankvyer, fyra kort och separerade bankfakta. Chromium-kontrollen E-UI visar inga horisontella överflöden i de två granskade vyerna.
- **Exakta tester och resultat:** `test/bank-ui.test.js`, `test/payment-control-ui.test.js` och `sites/tests/bank-payment-ui.test.mjs`: sex huvudfält, okänd betalare/OCR, separerad fakturareferens och escaperad text. Node ingår i E-N; Sites i E-S.
- **Kod-, API- eller UI-evidens:** `sites/components/economy-overview.tsx`, `sites/components/bank-payments.tsx`, `sites/lib/payment-presentation.ts`; E-UI samt historisk designgranskning i `docs/SITES-MONOCHROME-REVIEW.md`.
- **Återstående problem:** Bankdialogens fokusretur och synliga fokusmarkering är nu kontrollerade. Fullständig kontrastmätning, fokusordning och samtliga övriga formulär/dialoger är inte aktuellt granskade.
- **Prioritet och nästa åtgärd:** P3. Kontrollera kontrast, fokus och fel-/tomlägen på alla huvudvyer; dokumentera den publicerade versionens design.
- **Produktionsverifiering / extern blockerare:** Ja, publicerade huvudvyer. B2; tillgänglighetsgranskningen är dessutom ett internt kvarstående arbete.

### 2. Startsida — 7,5/10

- **Acceptanskriterier:** Fyra ekonomisammanfattningar; en huvudknapp Kontrollera alla betalningar; okända eller ofullständiga värden får inte visas som verifierade nollor.
- **Verifierat:** Fyra kort och huvudåtgärd finns. Laddning/fel ger okända värden. Konflikter och saknade original räknas inte som verifierade månadsinbetalningar.
- **Exakta tester och resultat:** `sites/tests/payment-control-ui.test.mjs`: fyra okända kort innan laddning och dolda gamla belopp vid fel. `sites/tests/economy-quality-cycle.test.mjs`: manuella original, konflikter, saknade original och ofullständigt referensbevis ger inte verifierade intäkter. `test/payment-control-ui.test.js`: huvudåtgärd och åtskilda kontrollerade/obekräftade totalsummor. E-N/E-S; nya sena Sites-fall omfattas av G-S.
- **Kod-, API- eller UI-evidens:** `sites/lib/economy-summary.js`, `sites/lib/payment-overview.ts`, `src/payment-overview.js`, `sites/components/economy-overview.tsx`; E-UI.
- **Återstående problem:** De faktiska företagsbeloppen har inte jämförts med ett komplett autentiskt bankunderlag i inloggad produktion.
- **Prioritet och nästa åtgärd:** P3. Verifiera kortens belopp och klickvägar mot behörigt företagsunderlag efter slutlig publicering.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2 för ekonomisk fullständighet.

### 3. Navigering — 5/10

- **Acceptanskriterier:** Fakturor, bank, dokument, meddelanden och inställningar ska nås begripligt; återgång, markerad aktiv vy och tangentbordsvägar ska fungera.
- **Verifierat:** Översikt, banklista och granskningsåtgärder finns; renderade navigationsvägar och historiklänkar täcks av tester. Bankdialogens Enter/Escape och återgång till öppningsknappen är aktuellt verifierade i Chromium.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`: fem menyområden och bevarad navigering till import/meddelandehistorik. `sites/tests/payment-control-ui.test.mjs`: vald evidens bredvid granskningslistan och en åtgärd per uppgift. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `sites/components/payment-control.tsx`, `sites/components/bank-payments.tsx`, `sites/components/payment-history.tsx`; tidigare flöden beskrivs i `docs/ONE-CLICK-PAYMENT-CONTROL.md`.
- **Återstående problem:** Ingen komplett aktuell genomgång av alla menylänkar, bakåt/framåt och tangentbordsflöden har avslutats. Mobilmenyns peksekvens är uttryckligen inte verifierad; dialogtestet bevisar inte en fullständig fokusfälla.
- **Prioritet och nästa åtgärd:** P3. Genomför en dokumenterad navigationsmatris med tangentbord och webbläsarhistorik på samtliga huvudvyer.
- **Produktionsverifiering / extern blockerare:** Ja. B2; den saknade navigationsmatrisen är ett internt arbete.

### 4. Mobilanpassning — 7/10

- **Acceptanskriterier:** 320, 390, 768, 1024 och 1440 px ska fungera utan dokumentöverflöde; kontroller, tabeller, dialoger och fokus ska vara användbara.
- **Verifierat:** Riktig Chromium-rendering vid alla fem bredder visar fyra översiktskort och bankvy utan horisontellt överflöde. Mobilvyn behåller bankfakta och saknad OCR.
- **Exakta tester och resultat:** `sites/tests/bank-payment-ui.test.mjs`: sex fakta på desktop och explicit saknad OCR på mobil. `sites/tests/payment-control-ui.test.mjs` och `test/payment-control-ui.test.js`: åtgärds- och laddningstillstånd. E-UI är aktuell visuell evidens; historiska V4-dialogtester är endast kompletterande.
- **Kod-, API- eller UI-evidens:** `sites/components/bank-payments.tsx`, `sites/components/economy-overview.tsx`; aktuell `docs/screenshots/quality-33/ui-verification.json`. V4:s motsvarande fil är enbart historisk evidens.
- **Återstående problem:** Bankens native-dialog är nu kontrollerad vid 390 px: 370 px bred utan överflöde, Enter/Escape och återställt fokus på toppnivå. Övriga formulär/dialoger, skärmtangentbord, hjälpmedel, fysisk enhet och mobilmenyns peksekvens återstår.
- **Prioritet och nästa åtgärd:** P3. Utöka samma fem bredder till dokumentgranskning, fakturadetalj, inloggning och öppna dialoger.
- **Produktionsverifiering / extern blockerare:** Ja. B2; resterande responsivitet kan först verifieras lokalt.

### 5. Sökning och filtrering — 7/10

- **Acceptanskriterier:** Sökning efter fakturanummer inklusive nollor, kund och referens; förutsägbara filter; inga tysta bortfall eller förslag som blir bankfakta.
- **Verifierat:** I aktuell Chromium-demo gav sökning 1003 en träff och specifikationsfiltret en rad. Referenser hålls åtskilda från bankens faktiska OCR.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`: köfilter och exkludering av samlingsposter/återbetalningar från identifiering. `sites/tests/invoice-candidates.test.mjs`, `sites/tests/bank-payment-ui.test.mjs`: fakturakandidater och bevisseparation. E-N/E-S; faktisk sökning/filter i E-UI.
- **Kod-, API- eller UI-evidens:** `sites/components/payment-bank-filter.ts`, `sites/lib/bankgiro-invoice-search.ts`, `sites/lib/banking/invoice-candidates.ts`.
- **Återstående problem:** Stora företagsdatamängder, kombinerade filter, tomresultat, återställning och full tangentbordsanvändning är inte slutverifierade.
- **Prioritet och nästa åtgärd:** P3. Testa filterkombinationer och nollprefix på representativ större syntetisk datamängd och därefter i behörig produktionsvy.
- **Produktionsverifiering / extern blockerare:** Ja. B2; volym- och tangentbordsfallen är interna nästa steg.

### 6. Minimal manuell hantering — 6,5/10

- **Acceptanskriterier:** Säkra fall ska hanteras automatiskt; osäkra fall ska samlas en gång med tydlig nästa åtgärd; ingen minskning av beviskraven.
- **Verifierat:** Samordnad kontroll, beständiga jobb, dokumentkö och säkra automatiska matchningar finns. Osäkra bilagor bevaras nu och felaktigt gröna dokument stoppas.
- **Exakta tester och resultat:** `test/payment-control.test.js`, `sites/tests/payment-control.test.mjs`: idempotent kontroll, begränsade försök, en uppgift per betalning. Båda `document-quality-cycle`-filerna: ofullständiga fält och motstridig metadata kräver granskning. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/payment-control.js`, `sites/lib/payment-control.ts`, `src/invoice-review.js`, `sites/lib/document-processing.ts`.
- **Återstående problem:** Ingen mätning av faktisk manuell tid eller andel säkra automatfall. Gmail-schemat är pausat; verkliga bankdetaljer saknas.
- **Prioritet och nästa åtgärd:** P2. Mät genomströmning, automationsgrad och kvarvarande undantag över en kontrollerad driftperiod utan att lätta på säkerhetsregler.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B3, B4 och B5.

### 7. Kundfakturor — 8/10

- **Acceptanskriterier:** Exakt fakturanummer/kund/valuta/belopp; korrekt saldo och kredit-/återbetalningshantering; verifierade kopplingar och bevarade original.
- **Verifierat:** Fakturaregister, heltalsören, uttrycklig granskning, saldo och originalkoppling är testade. Förslag ändrar inte saldo; återbetalningar kan inte automatiskt reglera vanliga kundfakturor.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`, `test/db.test.js`, `test/node-payments-quality-cycle.test.js`: fält, registrering, saldo och kredit/återbetalningsgränser. `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`, `sites/tests/sites-payments-quality-cycle.test.mjs`: motsvarande ekonomiska regler. E-N/E-S och G-S för sena originalfall.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/invoice-review.js`, `sites/lib/domain.ts`, `sites/components/invoice-evidence.tsx`.
- **Återstående problem:** Fullständigt autentiskt kundfakturaflöde till bankavstämning och aktuell inloggad UI-granskning saknas.
- **Prioritet och nästa åtgärd:** P0. Kontrollera kundfaktura, eventuell kredit och betalningssaldo mot tillåtet original i den publicerade versionen.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2 och B5.

### 8. Leverantörsfakturor — 8/10

- **Acceptanskriterier:** Rätt leverantör, organisationsnummer, förfallodag, moms, netto och betalningskonto; inga dubbla skulder eller automatiskt accepterade kontoändringar.
- **Verifierat:** Leverantörsriktning och utgående betalningar testas. Node återanvänder endast mänskligt granskad identitet/konto med intakt original; ändrat Bankgiro eller saknad moms/netto stoppar automatik.
- **Exakta tester och resultat:** `test/document-quality-cycle.test.js`: ändrat Bankgiro, saknad moms/netto och ogranskad identitet skapade tidigare extra faktura och stoppas nu. `sites/tests/gmail.test.mjs`: verifierad motpart, kontoavvikelse, ändrat belopp och dubbletter. `sites/tests/bank-payment-ui.test.mjs` och matchningstesterna täcker riktning. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/lib/reconciliation-engine.js`.
- **Återstående problem:** Företagets kompletta motpartspolicy och representativa verkliga leverantörslayouter är inte accepterade i produktion.
- **Prioritet och nästa åtgärd:** P0. Verifiera policy för kontoändring, krediter och nya leverantörer med anonymiserade godkända original; kontrollera granskningsflödet.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5; policybeslut krävs där regler saknas.

### 9. PDF-tolkning — 8/10

- **Acceptanskriterier:** Text-PDF ska läsas inom gränserna; skannade PDF ska gå vidare till OCR; ogiltiga fält, motstridiga källor och ändrade original får inte bli verifierade.
- **Verifierat:** Fältextraktion bevarar nollor och källtext. Ogiltiga extra värden kan inte längre döljas av ett giltigt värde. Sites kontrollerar PDF-originalets hash och storlek före tolkning.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: riktig syntetisk text-PDF, skannad PDF och ogiltig PDF. Båda `document-quality-cycle`-filerna: felaktiga totalsummor/datum/orgnr, metadata och bevarade källor. `sites/tests/server-pdf.test.mjs`: parsergränser. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-extraction.js`, `src/invoice-worker.js`, `sites/lib/invoice-fields.js`, `sites/lib/server-pdf.ts`, `sites/lib/document-processing.ts`.
- **Återstående problem:** Verklig layoutvariation och feldetekteringsgrad har inte mätts mot en representativ märkt fakturakorpus.
- **Prioritet och nästa åtgärd:** P0. Bygg godkänd anonymiserad facitkorpus och mät fältexakthet samt falskt gröna resultat per layout.
- **Produktionsverifiering / extern blockerare:** Ja för precision i företagets underlag. B5; originalkorpusen saknas.

### 10. Bild-OCR — 7/10

- **Acceptanskriterier:** PNG/JPEG/WebP och skannade PDF ska behandlas säkert; osäkra OCR-fält ska granskas; molnbehandling ska bevisas med datorn avstängd.
- **Verifierat:** Svensk Tesseract körs faktiskt i syntetiska integrationstester. OCR-resultat har begränsad säkerhetsgrad, leasing och bevarade original. Senaste observerade molnkontakt är 09:54:51Z den 30 oktober.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: PNG/JPEG/WebP och skannad PDF. `sites/tests/cloud-ocr.test.mjs`: faktisk pull-klient till Sites-jobb, privat lagringsfixture, Tesseract och sparad tolkning. `test/sites-ocr-pull.test.js`: hash, gränser och fel. E-N/E-S; kontaktstatus E-PROD är inte ett färdigt jobb.
- **Kod-, API- eller UI-evidens:** `src/invoice-worker.js`, `src/sites-ocr-pull.js`, `sites/lib/document-processing.ts`, `.github/workflows/sites-cloud-ocr.yml`; `docs/V3-CLOUD-OCR-RUNNER.md`.
- **Återstående problem:** Ingen aktuell produktionstest med avstängd användardator och verifierat slutfört molnjobb. Inga representativa precisionstal.
- **Prioritet och nästa åtgärd:** P2. Kör ett godkänt syntetiskt original genom befintlig molnkörning när lokal OCR är stoppad; jämför resultat/hash och dokumentera jobbtider.
- **Produktionsverifiering / extern blockerare:** Ja. B4 och B5.

### 11. Gmail-anslutning — 7/10

- **Acceptanskriterier:** Rätt konto, läsbehörighet, säkra tokens, beständiga checkpoints och faktiskt återkommande hämtning; ansluten får inte förväxlas med lyckad körning.
- **Verifierat:** OAuth, kontoägare, Retry-After, förlorade svar och leasebyte testas. Statusanrop är nu begränsade och läsande. Osäkra original sparas i stället för att kastas på grund av rubrik/filnamn.
- **Exakta tester och resultat:** `test/gmail.test.js`, `test/gmail-api.test.js`, `sites/tests/gmail.test.mjs`: konto, scopes, idempotens, sena svar och status utan dokumenttext/sidoeffekter. Båda dokumentkvalitetssviterna: fem osäkra bilagor behålls, inline-logo filtreras. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/gmail.js`, `sites/lib/gmail-adapter.js`, `sites/lib/gmail-service.ts`, `sites/lib/banking/mcp.ts`, `sites/components/gmail-summary.tsx`; E-PROD.
- **Återstående problem:** Det externa timschemat är DISABLED. Senaste observerade hämtning är 2026-10-29T15:00:48Z; aktuell automatisk leverans är alltså inte verifierad.
- **Prioritet och nästa åtgärd:** P2. Fastställ varför befintligt schema är pausat, hantera pausen i dess rätta styrning och verifiera nya faktiska körningar/checkpoints.
- **Produktionsverifiering / extern blockerare:** Ja. B3 och B2. Ingen aktivering påstås vara utförd.

### 12. Automatisk fakturaregistrering — 7,5/10

- **Acceptanskriterier:** Endast fullständiga, konfliktfria, entydiga och företagsverifierade underlag får registreras automatiskt; korrekta original och motpart måste finnas vid beslutet.
- **Verifierat:** Grön extraktion, verifierad motpart, konto/valuta, moms/netto, dubblettkontroll och atomiskt registreringsbeslut finns. Förlorad lease, kontoavvikelse och osäker OCR förhindrar registrering.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: opt-in och kända identiteter. `test/document-quality-cycle.test.js`: mänskligt granskningsbevis och originalintegritet. `sites/tests/gmail.test.mjs`: registrering en gång, kontoavvikelse och manuell registrering under lease. `sites/tests/document-quality-cycle.test.mjs`: originalhash/storlek före PDF. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`; historisk policy i `docs/SITES-DOCUMENT-AUTOMATION.md`.
- **Återstående problem:** Företagets kompletta acceptanspolicy och verklig automatisk genomströmning är inte verifierade; pausad Gmail-hämtning begränsar kedjan.
- **Prioritet och nästa åtgärd:** P2. Godkänn explicita motparts-/kontoregler och följ säkra samt osäkra provfall genom publicerad registrering med full revisionskedja.
- **Produktionsverifiering / extern blockerare:** Ja. B2, B3 och B5.

### 13. Dubblettkontroll — 8/10

- **Acceptanskriterier:** Samma original, faktura eller ekonomiska betalning får inte räknas två gånger; kopior, återförsök, omstart och konkurrens ska bevara historiken.
- **Verifierat:** Originalhash/source-id och semantisk fakturaidentitet kontrolleras. Kopior och olika belopp på samma faktura stoppas. Betalningsdubbletter och samlingsposter testas separat.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: samma bytes i två mejl, alternativ PDF-kopia, explicit koppling till befintlig faktura. `sites/tests/gmail.test.mjs`: kopia och ändrat belopp skapar inte ny skuld. `test/payment-concurrency.test.js`, `sites/tests/sites-payments-quality-cycle.test.mjs`: parallell import och samlingspost en gång. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/lib/domain.ts`; revisions- och registreringstabeller.
- **Återstående problem:** Historiska namn-/organisationsändringar och företagets fakturanummerserier har inte genomgått full produktionsinventering. Tester bevisar inte frånvaro av alla historiska dubbletter.
- **Prioritet och nästa åtgärd:** P0. Gör läsande dubblettanalys av tillåten historik och kontrollera nya varianter med syntetiska reproduktioner före eventuell rättning.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5; inga riktiga poster har ändrats för test.

### 14. Dokumentgranskning — 7,5/10

- **Acceptanskriterier:** Osäkra dokument ska finnas kvar med original, fältekälla, konflikter, korrigering och tolkningshistorik; en granskning ska inte döljas som noll eller klar.
- **Verifierat:** Missvisande filnamn/rubriker och ogiltiga extrafält kräver granskning. Node bevarar varje tolkning i audit. Sites har separat tolkningshistorik; avvisning raderar inte original.
- **Exakta tester och resultat:** Båda `document-quality-cycle`-filerna: källkonflikt, terms-rubrik med fakturabevis och oläslig logo. `sites/tests/gmail.test.mjs`: avvisning avbryter lease utan originalförlust. `sites/tests/payment-control-ui.test.mjs`: läsbar evidens bredvid vald granskning och laddning skild från tom kö. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/components/invoice-evidence.tsx`, `sites/components/gmail-workspace.tsx`.
- **Återstående problem:** Aktuell fullständig användargranskning med tangentbord, dokumentförhandsvisning och rättad faktura har inte körts i inloggad produktion.
- **Prioritet och nästa åtgärd:** P2. Verifiera från kö till original, fältkorrigering, historik och slutligt beslut på desktop och mobil.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5.

### 15. Swedbank-anslutning — 8,5/10

- **Acceptanskriterier:** Aktiv ägd anslutning, uttryckligt kontoval, korrekt medgivande/utgång och säkra fel; förnyelse får inte duplicera ekonomiska poster.
- **Verifierat:** Bankstatus visar aktiv anslutning, sex timmars automatik och inga rapporterade fel. Kontoägare, konto-UID-förnyelse, callback, behörighet och cooldown testas isolerat.
- **Exakta tester och resultat:** `test/bank-api.test.js`: inloggning, kontoval, fel ägare, återkallat medgivande och förnyad kontoidentitet. `sites/tests/banking-security.test.mjs`, `sites/tests/banking-provider.test.mjs`: samma ägar-/token-/kontoegenskaper. E-N/E-S; aktuell status i E-PROD.
- **Kod-, API- eller UI-evidens:** `src/bank.js`, `sites/lib/banking/service.ts`, `sites/lib/banking/store.ts`, `sites/components/bank-connection.tsx`.
- **Återstående problem:** Anslutningsstatus verifierar inte tillgång till individuella Bankgirobetalare eller det nya kodpaketets samtliga produktionsflöden.
- **Prioritet och nästa åtgärd:** P1. Efter publicering kontrollera samma anslutning, kontoägarskap och rapporterade körtider; håll individuell rapportåtkomst separat.
- **Produktionsverifiering / extern blockerare:** Ja. B2; B1 gäller individuell rapportering, inte att AIS-anslutningen existerar.

### 16. Automatisk bankhämtning — 8/10

- **Acceptanskriterier:** Endast valda konton, leverantörens intervall och beständiga lås; återförsök får inte duplicera belopp eller fabricera klientkontext.
- **Verifierat:** Sex-timmarsautomatik och senaste lyckade bankhämtning 2026-10-30T14:09:57Z observerades. Lås, försök, stabila tidsfönster och omstartsfencing testas.
- **Exakta tester och resultat:** `test/integration-jobs.test.js`, `test/integration-job-api.test.js`, `test/bank-api.test.js`: beständig lease/cooldown. `sites/tests/banking-security.test.mjs`: inga fabricerade PSU-fält, stabila Stockholmstider, återhämtning och sex-timmarsgräns. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/integration-jobs.js`, `sites/lib/banking/service.ts`; E-PROD och historiska `docs/SWEDBANK-AUTOMATIC.md`.
- **Återstående problem:** En observerad senaste körning är inte en verifierad serie av schemakörningar över driftstörning och återstart för den nya revisionen.
- **Prioritet och nästa åtgärd:** P1. Följ flera planerade körningar och verifiera tidsgränser, antal importer och idempotens med läsande efterkontroll.
- **Produktionsverifiering / extern blockerare:** Ja. B2; B1 blockerar separat automatisk individuell rapporthämtning.

### 17. Bankgiroimport — 8/10

- **Acceptanskriterier:** CSV/camt ska validera konto, riktning, datum, valuta, referenser, antal och totalsumma; original ska finnas; förälder och detaljer räknas en gång.
- **Verifierat:** Syntetiska camt/CSV-grupper, originalhash, fel struktur och flera detaljer är testade. En andra specifikation kan inte förbruka en redan ersatt samlingsinsättning.
- **Exakta tester och resultat:** `test/importers.test.js`, `test/camt-integrity.test.js`, `test/file-account-evidence.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bankgiro.test.mjs`, `sites/tests/bankgiro-api.test.mjs`, `sites/tests/camt-integrity.test.mjs`, `sites/tests/sites-payments-quality-cycle.test.mjs`. E-N/E-S. Sena kontroller av kvarvarande original: `sites/tests/bank-original-quality-cycle.test.mjs`, G-S.
- **Kod-, API- eller UI-evidens:** `src/importers.js`, `src/db.js`, `sites/lib/camt-xml.js`, `sites/lib/bankgiro-parser.js`, `sites/lib/bankgiro-service.ts`.
- **Återstående problem:** Ingen autentisk individuell företagsrapport med rätt avtalad MIG/XSD har verifierats. Generell XML-validering är inte full bankprofilcertifiering; Bg Max är inte verifierat stöd.
- **Prioritet och nästa åtgärd:** P1. Validera en godkänd anonymiserad originalrapport mot företagets exakta profil och kända samlingspost.
- **Produktionsverifiering / extern blockerare:** Ja. B1 är uttrycklig extern blockerare.

### 18. Identifiera verklig betalare — 6,5/10

- **Acceptanskriterier:** Bankens betalare ska vara spårbar till autentiskt underlag och skiljas från fakturakund, manuell relation och förslag; saknad identitet ska sägas uttryckligen.
- **Verifierat:** Kod och syntetiska tester separerar bankidentitet, kund och manuell komplettering. Motstridig bankidentitet spärras och bevaras; beloppslikhet ger ingen betalare.
- **Exakta tester och resultat:** `test/bank-ui.test.js`, `test/payment-control-ui.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bank-payment-ui.test.mjs`, `sites/tests/bank-details.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`. E-N/E-S; ingen testfixture är ett autentiskt Swedbankbevis.
- **Kod-, API- eller UI-evidens:** `src/bank-evidence.js`, `src/reconciliation.js`, `sites/lib/payment-presentation.ts`, `sites/lib/banking/detail-evidence.ts`; `docs/V4-SWEDBANK-CHANNELS.md`.
- **Återstående problem:** Företagets autentiska individuella rapport och avtalade leveranskanal saknas. Verklig betalaridentifiering är därför inte produktionsverifierad.
- **Prioritet och nästa åtgärd:** P1. Hämta behörigt original med känd betalare via avtalad läsande kanal och spåra varje visat fält till källan.
- **Produktionsverifiering / extern blockerare:** Ja, obligatoriskt autentiskt bevis. B1 och B2.

### 19. Verklig OCR/fakturareferens — 6,5/10

- **Acceptanskriterier:** Endast uttryckliga betalningsreferenser med källa; nollor och skiljetecken bevaras; eget Bankgiro, intern bankreferens eller förslag får inte bli OCR.
- **Verifierat:** Referensextraktion och presentationsregler separerar fakturanummer, OCR och intern bankreferens. Motstridiga kandidater och felaktiga uttryckliga OCR-värden kräver granskning.
- **Exakta tester och resultat:** `test/payment-references.test.js`, `test/bank-reference-storage.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/payment-references.test.mjs`, `sites/tests/bank-payment-ui.test.mjs`: nollor, källvägar, falsk OCR och konflikter. E-N/E-S; sena kontrollsifferfall omfattas av senaste E-N.
- **Kod-, API- eller UI-evidens:** `src/payment-references.js`, `sites/lib/payment-references.js`, `sites/lib/payment-presentation.ts`, `sites/lib/camt-xml.js`.
- **Återstående problem:** Faktisk Swedbankfältprofil, företagets OCR-längd-/kontrollavtal och autentiskt individuellt original saknas. Giltig kontrollsiffra ersätter inte dessa bevis.
- **Prioritet och nästa åtgärd:** P1. Bekräfta profil och OCR-avtal och jämför bevarade fält med ett autentiskt individuellt bankunderlag.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2; detta område får inte godkännas genom enbart syntetiska tester.

### 20. Automatisk betalningsmatchning — 7,5/10

- **Acceptanskriterier:** Bokförd betalning, rätt riktning/valuta/konto, entydig referens och faktura, verifierad motpart, tillgängligt original och korrekt återstående saldo krävs.
- **Verifierat:** Återbetalningar, egna överföringar, löner och kortuttag kan inte reglera vanliga fakturor automatiskt. Stabilt bank-ID med motstridiga fakta spärras, gamla original och allokeringar bevaras för granskning.
- **Exakta tester och resultat:** `test/reconciliation.test.js`, `test/node-payments-quality-cycle.test.js`, `test/payment-concurrency.test.js`; `sites/tests/sites-payments-quality-cycle.test.mjs`, `sites/tests/customer-messages.test.mjs`. E-N/E-S. `sites/tests/bank-original-quality-cycle.test.mjs` prövar saknat original, föräldraoriginal och borttagna motpartsbevis; fasta-punkt-fallet ingår i det godkända 456-resultatet. G-S omfattar den godkända återkörningen efter sista fokusfixen.
- **Kod-, API- eller UI-evidens:** `src/reconciliation.js`, `src/db.js`, `sites/lib/reconciliation.ts`, `sites/lib/reconciliation-engine.js`, `sites/lib/reconciliation-evidence.ts`.
- **Återstående problem:** Ingen fullständig jämförelse mot autentiska individuella företagsbetalningar. Originalvalideringen, den slutliga G-S-körningen och publiceringsgrindarna är godkända. Jämförelse mot autentiska bankunderlag och fullständig inloggad produktionsverifiering återstår.
- **Prioritet och nästa åtgärd:** P0. Genomför en läsande jämförelsekörning mot godkända autentiska data och ett tillåtet inloggat produktionsflöde; verifiera att inga förslag ändrar saldo.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2. G-S är en avslutad intern leveransgrind, inte en extern blockerare.

### 21. Delbetalningar — 8/10

- **Acceptanskriterier:** Exakta ören och återstående saldo, flera verifierade betalningar över tid samt återtagning utan dubbel allokering.
- **Verifierat:** Verifierade delbetalningar reducerar saldo; förslag gör det inte. Aktiva allokeringar, otillräckligt belopp och återtagning är testade.
- **Exakta tester och resultat:** `test/db.test.js`, `test/reconciliation.test.js`, `test/customer-messages.test.js`; `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`: delbetalning lämnar exakt 625 SEK i det syntetiska fallet. `sites/tests/bank-payment-ui.test.mjs`: delbetalningsstatus även när bankraden är fullt allokerad. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `sites/lib/domain.ts`, `sites/lib/payment-presentation.ts`.
- **Återstående problem:** Verkliga delbetalningsserier och eventuella bankavgifter är inte avstämda i aktuell produktion.
- **Prioritet och nästa åtgärd:** P0. Kontrollera en känd delbetalningsserie och visa fakturasaldo samt varje bankkoppling med oförändrade original.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2 och behörigt jämförelseunderlag.

### 22. Överbetalningar — 8/10

- **Acceptanskriterier:** Överskott ska vara synligt och behållas i exakta ören; ingen automatisk utbetalning eller ogrundad omfördelning.
- **Verifierat:** Fakturasaldo, allokerat belopp och disponibelt överskott skiljs åt. Utkast kan beskriva verifierat överskott men skickas inte automatiskt.
- **Exakta tester och resultat:** `test/customer-messages.test.js`: verkligt bankbelopp och ej allokerat överskott behålls. `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`: exakt betalning/överskott/flera betalningar. UI-sviterna visar överskott skilt från bankradens allokering. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/customer-messages.js`, `sites/lib/domain.ts`, `sites/lib/customer-messages.ts`.
- **Återstående problem:** Inget autentiskt produktionsfall med överskott och administrativ åtgärd har slutverifierats.
- **Prioritet och nästa åtgärd:** P0. Verifiera ett godkänt överbetalningsfall inklusive ofördelat belopp och eventuellt granskat utkast; genomför ingen bankbetalning.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2.

### 23. Flera fakturor i en betalning — 7,5/10

- **Acceptanskriterier:** En bankbetalning ska kunna fördelas kontrollerat mellan flera fakturor utan att totalen överskrids; beloppskombinationer får inte uppfinna referenser.
- **Verifierat:** Explicit manuell fördelning och överallokeringsspärrar finns. Flera referenskandidater behandlas konservativt och skapar inte en automatisk beloppskombination.
- **Exakta tester och resultat:** `test/db.test.js`, `test/reconciliation.test.js`, `test/payment-references.test.js`; `sites/tests/domain.test.mjs`, `sites/tests/economy.test.mjs`: två referenser förblir fördelningsförslag och saldon bevaras. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/reconciliation.js`, `sites/lib/domain.ts`, `sites/lib/reconciliation-engine.js`.
- **Återstående problem:** Företagets fullständiga flerfaktura-/kreditpolicy och aktuellt inloggat fördelningsflöde saknar produktionsacceptans. Säker automatik för alla sådana fall påstås inte finnas.
- **Prioritet och nästa åtgärd:** P0. Definiera tillåtna fördelningsbeslut och verifiera ett autentiskt flerfakturafall med total, återtagning och revisionshistorik.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2 samt tydlig verksamhetspolicy.

### 24. Betalningshistorik — 8/10

- **Acceptanskriterier:** Ursprungliga fakta, verifieringar, korrigeringar och återtagningar ska kunna följas; historiken ska vara ägarisolerad och inte kapas av en global senaste-lista.
- **Verifierat:** Äldre verifieringar, paginering, återtagna kopplingar och förälder/detaljhistorik är testade. Konflikter skriver inte över ursprungliga bankfakta.
- **Exakta tester och resultat:** `sites/tests/payment-history.test.mjs`: poster äldre än senaste 100, stabil paginering, fel ägare/cursor, defekta äldre auditpayloads och parent/child. `test/node-payments-quality-cycle.test.js`: ursprungsfakta och befintliga allokeringar bevaras vid konflikt. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `sites/lib/payment-history.ts`, `sites/components/payment-history.tsx`, `src/db.js`; revisionsfält i båda databaserna.
- **Återstående problem:** Företagets större historik, åtkomst och användbarhet i aktuell publicerad vy är inte fullständigt granskade.
- **Prioritet och nästa åtgärd:** P0. Kontrollera en äldre verklig betalningskedja läsande, inklusive rättelse och original, utan att ändra historiken.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och behörigt historiskt underlag.

### 25. Betalningsstatus — 8/10

- **Acceptanskriterier:** Betald, delbetald, överbetald, ej avstämd och behöver granskning ska bero på verifierade kopplingar/saldo; saknat original eller konflikt får inte beskrivas som verifierat.
- **Verifierat:** Status bygger på saldo och bevis. En allokering i sig kan inte lära ut ny motpartsidentitet när underlaget är i konflikt; osäkra mottagna belopp visas inte som verifierad månadsintäkt.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`, `test/payment-control-api.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bank-payment-ui.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`: ofullständig referens, konflikt, originalbrist och obekräftade nollor. E-N/E-S och G-S för sena originalfall.
- **Kod-, API- eller UI-evidens:** `src/payment-overview.js`, `sites/lib/payment-presentation.ts`, `sites/lib/economy-summary.js`, `sites/lib/payment-overview.ts`.
- **Återstående problem:** Ingen aktuell produktionsjämförelse av samtliga statusklasser mot bankoriginal och fakturasaldo.
- **Prioritet och nästa åtgärd:** P0. Verifiera en tabell av faktiska godkända statusfall och tillhörande beviskedjor efter publicering.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2.

### 26. Kontrollera alla betalningar — 7,5/10

- **Acceptanskriterier:** En tydlig huvudåtgärd ska samordna befintlig hämtning, tolkning, kontroll och kö; vara återupptagbar/idempotent och aldrig skicka mejl eller genomföra betalning.
- **Verifierat:** Beständiga körningar, ägarbundna anrop, idempotensnyckel, samtidighet och väntetider finns. Förlorat svar återanvänder samma begäran. Delvis resultat visas som delvis.
- **Exakta tester och resultat:** `test/payment-control.test.js`, `test/payment-control-api.test.js`, `test/payment-control-ui.test.js`; `sites/tests/payment-control.test.mjs`, `sites/tests/payment-control-ui.test.mjs`: en autentiserad kontroll, CSRF, återförsök, stale cache och inga kundutskick. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/payment-control.js`, `sites/lib/payment-control.ts`, `sites/components/payment-control.tsx`; E-UI visar huvudknappen, inte en körning mot företagsdata.
- **Återstående problem:** Hela knappen har inte körts och jämförts mot verkliga företagsdata i den nya publicerade versionen. Gmail-paus och saknade rapporter begränsar fullständigheten.
- **Prioritet och nästa åtgärd:** P2. Efter grön leverans kontrollera behörigt end-to-end-flöde med tydliga förväntade delresultat och bevarade scheman.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2, B3 och B4.

### 27. Automatiska mejlutkast — 8/10

- **Acceptanskriterier:** Sakliga utkast från verifierade belopp; ingen ogrundad betalningsanklagelse; exakt aktuell version och mottagare måste godkännas innan sändning.
- **Verifierat:** Systemet förbereder utkast. Betalning eller redigering ogiltigförklarar gammalt granskningsbevis. Dubbelklick ger en sändningsreservation; okänd leverans får inte automatiskt skickas igen.
- **Exakta tester och resultat:** `test/customer-messages.test.js`, `test/customer-messages-api.test.js`, `test/gmail-send.test.js`; `sites/tests/customer-messages.test.mjs`: mottagarverifiering, ofullständigt momsunderlag, stale version, fel webbläsare, timeout och inga schedulerutskick. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/customer-messages.js`, `sites/lib/customer-messages.ts`, `sites/components/customer-messages.tsx`; syntetiska provideradaptrar används i tester.
- **Återstående problem:** Aktuell administratörsgranskning av utkast/mottagare i produktion har inte kontrollerats. Inga riktiga kundmejl har skickats i denna körning.
- **Prioritet och nästa åtgärd:** P2. Verifiera läsande ett kontrollerat utkast och dess källor; faktisk sändning kräver uttryckligt godkännande av den aktuella versionen.
- **Produktionsverifiering / extern blockerare:** Ja för produktionsflödet. B2; testgrönt sändningsflöde är inte sändningsgodkännande.

### 28. Schemalagd automatisering — 6/10

- **Acceptanskriterier:** Bank, Gmail, OCR och backup ska köras inom godkända intervall; faktisk körning, paus, väntetid, fel och senaste lyckade utfall ska skiljas åt.
- **Verifierat:** Beständiga lås/backoff, tre-försöksgränser, leasebyte och begränsade statusanrop är testade. Bank och backup har aktuella drifttecken, men Gmail-timschemat är avstängt.
- **Exakta tester och resultat:** `test/integration-jobs.test.js`, `test/integration-job-api.test.js`, `sites/tests/banking-security.test.mjs`, `sites/tests/gmail.test.mjs`, `sites/tests/cloud-ocr.test.mjs`, båda backupsviterna: omstart, sena svar, cooldown och kontakt skild från slutfört jobb. E-N/E-S; E-PROD.
- **Kod-, API- eller UI-evidens:** `src/integration-jobs.js`, `sites/lib/banking/service.ts`, `sites/lib/gmail-service.ts`, `.github/workflows/sites-cloud-ocr.yml`, `sites/lib/backup-engine.ts`.
- **Återstående problem:** Det avstängda Gmail-schemat och avsaknad av bevis för aktuell avslutad moln-OCR gör att obemannad helhet inte är verifierad.
- **Prioritet och nästa åtgärd:** P2. Fastställ avsikten med pausen och följ befintliga scheman under en driftperiod, inklusive ett kontrollerat avbrott och återhämtning.
- **Produktionsverifiering / extern blockerare:** Ja. B3 och B4; ingen ny betaltjänst eller ändrat bankmedgivande behövs för kodtesterna.

### 29. Säkerhetskopiering — 7,5/10

- **Acceptanskriterier:** Krypterad komplett snapshot och alla original; integritetsbevis, ägarbindning, beständig återupptagning och ingen falsk framgång vid saknat original/nyckel.
- **Verifierat:** Aktuell läsande produktionsstatus anger komplett backup 191/191 filer, 63 448 066 byte, verifierad 2026-10-30T01:27:38Z. Isolerade återläsningar, manipulering och låskonkurrens är testade.
- **Exakta tester och resultat:** `test/backup.test.js`: SQLite-snapshot, kryptering, separat återställning, fel nyckel och Stockholm-dygn. `sites/tests/backup.test.mjs`: alla original, fel ägare/objekt/nyckel/hash, saknat original, avbrott och sena leaseägare. E-N/E-S; E-PROD.
- **Kod-, API- eller UI-evidens:** `src/backup.js`, `sites/lib/backup-engine.ts`, `sites/lib/backups.ts`; `docs/AUTOMATION-BACKUP.md`.
- **Återstående problem:** Den rapporterade produktionsbackupens status är inte ett utfört återställningsprov av just den backupen. Oberoende extern katastrofkopia och nyckeltillgång är inte verifierade.
- **Prioritet och nästa åtgärd:** P0. Verifiera samma backup i isolerad miljö, jämför databas/original/hash och dokumentera separat återställningsnyckel samt extern kopia.
- **Produktionsverifiering / extern blockerare:** Ja. B6. Ingen destruktiv produktionsåterställning är genomförd eller godkänd här.

### 30. Säkerhet och åtkomstkontroll — 8/10

- **Acceptanskriterier:** Ägarisolering, autentisering, CSRF, säkra sessioner, tokenkryptering, begränsade jobb och inga hemligheter eller dokumentkroppar i onödiga statussvar.
- **Verifierat:** HTTP-/D1-gränser, OAuth-replay, fel ägare, kontoval, nyckelbindning och originalintegritet testas. Gmail MCP-status läser inte dokument/workspace och muterar inte automationsinställningar.
- **Exakta tester och resultat:** `test/api.test.js`, `test/bank-api.test.js`, `test/gmail-api.test.js`, `test/customer-messages-api.test.js`; `sites/tests/banking-security.test.mjs`, `sites/tests/gmail.test.mjs`, `sites/tests/customer-messages.test.mjs`. E-N/E-S. Beroendegranskning av slutlig revision registreras separat i G-D.
- **Kod-, API- eller UI-evidens:** `src/security.js`, `src/server.js`, `sites/lib/banking/security.ts`, `sites/lib/server.ts`, `sites/lib/banking/mcp.ts`.
- **Återstående problem:** Ingen full aktuell säkerhetsgranskning av autentiserad produktionsruntime, alla åtkomstroller och slutlig deployment. Hash bevisar integritet, inte bankens avsändarautenticitet.
- **Prioritet och nästa åtgärd:** P0. Behåll de godkända audit-/CI-bevisen enligt G-P; kontrollera återstående publicerad åtkomstisolering och känsliga statusytor utan att exportera företagsdata.
- **Produktionsverifiering / extern blockerare:** Ja. B2; G-D är intern leveransgrind.

### 31. Katastrofåterställning — 6/10

- **Acceptanskriterier:** Återställ databas och samtliga original i separat miljö med rätt nyckel; saknade delar ska ge fel; återställningstid, dataförlustfönster och extern kopia ska vara fastställda.
- **Verifierat:** Isolerade syntetiska återställningar för Node och Sites samt fel nyckel/ägare/original är testade. Avbrott och konkurrerande backupägare kan inte skapa falskt komplett resultat.
- **Exakta tester och resultat:** `test/backup.test.js` och `sites/tests/backup.test.mjs`: återställning till separat databas, byte-/innehållskontroll, manipulerad ciphertext, saknade original och leasebyte. E-N/E-S. Ingen destruktiv produktionsrestore ingår.
- **Kod-, API- eller UI-evidens:** `src/backup.js`, `sites/lib/backup-engine.ts`, `docs/AUTOMATION-BACKUP.md`; E-PROD visar backupstatus men inget katastrofprov.
- **Återstående problem:** Förlust av hela produktionsmiljön inklusive nyckel, oberoende extern kopia samt uppmätta RPO/RTO har inte verifierats.
- **Prioritet och nästa åtgärd:** P0. Planera och genomför isolerat katastrofprov från en godkänd kopia med separata resurser; mät tid, fullständighet och nyckeltillgänglighet.
- **Produktionsverifiering / extern blockerare:** Ja. B6 och överenskomna RPO/RTO; destruktiv produktionsåterställning kräver separat godkännande.

### 32. Kodkvalitet och tester — 8,5/10

- **Acceptanskriterier:** Reproducerade fel ska ha regressioner; båda implementationer ska följa samma beviskrav; fulla tester, syntax/typer, audit, build och CI ska vara gröna för samma revision.
- **Verifierat:** Flera konkreta fel har reproducerats före fix. Senaste rapporterade fulla Node-svit är 377/377 och Sites 456/456. Oberoende review har identifierat och fått original-/konfliktfall rättade. Båda slutliga audits har 0 sårbarheter; den sista fokusfixen ingår i den slutliga godkända Sites-sviten och bygget.
- **Exakta tester och resultat:** `test/node-payments-quality-cycle.test.js`, båda `document-quality-cycle`-filerna, `sites/tests/sites-payments-quality-cycle.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`, `sites/tests/bank-original-quality-cycle.test.mjs`. Exakta slutkommandon och grindstatus finns i evidensregistret.
- **Kod-, API- eller UI-evidens:** Befintlig Node/SQLite- och Sites/Workers/D1/R2-struktur samt `.github/workflows/payment-control-ci.yml` bevaras; arbetsplan `docs/QUALITY-33-PLAN.md`.
- **Återstående problem:** Lokala slutgrindar, produktionsbygge och CI är gröna och kopplade till programcommit enligt G-P. Fortsatt underhåll av parallella regelmotorer, mätning av verklig kvalitet och verifiering av återstående driftkrav behövs; koden är inte formellt verifierad.
- **Prioritet och nästa åtgärd:** P4. Kör alla grindar på exakt leveransrevision, verifiera Actions och uppdatera resultat/SHA här och i PROGRESS.md; ändra inte poäng utan ny evidens.
- **Produktionsverifiering / extern blockerare:** Produktionsverifiering krävs för systembeteende; kodgrindarna kan avslutas utan företagsdata. G-S/G-D/G-P är godkända för denna kod/publicering; återstående verksamhets- och produktionsbevis är separata.

### 33. Verifiering i verklig produktion — 6/10

- **Acceptanskriterier:** Rätt main-SHA och Sites-version ska vara publicerade i samma projekt; bevarade resurser/identitet; inloggade flöden och autentiskt bank-/dokumentunderlag ska verifiera målet.
- **Verifierat:** Version 32 är publicerad med succeeded och samma projekt/resurser/policy/scheman. Main och båda Actions-jobben är verifierade. Bank, den nya begränsade Gmail-statusen och backup svarade; utloggad produktionsvy laddade. Chromium-demo har kontrollerats med syntetiska data.
- **Exakta tester och resultat:** E-N/E-S är lokala tester; E-UI är lokal/hanterad förhandsvisning. E-PROD är läsande status. Ingen av dessa ersätter ett aktuellt inloggat produktionsflöde. `docs/V4-PUBLICATION.md` är historiskt versionsbevis.
- **Kod-, API- eller UI-evidens:** `docs/V4-PUBLICATION.md`, `docs/V4-SWEDBANK-CHANNELS.md`, E-PROD, godkänd G-P och `docs/QUALITY-33-PUBLICATION.json`. Befintligt projekt och domän ska behållas.
- **Återstående problem:** Kodens leverans-SHA, deployment och läsande efterkontroll finns enligt G-P. Den separata webbläsaren nådde OpenAI:s inloggningsformulär och saknar autentiserad session. Full inloggad kedja, autentisk individuell bankrapport, full dokumentkedja, avstängd dator och produktionsåterställningsprov saknas.
- **Prioritet och nästa åtgärd:** P4. Avsluta kod-/publiceringsgrindarna och verifiera tillåtna aktuella flöden. Fortsätt dokumentera externa blockerare; rapportera inte 9,5 i alla områden.
- **Produktionsverifiering / extern blockerare:** Ja, detta är själva områdets kärna. B1–B6. De interna kod-/publiceringsgrindarna är godkända men ersätter inte dessa krav.

## Fortsättning och ändringsregel

1. G-S, G-D och G-P för kod/publicering är avslutade. Nästa körning hämtar main, läser aktuellt publiceringsbevis och fortsätter med öppna krav. Rätta nya konkreta integritetsfel med en reproduktion.
2. Bevara separata bevis för GitHub och Sites. Fyll i slutliga counts/SHA/deployment-resultat utan att omtolka gamla körningar som nya.
3. Bankdialogens Enter/Escape/fokusretur är avslutad. Utöka tangentbords-, fokus- och navigationsmatrisen till återstående vyer och mobilmeny; behandla iframe-begränsningen uttryckligen.
4. Hantera Gmail-pausen och verifiera faktiskt moln-OCR-utfall. Respektera befintliga scheman och behörigheter.
5. Ta emot det autentiska bankunderlag som B1 kräver. Kör först läsande jämförelse mot förväntade betalare, exakta referenser och saldon.
6. Genomför representativ fakturavalidering och isolerat återställningsprov. Dokumentera felkvoter, undantag, RPO/RTO och konkret operatörsåtgärd.
7. Uppdatera en områdespoäng endast när en viss delpoäng kan kopplas till ett nytt godkänt bevis. Spara tidigare bedömning i versionshistoriken och ange vilken acceptanslucka som stängts. Avsaknad av nya fel är inte i sig skäl att höja betyget.

**Slutvillkoret kvarstår:** formuleringen `KLART – 9,5/10 I ALLA 33 OMRÅDEN` får inte användas utifrån denna scorecard. Ingen aktuell extern blockerare, ofärdig leveransgrind eller ej verifierad kritisk produktionsfunktion får döljas av godkända enhetstester.

## Cykel 1A – delta för samtliga 33 områden

Poäng före avser starten av åttatimmarsuppdraget. Nya delpoäng för områden26/28/31: S=1,5; område29: S=1. Övriga komponenter är oförändrade. Nya källor: **N1** = cykelrapportens407 Node-tester; **S0** = omkörda456 tester i oförändrad Sites-källa; **P0** = oförändrad Sites32 och begränsade läsande statusvärden. En lokal förbättring räknas inte som produktionsevidens.

| Nr | Område | Före | Nu | Förbättring/fynd | Testbevis | Produktionsbevis | Kvarstående brist | Nästa åtgärd |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | Design och färger | 6,5 | 6,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Slutför kontrast och formulärfokus. |
| 2 | Startsida | 7,5 | 7,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera publicerade kort och fullständigt bankunderlag. |
| 3 | Navigering | 5 | 5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Leverera mobilmeny; implementera webbläsarhistorik. |
| 4 | Mobilanpassning | 7 | 7 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Leverera menyfokus; kontrollera övriga dialoger. |
| 5 | Sökning och filtrering | 7 | 7 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Testa större köer, filterkombinationer och nollprefix. |
| 6 | Minimal manuell hantering | 6,5 | 6,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Mät genomströmning utan sänkta granskningskrav. |
| 7 | Kundfakturor | 8 | 8 | Saldo och historiska kopplingar bevaras vid nya spärrar. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 8 | Leverantörsfakturor | 8 | 8 | Samma integritetsregler skyddar utbetalningsmatchning. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 9 | PDF-tolkning | 8 | 8 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Representativ tillåten PDF-korpus med facit. |
| 10 | Bild-OCR | 7 | 7 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera aktuell moln-OCR och originalkedja. |
| 11 | Gmail-anslutning | 7 | 7 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Bevara paus; verifiera hämtning först med rätt mandat. |
| 12 | Automatisk fakturaregistrering | 7,5 | 7,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Rätta felbesked efter redan slutförd registrering. |
| 13 | Dubblettkontroll | 8 | 8 | Skiljetecken/nollor bevaras; kontoavgränsade bank-ID:n. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 14 | Dokumentgranskning | 7,5 | 7,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Visa sammanfattade orsaker och säker efterkontroll. |
| 15 | Swedbank-anslutning | 8,5 | 8,5 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Autentisk individuell rapport och avtalad profil/kanal. |
| 16 | Automatisk bankhämtning | 8 | 8 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera och verifiera nästa verkliga bankhämtning. |
| 17 | Bankgiroimport | 8 | 8 | Avvisade original behålls; verklig CSV-rout verifieras. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 18 | Identifiera verklig betalare | 6,5 | 6,5 | Inlärd betalare kräver aktuellt godkänt stödoriginal. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Jämför verklig betalare mot tillåtet bankoriginal. |
| 19 | Verklig OCR/fakturareferens | 6,5 | 6,5 | Återspelning får inte undertrycka ny referenskonflikt. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera verklig OCR-regel och referens i bankoriginal. |
| 20 | Automatisk betalningsmatchning | 7,5 | 7,5 | Undo, saknade original och återföringar stoppar automatik. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera Sites-spärrar; verifiera representativt utfall. |
| 21 | Delbetalningar | 8 | 8 | Delbetalningar bevaras när frånvarokontroll blir inaktuell. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 22 | Överbetalningar | 8 | 8 | Tidigare allokeringar bevaras; nya ekonomiska dubbletter hålls. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 23 | Flera fakturor i en betalning | 7,5 | 7,5 | Alla föräldraoriginal och tidigare kompletteringsfakta följs. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera samlingsbetalning mot autentiskt individfacit. |
| 24 | Betalningshistorik | 8 | 8 | Avvisad import och tidigare kontrollbeslut finns kvar i audit. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 25 | Betalningsstatus | 8 | 8 | Föråldrade slutsatser om utebliven betalning tas bort. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 26 | Kontrollera alla betalningar | 8 | 7,5 | Ny kontroll-idempotens/leasebrist reproducerad; ej rättad här. | N1/S0; öppna negativa auditfall. | P0; inget nytt verksamhetsutfall. | Bekräftat lokalt fel kvarstår. | Spara alla accepterade request-ID:n; SQL-klocka vid skrivning. |
| 27 | Automatiska mejlutkast | 8 | 8 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera utkast och aktuellt godkännande utan sändning. |
| 28 | Schemalagd automatisering | 6,5 | 6 | För gammal lease kan fortfarande publicera kontrollsteg. | N1/S0; öppna negativa auditfall. | P0; inget nytt verksamhetsutfall. | Bekräftat lokalt fel kvarstår. | Rätta kontroll-lease och bevara pausat externt Gmail-schema. |
| 29 | Säkerhetskopiering | 8,5 | 7,5 | Återupptagen backup kan felaktigt bli komplett. | N1/S0; öppna negativa auditfall. | P0; inget nytt verksamhetsutfall. | Bekräftat lokalt fel kvarstår. | Verifiera alla kopierade original före fullständighetsbesked. |
| 30 | Säkerhet och åtkomstkontroll | 8 | 8 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsatt owner/CSRF/lease-granskning och behörig driftkontroll. |
| 31 | Katastrofåterställning | 6,5 | 6 | Node-återställning kan godta hashstridiga original. | N1/S0; öppna negativa auditfall. | P0; inget nytt verksamhetsutfall. | Bekräftat lokalt fel kvarstår. | Originalhashkontroll vid skapa/verifiera/återställ; isolerat prov. |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 | 30 nya Node-fall; exakt isolerad leveranskandidat verifierad. | N1; nya bank-/dokumentregressioner. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Granska nästa Sites-diff och kör CI på exakt commit. |
| 33 | Verifiering i verklig produktion | 6 | 6 | Ingen ny kod i denna Node-delleverans. | N1/S0, oförändrat relevant område. | P0; inget nytt verksamhetsutfall. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera Sites separat och kontrollera behöriga användarvyer. |

## Cykel 1B – delta för samtliga 33 områden

Poäng före avser cykel1A. Poängen är oförändrade tills aktuell publicering och återstående kriterier har verifierats. **S1** = 531 Sites-tester på frysta källor; **UI1** = avgränsad syntetisk Chromium-kontroll enligt cykelrapporten. **P1B** = Sites32 före publicering, bank lyckad14:09 och Gmail stale/pausat. Ingen lokal regression förväxlas med ett autentiskt bankutfall.

| Nr | Område | Före | Nu | Genomförd förbättring | Testbevis | Produktionsbevis | Kvarstående brist | Nästa åtgärd |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | Design och färger | 6,5 | 6,5 | Svartvit mobilmeny och tillgängliga fokuskontroller. | UI1, S1 | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Slutför kontrast och formulärfokus. |
| 2 | Startsida | 7,5 | 7,5 | Fyra huvudkort/huvudåtgärd verifierade i syntetisk webbläsare. | UI1, S1 | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera publicerade kort och fullständigt bankunderlag. |
| 3 | Navigering | 5 | 5 | Native mobilmeny, fokusloop, Escape och fokusretur. | UI1, nio navigationstester | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Leverera mobilmeny; implementera webbläsarhistorik. |
| 4 | Mobilanpassning | 7 | 7 | Fem bredder utan overflow; desktopmeny dold för mobilens Tab. | UI1, S1 | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Leverera menyfokus; kontrollera övriga dialoger. |
| 5 | Sökning och filtrering | 7 | 7 | Söketiketter och valda filter har explicit semantik. | S1; större filtermatris återstår | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Testa större köer, filterkombinationer och nollprefix. |
| 6 | Minimal manuell hantering | 6,5 | 6,5 | Säkra OCR- och registreringsgränser utan sänkta beviskrav. | S1 dokumentfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Mät genomströmning utan sänkta granskningskrav. |
| 7 | Kundfakturor | 8 | 8 | Registrerade saldon bevaras vid ifrågasatt bankbevis. | S1 bevis-/UI-regressioner | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 8 | Leverantörsfakturor | 8 | 8 | Samma original-/referenskrav gäller registrering. | S1 dokumentfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 9 | PDF-tolkning | 8 | 8 | Faktiskt R2-original/hash verifieras vid registrering. | S1 dokumentfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Representativ tillåten PDF-korpus med facit. |
| 10 | Bild-OCR | 7 | 7 | OCR-original, accepterat kvitto och aktuell DB-lease binds. | S1 OCR-regressioner | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera aktuell moln-OCR och originalkedja. |
| 11 | Gmail-anslutning | 7 | 7 | Historik överlever leasegräns; pausen är oförändrad. | S1; aktuell läsande status | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Bevara paus; verifiera hämtning först med rätt mandat. |
| 12 | Automatisk fakturaregistrering | 7,5 | 7,5 | Final registrering kräver samma ägare/hash/storlek. | S1 registreringsrace | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Rätta felbesked efter redan slutförd registrering. |
| 13 | Dubblettkontroll | 8 | 8 | Exakt fakturanummer och idempotent återimport. | S1 dubblett-/bankfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 14 | Dokumentgranskning | 7,5 | 7,5 | Original bytt mellan läsning/registrering stoppas. | S1 dokumentfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Visa sammanfattade orsaker och säker efterkontroll. |
| 15 | Swedbank-anslutning | 8,5 | 8,5 | Ingen kodändring i denna Sites-delleverans; känt nästa-cykelfynd kvarstår. | Oförändrad grund; inga nya bevis för området. | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Autentisk individuell rapport och avtalad profil/kanal. |
| 16 | Automatisk bankhämtning | 8 | 8 | Synkens konflikt-/felskrivningar skyddas av lease och CAS. | S1 sex nya synkfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera och verifiera nästa verkliga bankhämtning. |
| 17 | Bankgiroimport | 8 | 8 | Motstridigt original sparas utan partiell ekonomisk import. | S1 state-/importfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 18 | Identifiera verklig betalare | 6,5 | 6,5 | Bankens namn separeras från historisk fakturakoppling. | S1 bevis-/UI-fall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Jämför verklig betalare mot tillåtet bankoriginal. |
| 19 | Verklig OCR/fakturareferens | 6,5 | 6,5 | Originalreferens måste vara konsekvent genom föräldrarna. | S1 bevisfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera verklig OCR-regel och referens i bankoriginal. |
| 20 | Automatisk betalningsmatchning | 7,5 | 7,5 | Beständig ångraspärr och skydd för gamla/nya delposter. | S1 automat-/återspelningsfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera Sites-spärrar; verifiera representativt utfall. |
| 21 | Delbetalningar | 8 | 8 | Delbelopp bevaras; verifieringspåståenden blockeras vid konflikt. | S1 partial-/draft-/UI-fall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 22 | Överbetalningar | 8 | 8 | Överbetalningspåståenden kräver aktuellt giltigt original. | S1 draft-/send-regressioner | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 23 | Flera fakturor i en betalning | 7,5 | 7,5 | Alla samlingsföräldrars original och restriktioner ärvs. | S1 lineage-/parentfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera samlingsbetalning mot autentiskt individfacit. |
| 24 | Betalningshistorik | 8 | 8 | Avvisade original och tidigare beslut behålls i audit. | S1 atomik/replay | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 25 | Betalningsstatus | 8 | 8 | Aktuell frånvaro- och betalningsverifiering skild från historiskt saldo. | S1 server/UI-regressioner | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsätt Sites-paritet och verifiera mot behörigt original. |
| 26 | Kontrollera alla betalningar | 7,5 | 7,5 | Ingen kodändring i denna Sites-delleverans; känt nästa-cykelfynd kvarstår. | Oförändrad grund; inga nya bevis för området. | P1B; ny deployment ännu ej verifierad. | Bekräftat lokalt fel kvarstår. | Spara alla accepterade request-ID:n; SQL-klocka vid skrivning. |
| 27 | Automatiska mejlutkast | 8 | 8 | Äldre snapshot godtar inte nytt spärrat betalningspåstående. | S1 77 fokuserade +8 oberoende fall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Verifiera utkast och aktuellt godkännande utan sändning. |
| 28 | Schemalagd automatisering | 6 | 6 | Ingen kodändring i denna Sites-delleverans; känt nästa-cykelfynd kvarstår. | Oförändrad grund; inga nya bevis för området. | P1B; ny deployment ännu ej verifierad. | Bekräftat lokalt fel kvarstår. | Rätta kontroll-lease och bevara pausat externt Gmail-schema. |
| 29 | Säkerhetskopiering | 7,5 | 7,5 | Ingen kodändring i denna Sites-delleverans; känt nästa-cykelfynd kvarstår. | Oförändrad grund; inga nya bevis för området. | P1B; ny deployment ännu ej verifierad. | Bekräftat lokalt fel kvarstår. | Verifiera alla kopierade original före fullständighetsbesked. |
| 30 | Säkerhet och åtkomstkontroll | 8 | 8 | Ägar-/CAS-/lease-/storleksgränser på felvägar och kvitton. | S1 negativa integrationsfall | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Fortsatt owner/CSRF/lease-granskning och behörig driftkontroll. |
| 31 | Katastrofåterställning | 6 | 6 | Ingen kodändring i denna Sites-delleverans; känt nästa-cykelfynd kvarstår. | Oförändrad grund; inga nya bevis för området. | P1B; ny deployment ännu ej verifierad. | Bekräftat lokalt fel kvarstår. | Originalhashkontroll vid skapa/verifiera/återställ; isolerat prov. |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 | 75 nya Sites-fall; isolerad slutkandidat och oberoende review. | 938 godkända tester; TS/bygge | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Granska nästa Sites-diff och kör CI på exakt commit. |
| 33 | Verifiering i verklig produktion | 6 | 6 | Publicering förberedd för samma projekt, backup och rollbackpunkt. | Lokala grindar; deployment återstår | P1B; ny deployment ännu ej verifierad. | Kritiska acceptanskrav och aktuell produktionskedja återstår. | Publicera Sites separat och kontrollera behöriga användarvyer. |

## Cykel 2 – delta för samtliga33 områden

**N2**=469 Node-tester, **S2**=624 Sites-tester, på exakt40-filsmaterial i cykelmanifestet. **P33**=verifierad publicerad Sites33 och avgränsade autentiserade vy-/statuskontroller. Cykel2 är ännu inte publicerad vid denna bedömning. **API RED** är en separat syntetisk reproduktion mot den ännu levererade kodgränsen, inte verklig produktionsdatakorruption. Sänkt S avser nyupptäckta befintliga luckor.

| Nr | Område | Före | Nu | Genomförd förbättring/fynd | Testbevis | Produktionsbevis | Kvarstående brist | Nästa åtgärd |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | Design och färger | 6,5 | 7,5 | Publicerad svartvit meny och synligt tangentbordsfokus. | P33, tidigare UI1 | P33 autentiserat vyflöde. | Systematisk kontrast-/formulärmatris återstår. | Mät kontrast och fokus i samtliga huvudflöden. |
| 2 | Startsida | 7,5 | 8,5 | Fyra kort och exakt en huvudåtgärd verifierade inloggat. | P33, S2 | P33 autentiserat vyflöde. | Kortens hela banktäckning saknar autentiskt facit. | Behåll enkla kort; verifiera ekonomiska underlag separat. |
| 3 | Navigering | 5 | 7,5 | Mobilmenyns fokusloop, Escape och fokusretur verifierade i produktion. | P33, UI1 | P33 autentiserat vyflöde. | URL/Back/Forward rättas i separat ännu ej publicerad kandidat. | Slutför verklig Chromium-kontroll av historik och utkast. |
| 4 | Mobilanpassning | 7 | 8 | 390px mobil och resize1440px saknar overflow; menyn stängs och fokus följer. | P33, UI1 | P33 autentiserat vyflöde. | Övriga dialoger och bredder behöver fullare matris. | Verifiera formulär, dokument och meddelanden på mobil. |
| 5 | Sökning och filtrering | 7 | 7 | Ingen ny filterlogik i denna kandidat. | S2, tidigare filterfall | P33; inget nytt produktionsutfall för cykel2. | Större kombinationer och vybevarande återstår. | Verifiera filter och sökning med syntetiska köer. |
| 6 | Minimal manuell hantering | 6,5 | 6,5 | Efterkontroll kan återupptas utan ny OCR eller dubbel registrering. | N2/S2, dokumentrace | P33; inget nytt produktionsutfall för cykel2. | Verklig andel säker automatregistrering ej mätt. | Läs nya aggregerade granskningsorsaker efter publicering. |
| 7 | Kundfakturor | 8 | 8 | Aktuellt Node-betalningsbevis skyddar API, export och status utan saldoändring. | N2 API/export/ledger | P33; inget nytt produktionsutfall för cykel2. | Sites API-original är ett separat öppet integritetsfynd. | Leverera API-kvitto och verifiera representativ fakturakedja. |
| 8 | Leverantörsfakturor | 8 | 8 | Registreringens accepterade resultat överlever sena metadatafel. | N2/S2 dokumentkedja | P33; inget nytt produktionsutfall för cykel2. | Representativa leverantörsoriginal med facit saknas. | Verifiera tillåten leverantörskorpus. |
| 9 | PDF-tolkning | 8 | 8 | Originalkontroll och redan accepterad registrering hålls åtskilda från statusfel. | S2 PDF/registrering | P33; inget nytt produktionsutfall för cykel2. | Autentisk variationskorpus saknas. | Testa korpus med förhandsbestämt facit. |
| 10 | Bild-OCR | 7 | 7 | Node OCR/CLI bevarar accepterat antal vid senare fel och stoppar nya leases. | N2 OCR34; S2; P33 OCR0 | P33; inget nytt produktionsutfall för cykel2. | Senaste lyckade worker behandlade0 dokument. | Verifiera ett tillåtet nytt OCR-jobb utan osäkra köuppgraderingar. |
| 11 | Gmail-anslutning | 7 | 7 | Gmail bevarar accepterat processresultat vid slutstämpel-/cleanupfel. | S2 Gmail; P33 | P33; inget nytt produktionsutfall för cykel2. | Timvis externt schema är pausat; senaste hämtning29okt. | Bevara pausen och visa korrekt aktuell driftstatus. |
| 12 | Automatisk fakturaregistrering | 7,5 | 8 | En registrering/ett kvitto; sena fel ger känt antal och okänd status. | S2 race/finalizer, N2 klient | P33; inget nytt produktionsutfall för cykel2. | Verklig produktionsregistrering i nya revisionen återstår. | Verifiera kontrollerad tillåten kedja och återförsök. |
| 13 | Dubblettkontroll | 8 | 8 | Kvitton vid samtidiga bekräftelser och kontroll-request-ID:n är beständiga. | N2/S2 replay/race | P33; inget nytt produktionsutfall för cykel2. | Full produktionskedja och autentisk dubblettkorpus återstår. | Verifiera återimport mot oförändrat original. |
| 14 | Dokumentgranskning | 7,5 | 8 | Förhandsvisning är läsande; ursprunglig tolkning bevaras; aggregerade orsaker visas. | S2 preview/diagnostik | P33; inget nytt produktionsutfall för cykel2. | 183 verkliga granskningsorsaker har ännu inte lästs efter ny kod. | Publicera och läs begränsad orsaksstatistik. |
| 15 | Swedbank-anslutning | 8,5 | 8,5 | Befintlig anslutning och sex-timmarsintervall bevarade. | S2 bank; P33 status | P33; inget nytt produktionsutfall för cykel2. | Individrapport, avtalad rapportprofil och kanal saknas. | Begär exakt tillåtet Swedbank-underlag enligt blockeraren. |
| 16 | Automatisk bankhämtning | 8 | 7,5 | Nytt fynd: sparat API-original kan ändras utan ett tidigare mottagningskvitto. | Separat API-original RED; S2 grund | P33; inget nytt produktionsutfall för cykel2. | Mottagningshash/projektion ingår i nästa kandidat. | Slutför review och leverera kvittobunden bankhämtning. |
| 17 | Bankgiroimport | 8 | 7,5 | Filbevis är skyddat; API-förälder visar nytt separat integritetsbehov. | N2/S2 Bankgiro; API RED | P33; inget nytt produktionsutfall för cykel2. | Autentisk individrapport och API-originalrättning återstår. | Verifiera både filoriginal och API-förälderns mottagningskvitto. |
| 18 | Identifiera verklig betalare | 6,5 | 6 | Node stoppar betalningspåståenden med skadat råoriginal. | N2; separat Sites API RED | P33; inget nytt produktionsutfall för cykel2. | Sites råoriginal/projektion måste bindas och verklig betalare verifieras. | Leverera API-rättningen; jämför med bankens autentiska original. |
| 19 | Verklig OCR/fakturareferens | 6,5 | 6 | Referenskonflikter och historiskt bevis hålls separata. | N2/S2; separat API RED | P33; inget nytt produktionsutfall för cykel2. | Sites API-referens saknar ännu levererat mottagningskvitto. | Leverera kvitto/projektionskontroll och verifiera OCR-regel. |
| 20 | Automatisk betalningsmatchning | 7,5 | 7 | Node originalspärr gäller nya/allokerade betalningar och lärda relationer. | N2; Sites API RED | P33; inget nytt produktionsutfall för cykel2. | Separat API-originalfynd är fortfarande öppet på main. | Leverera och testa samtliga ursprungliga bankkällor. |
| 21 | Delbetalningar | 8 | 7,5 | Registrerade delbelopp finns kvar medan osäkra verifieringspåståenden hålls. | N2/S2 partial/draft | P33; inget nytt produktionsutfall för cykel2. | API-originalgräns och autentiskt delbetalningsfacit återstår. | Slutför API-kedja utan att ändra bokförda allokeringar. |
| 22 | Överbetalningar | 8 | 7,5 | Överbetalningsutkast kräver aktuellt bevis i Node-kedjan. | N2/S2 överbetalning | P33; inget nytt produktionsutfall för cykel2. | API-originalgräns och verkligt utfall återstår. | Verifiera kvitto, överbelopp och bevarad rest. |
| 23 | Flera fakturor i en betalning | 7,5 | 7 | Föräldraoriginal och tidigare begränsningar följer delposter. | N2/S2 ancestorfall | P33; inget nytt produktionsutfall för cykel2. | API-förälderns nya integritetsfynd; autentisk samlingsrapport saknas. | Leverera API-gräns och matcha till autentiskt individfacit. |
| 24 | Betalningshistorik | 8 | 8 | Tidigare saldo, allokeringar, original och kontrollnoter bevaras. | N2/S2 audit/export | P33; inget nytt produktionsutfall för cykel2. | Full autentisk historikavstämning återstår. | Verifiera en tillåten historikkedja i publicerad revision. |
| 25 | Betalningsstatus | 8 | 7,5 | Aktuellt Node-bevis styr status och export; historiska saldon skrivs inte om. | N2 API/export/UI; API RED | P33; inget nytt produktionsutfall för cykel2. | Sites API-originalspärr är ännu inte levererad. | Leverera och verifiera aktuell status i alla konsumenter. |
| 26 | Kontrollera alla betalningar | 7,5 | 7,5 | Request-kvitton sparas vid sammanslagning; SQL-klocka gäller efter väntad låsning. | N2 kontroll22; S2 kontroll | P33; inget nytt produktionsutfall för cykel2. | Full huvudåtgärd omfattar fortfarande öppet API-originalfynd. | Leverera API-kontroll; verifiera kontrollerad slutkedja. |
| 27 | Automatiska mejlutkast | 8 | 7,5 | Node utkast/review/send kräver aktuellt bevis; efterkontrollkvitton kan återupptas. | N2/S2 draft/review | P33; inget nytt produktionsutfall för cykel2. | Sites API-originalgräns återstår; inga riktiga mejl skickade. | Testa aktuella kvitton och granska utkast utan sändning. |
| 28 | Schemalagd automatisering | 6 | 6,5 | Leases och delresultat är säkra vid avbrott; CLI markerar okänd status som avvikelse. | N2/S2; P33 worker0 | P33; inget nytt produktionsutfall för cykel2. | Gmail pausat och faktisk cron-täckning ej bevisad. | Verifiera nästa tillåtna driftutfall; ändra inte scheman. |
| 29 | Säkerhetskopiering | 7,5 | 8 | Node originalhashar och Sites separat manifestpass skyddar återupptagen kopia. | N2 backup26; S2 backup22 | P33; inget nytt produktionsutfall för cykel2. | API-original i Sites-backup ingår i nästa kandidat; driftpass ej kört. | Leverera utökad bevisomfattning och verifiera ny backup. |
| 30 | Säkerhet och åtkomstkontroll | 8 | 8 | MCP stoppar främmande Origin och enkla medietyper före bodyläsning/skrivning. | S2 MCP24 + oberoende authmatris | P33; inget nytt produktionsutfall för cykel2. | Driftsgräns och komplett behörighetsmatris återstår. | Verifiera oförändrad OAuth och nekad obehörig åtkomst efter publicering. |
| 31 | Katastrofåterställning | 6 | 6 | Node verifierar samma avkrypterade snapshot före exklusiv återställning. | N2 backup26; isolerad S2 återställning | P33; inget nytt produktionsutfall för cykel2. | Ingen återställning av verklig produktionsbackup eller oberoende katastrofkopia. | Planera/verifiera tillåten isolerad produktionskopia. |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 | 155 fler tester än cykel1B;40 frysta källfiler, oberoende review och fulla grindar. | N2=469; S2=624; TS/build/audits0 | P33; inget nytt produktionsutfall för cykel2. | Ny commit-CI och Sites-publicering väntar. | Verifiera exakt main-träd och båda Actions-jobb. |
| 33 | Verifiering i verklig produktion | 6 | 6,5 | Sites33 och autentiserade mobil-/desktopvyer verifierade; inget riktigt affärsflöde skrivs. | P33 publiceringsmanifest | P33 autentiserat vyflöde. | Autentiska bank-/OCR-/återställningsutfall återstår. | Publicera cykel2, kontrollera diagnostik och fortsätt nästa kandidat. |

## Cykel 3 – bedömning av alla 33 områden

Föregående kolumn avser cykel2s aktuella bedömning. Ny kolumn är lokal kod/evidensbedömning med produktionsbegränsningarna uttryckligen kvar. Ingen9,5-poäng delas ut.

| Nr / område | Föregående | Ny | Förbättring | Testbevis | Produktionsbevis | Kvarstående brist | Nästa åtgärd |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1. Design och färger | 7,5 | 7,5 | Ingen poäng för opublicerad UI-kandidat. | Historik/filter/utkast provas separat i Chromium. | Sites34: fyra kort, en huvudåtgärd; mobilt fokusfel reproducerat. | Kontrast, laddnings-/fellägen och vissa fokusövergångar. | Leverera frysta UI-rättningar efter oberoende granskning och browserprov. |
| 2. Startsida | 8,5 | 8,5 | Ingen poäng för opublicerad UI-kandidat. | Historik/filter/utkast provas separat i Chromium. | Sites34: fyra kort, en huvudåtgärd; mobilt fokusfel reproducerat. | Kontrast, laddnings-/fellägen och vissa fokusövergångar. | Leverera frysta UI-rättningar efter oberoende granskning och browserprov. |
| 3. Navigering | 7,5 | 7,5 | Ingen poäng för opublicerad UI-kandidat. | Historik/filter/utkast provas separat i Chromium. | Sites34: fyra kort, en huvudåtgärd; mobilt fokusfel reproducerat. | Kontrast, laddnings-/fellägen och vissa fokusövergångar. | Leverera frysta UI-rättningar efter oberoende granskning och browserprov. |
| 4. Mobilanpassning | 8 | 8 | Ingen poäng för opublicerad UI-kandidat. | Historik/filter/utkast provas separat i Chromium. | Sites34: fyra kort, en huvudåtgärd; mobilt fokusfel reproducerat. | Kontrast, laddnings-/fellägen och vissa fokusövergångar. | Leverera frysta UI-rättningar efter oberoende granskning och browserprov. |
| 5. Sökning och filtrering | 7 | 7 | Ingen poäng för opublicerad UI-kandidat. | Historik/filter/utkast provas separat i Chromium. | Sites34: fyra kort, en huvudåtgärd; mobilt fokusfel reproducerat. | Kontrast, laddnings-/fellägen och vissa fokusövergångar. | Leverera frysta UI-rättningar efter oberoende granskning och browserprov. |
| 6. Minimal manuell hantering | 6,5 | 6,5 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 7. Kundfakturor | 8 | 8 | Ingen ny fakturafunktion i bankkandidaten. | Befintliga faktura-/saldo-/dubblettregressioner ingår i1161. | Ingen ny verklig registrering utförd. | Representativt autentiskt fakturaflöde och laddningslägen. | Verifiera ärliga listtillstånd och relevanta lokala användarkedjor. |
| 8. Leverantörsfakturor | 8 | 8 | Ingen ny fakturafunktion i bankkandidaten. | Befintliga faktura-/saldo-/dubblettregressioner ingår i1161. | Ingen ny verklig registrering utförd. | Representativt autentiskt fakturaflöde och laddningslägen. | Verifiera ärliga listtillstånd och relevanta lokala användarkedjor. |
| 9. PDF-tolkning | 8 | 8 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 10. Bild-OCR | 7 | 7 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 11. Gmail-anslutning | 7 | 7 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 12. Automatisk fakturaregistrering | 8 | 8 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 13. Dubblettkontroll | 8 | 8 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 14. Dokumentgranskning | 8 | 8 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Befintlig anslutning bevarad; API-originalkontrollen förstärks separat. | Normalisering/ägare/valuta och API-integritet gröna. | Senast lyckad hämtning14:09:57UTC;6hintervall; inget fel. | Individuell rapportkanal/profil och komplett B1. | Behåll anslutningen och dokumentera exakt saknat bankunderlag. |
| 16. Automatisk bankhämtning | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 17. Bankgiroimport | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 18. Identifiera verklig betalare | 6 | 6 | API-källan skyddad; UI-etiketter för original/referens ännu öppna. | API- och meddelandespärrar gröna; UI-fix separat. | Ingen ny API-/UI-kandidat räknas som verifierad. | Känt presentationsfel samt autentisk bank-/meddelandekedja. | Slutför oberoende UI-granskning, publicera och webbläsartesta. |
| 19. Verklig OCR/fakturareferens | 6 | 6 | API-källan skyddad; UI-etiketter för original/referens ännu öppna. | API- och meddelandespärrar gröna; UI-fix separat. | Ingen ny API-/UI-kandidat räknas som verifierad. | Känt presentationsfel samt autentisk bank-/meddelandekedja. | Slutför oberoende UI-granskning, publicera och webbläsartesta. |
| 20. Automatisk betalningsmatchning | 7 | 7,5 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 21. Delbetalningar | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 22. Överbetalningar | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 23. Flera fakturor i en betalning | 7 | 7,5 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 24. Betalningshistorik | 8 | 8 | Historiska pengar/händelser bevaras vid förlorat original. | Kedje-/backup-/bevarandetester och full1161. | Ingen verklig historik ändrad. | Autentisk historikkedja och användarprov. | Verifiera läsande historik efter säker leverans. |
| 25. Betalningsstatus | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 26. Kontrollera alla betalningar | 7,5 | 8 | Aktuell API-/föräldra-/referenskontroll och bevarade allokeringar. | 49 API +19 API-backup; oberoende29+7; full1161. | Sites34 är föregående leverans; API-rättningen ännu inte publicerad. | Autentiskt bankunderlag och kontrollerat verksamhetsutfall kvarstår. | Publicera verifierad kandidat och kontrollera säkra flöden; inhämta B1. |
| 27. Automatiska mejlutkast | 7,5 | 7,5 | API-källan skyddad; UI-etiketter för original/referens ännu öppna. | API- och meddelandespärrar gröna; UI-fix separat. | Ingen ny API-/UI-kandidat räknas som verifierad. | Känt presentationsfel samt autentisk bank-/meddelandekedja. | Slutför oberoende UI-granskning, publicera och webbläsartesta. |
| 28. Schemalagd automatisering | 6,5 | 6,5 | Nya produktionsaggregat förklarar granskning; säkerhetskraven behålls. | Dokument/Gmail/återförsök ingår i1161; ny parserkorpus separat. | 183 analyserade;182 ej verifierad motpart; Gmail pausat/stale. | B3–B5 och verkligt aktuellt OCR-/registreringsutfall. | Rätta konkreta parserfel med syntetiska original; bevara pausen. |
| 29. Säkerhetskopiering | 8 | 8 | API-kvitton i snapshot, konflikter och avvisad synk; okända historiska kvitton redovisas. | 19 nya API-backup +22 befintliga; oberoende korruptionsprov. | 191/191 äldre original, ärligt copy_readback; inget nytt restoreprov. | Storleks-/radgränser, tvärlagringskonsistens och B6. | Förbättra lokal kapacitet och planera isolerat tillåtet katastrofprov. |
| 30. Säkerhet och åtkomstkontroll | 8 | 8,5 | Aktuell autentiserad läsning genom förstärkt MCP-gräns verifierad. | 24 MCP-regressioner ingår i1161; ägargränser bevaras. | Sites34: identitet/policy/scheman oförändrade; tre statusverktyg fungerar. | Full produktionsmatris för säkerhetsgränser återstår. | Verifiera nästa leverans och relevanta negativa gränser kontrollerat. |
| 31. Katastrofåterställning | 6 | 6 | API-kvitton i snapshot, konflikter och avvisad synk; okända historiska kvitton redovisas. | 19 nya API-backup +22 befintliga; oberoende korruptionsprov. | 191/191 äldre original, ärligt copy_readback; inget nytt restoreprov. | Storleks-/radgränser, tvärlagringskonsistens och B6. | Förbättra lokal kapacitet och planera isolerat tillåtet katastrofprov. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | 26 frysta källfiler; skyddade fixtures; oberoende omgranskning. | 469Node+692Sites,TS,bygge,syntax69,audits0. | Föregående main9d ochSites34 verifierade. | Exakt ny SHA/CI/Sites återstår tills push. | Normal push, CI, bytejämförelse och samma Sites-projekt. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Föregående leverans faktiskt publicerad; ny kandidat räknas separat. | Lokala och oberoende grindar enligt cykelrapport. | Sites34 lyckad; ägaråtkomst, status och mobilt fokusprov. | Full verklig bank/OCR/backupkedja ej uppfylld. | Verifiera nästa leverans utan destruktiva eller externa sändningar. |

## Cykel 4 – senaste delta för samtliga33 områden

Registrerad2026-10-30T20:31:30+00:00. Föregående summa250; exakt ny summa253,5/330 (7,68/10),0/33 på minst9,5. +4,5 lokalt verifierade förbättringar och−1,0 för öppet backup-/restorefel. Fryst28-filerskandidat,1350 godkända tester; ännu inte pushad/publicerad. Senaste verifierade leverans är main6660/Actions41102309328/Sites35. [Fullständigt underlag](docs/QUALITY-8H-CYCLE4.json).

| Område | Föregående | Ny | Förbättring / ny observation | Testbevis | Produktionsbevis | Kvarstående brist | Nästa åtgärd |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1. Design och färger | 7,5 | 8 | Tre svaga textfärger har rättats inom den svartvita designen. | Tre regressioner beräknar kontrast från faktisk CSS: minst 5,090:1 i de berörda lägena; lokal mobilvy kontrollerad. | Sites35 är tidigare UI. Cykel4 är ännu inte publicerad. | Full tillgänglighetsmatris, hjälpmedel och aktuell produktionsvy återstår. | Publicera och kontrollera berörda texter, fokus och hjälpmedel i rätt revision. |
| 2. Startsida | 8,5 | 8,5 | Översikten får relevanta läsfel; listor visar inloggning eller okänd status tills data finns. | Slutlig lokal Chromium-kontroll och 23 nya Dashboard-fall ingår i 831 Sites-tester. | Läsande driftstatus efter Sites35; ingen autentiserad Site35-webbkedja. | Komplett ekonomiskt underlag och B1/B2; cykel4s nya UI ännu lokalt. | Verifiera samma publicerade översikt med tillåten inloggning och känt underlag. |
| 3. Navigering | 7,5 | 8,5 | Tillåtna vy-URL:er, direktlänkar, omladdning, Back/Forward och riktiga länkar införda; HTTP-hydrering rättad. | SSR-/hookfall och riktig Chromium verifierar historik, filter, utkast, fokus samt två snabba Back med en synlig bekräftelse. | Sites35 saknar denna nya navigation; senaste verifierade produktionswebbläsare är version34. | Native beforeunload är miljömässigt overifierad; 401 kan fortfarande förstöra modalutkast. | Leverera den granskade navigationen; slutför separat 401-rättning och verifiera riktig publicerad vy. |
| 4. Mobilanpassning | 8 | 8,5 | Mobil detalj får märkt fokus; Tillbaka återför fokus till ursprungsraden eller synlig reserv. Desktop behåller radfokus. | 9 nya fokusfall; Chromium 390/1440/320 px verifierar fram/tillbaka, resize och mobilmenyns Tab/Escape. | Reproducerat fokusfel i version34; rättningen är ännu endast lokalt verifierad. | Fysisk pekskärm, fler webbläsare och autentiserad ny produktionsrevision återstår. | Verifiera samma mobilsekvenser efter publicering och utöka hjälpmedelsmatrisen. |
| 5. Sökning och filtrering | 7 | 7,5 | Sökning och filter bevaras per vy i RAM genom historik; sena lässvar återställer inte nyligen sparat arbete. | Chromium behåller sökning 1003 och delbetalningsfilter efter Back; hookfall täcker sena svar och samma-vy-länkar. | Nya filter-/historikbeteendet är inte verifierat på Sites35. | Volym, fler sökfall och B2; inga filter eller kundvärden sparas i URL. | Verifiera större syntetiska listor och den publicerade historikkedjan. |
| 6. Minimal manuell hantering | 6,5 | 6,5 | Svenska bindestrecksdatum stöds; tvetydiga identiteter och belopp hålls kvar för granskning. | 100 parserfall över båda motorerna; riktiga PDF-flöden och ett Node-OCR-fall, utan sänkt motpartskrav. | 183 granskningsdokument observerade efter Sites35; inget nytt automatiskt verksamhetsutfall. | B3–B5: pausad Gmail-automatik, moln-OCR och representativ verksamhetskorpus. | Fortsätt med godkända original/facit och faktiska driftutfall; behåll säkerhetskraven. |
| 7. Kundfakturor | 8 | 8 | Kundfakturalistan visar ärlig laddning/fel/inloggning; CSV är spärrad när data saknas. | Fördröjt GET, fel, 401, verklig noll, refresh/retry och sena svar testade; lokal utloggad Chromium-vy kontrollerad. | Cykel3s bankintegritet finns i Sites35; nya listgränser är ännu opublicerade. | 401 kan radera öppet fakturautkast; B1/B2/B5 och verklig fakturakedja återstår. | Omgranska separat 401-kandidat, integrera med nya grindar och verifiera fakturakedjan. |
| 8. Leverantörsfakturor | 8 | 8 | Leverantörslistan skiljer okänd data från verklig noll; parsern behåller osäkra original för granskning. | Samma listmatris som kundfakturor samt riktiga syntetiska PDF-/registreringsfall och dubblettkontroll. | Ingen ny produktionsregistrering eller verifierad leverantörskedja i denna cykel. | 401-utkastfelet samt B2/B5; verksamhetspolicy för undantag kvarstår. | Slutför 401-rättningen och verifiera tillåtna leverantörsoriginal med facit. |
| 9. PDF-tolkning | 8 | 8 | Rubriker/kolumner kan inte bli fakturaidentitet; VAT-procent behandlas inte som kronor. Svenska bindestrecksdatum stöds. | 50 fall per motor; visuellt identiska PDF:er med omvänd ritordning hålls utan registrering; oberoende v2-omgranskning. | Ingen omtolkning eller automatregistrering av produktionsoriginal utförd. | B5; okända layouter, månadsnamn och procent-plus-belopp kräver fortsatt granskning. | Utöka endast mot godkänd representativ korpus och facit utan att gissa kolumnroller. |
| 10. Bild-OCR | 7 | 7 | Den syntetiska bildkorpusen ger exakt identitet, OCR, datum och total med bevarat bildoriginal; låg säkerhet hålls kvar. | Faktisk offline-Tesseract i Node; originalbytes/hash och icke-grön status verifierade. | Ingen ny verifierad moln-OCR-slutföring med användardatorn avstängd. | B4/B5; detta bevisar inte Sites OCR-worker eller verklig OCR-precision. | Kör tillåtet original genom molnkanalen med lokal OCR stoppad och mät mot facit. |
| 11. Gmail-anslutning | 7 | 7,5 | Gmail skiljer laddning/fel/okänt från verkliga nollor; statusberoende åtgärder spärras tills status är laddad. | Fyra nya statusfall med riktig laddad-noll-kontroll; felaktigt svar och read-only retry ingår i fokuserad UI-svit. | Ansluten men stale; senaste lyckade hämtning 2026-10-29T15:00:48.512Z. Timschemat fortsatt avstängt. | B3/B2; tydligare UI är inget bevis för aktuell hämtning eller körande schema. | Verifiera publicerad fel-/laddningsvy och klarlägg pausen inom användarens mandat. |
| 12. Automatisk fakturaregistrering | 8 | 8 | Parsern stoppar falska identiteter och motstridiga skattebelopp före faktisk registrering. | Riktig Node-/Sites-PDF och registrering; okänd motpart, kredit och motsägande total stannar i granskning. | Ingen ny automatisk produktionsregistrering prövad. | B2/B3/B5; faktiska motparter och verksamhetsfacit återstår. | Verifiera tillåtna original genom hela kedjan och behåll motpartsspärren. |
| 13. Dubblettkontroll | 8 | 8 | Exakt hel fakturaidentitet bevaras; rubrikord, trunkerade och motstridiga identiteter accepteras inte. | Andra PDF-kopian med olika bytes blir dubblett; visuellt lika men olikt ritordnade original ger inga dubbla registreringar. | Inga riktiga poster ändrade för att testa dubbletter. | B2/B5 och fler verksamhetslayouter; syntetisk korpus är avgränsad. | Verifiera anonymiserade dubblettfall med godkänt facit och oförändrade original. |
| 14. Dokumentgranskning | 8 | 8 | Mobilens inline-granskning får synlig fokuspunkt och säker retur; osäker parserdata förblir synlig som granskningsbehov. | Fokusfall täcker borttaget ärende/editor, filter, viewport och unmount; faktisk Chromium-fram/tillbaka godkänd. | Version34s fokusfel reproducerat; ingen ny publicerad rättning än. | 401 kan fortfarande radera modalutkast; B2/B5 och större granskningskedja. | Slutför separat auth-utkastreview och kontrollera granskningen i publicerad revision. |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Befintlig bankanslutning och den tidigare levererade API-originalkontrollen bevaras. | Båda fulla sviterna gröna; ingen ändring av bankanslutningens affärslogik i denna cykel. | Efter Sites35: ansluten, sex timmars intervall, senaste synk 2026-10-30T14:09:57.164Z, inget rapporterat fel. | B1: individuell rapport, rätt profil och behörig kanal; aktuell synk är inte komplett bankfacit. | Behåll anslutningen och inhämta tillåtet bank-/avtalsunderlag. |
| 16. Automatisk bankhämtning | 8 | 8 | Banklistan döljer gamla eller påhittade nollor efter misslyckad läsning; ingen ny automatisk hämtning startas. | Bankens laddnings-/401-/refresh-/retryfall och fulla bankregressioner ingår i 831 Sites. | Sites35 innehåller API-originalrättningen; observerad bankstatus är inte en ny hämtning. | B1/B2 och verklig aktuell hämtning med kända utfall. | Verifiera nästa tillåtna riktiga synk och dess original utan att förväxla statusläsning med utfört arbete. |
| 17. Bankgiroimport | 8 | 8 | Importerade original och referenser visas med tydlig källtyp; inga import-/allokeringsregler ändras här. | Presentationsfall skiljer bankbevis, manuell registrering och overifierad historik; befintliga importfall fortsatt gröna. | Sites35s API-/filintegritet levererad; autentiskt individuellt Swedbankunderlag saknas. | B1 och relevant produktionsimport; visningsetiketter bevisar inte filens bankursprung. | Verifiera avtalad rapportprofil och tillåtet original genom publicerad importkedja. |
| 18. Identifiera verklig betalare | 6 | 6,5 | Manuellt angiven betalare och okänt historiskt ursprung presenteras inte som bankens ursprungsuppgifter. | Åtta nya evidensrenderingsfall med positiva bankkontroller; senare manuell bekräftelse ändrar inte originalets ursprung. | Nya etiketter är ännu opublicerade; autentisk individuell betalarverifiering saknas. | B1/B2. Lokal säker visning ger inte verklig betalaridentitet. | Publicera etiketter och jämför tillåtna autentiska individer mot bankfacit. |
| 19. Verklig OCR/fakturareferens | 6 | 6,5 | Fakturareferens, OCR och generell referens har separata etiketter; ledande nollor och originalets egen evidens bevaras. | Riktiga renderfall för typad OCR/fakturareferens, manuell komplettering och original; parserns positiva 000018-kontroller. | Ingen ny verifierad verklig OCR-/fakturareferens efter Sites35. | B1/B2; generisk referens eller syntetiskt korrekt OCR är inte bankens facit. | Verifiera uttrycklig banktyp och exakta referensbytes på tillåten individuell rapport. |
| 20. Automatisk betalningsmatchning | 7,5 | 7,5 | Ingen matchningsregel ändras; visningsrättningen behåller gränsen mellan bankfakta, manuell bekräftelse och förslag. | 519 Node + 831 Sites inkluderar tidigare matchnings-/integritetsfall. | API-originalgränsen finns i Sites35; inga riktiga allokeringar utförda som cykel4-test. | B1/B2 och full faktisk avstämningskedja. | Verifiera tillåtet autentiskt underlag och förväntade saldon läsande före nästa godkända verksamhetsåtgärd. |
| 21. Delbetalningar | 8 | 8 | Delbetalningsfilter överlever historik; ekonomiska delbetalningsregler är oförändrade. | Chromium behåller delbetalningsfilter och sökning efter Back; full ekonomisvit grön. | Inga nya verkliga delbetalningar testade i denna cykel. | B1/B2 och behörigt jämförelseunderlag. | Kontrollera exakt återstående belopp och historik mot tillåtet produktionsfacit. |
| 22. Överbetalningar | 8 | 8 | Ingen överbetalningslogik ändras; ärliga liststatusar förhindrar att okända belopp visas som noll. | Fulla regressionssviter och Dashboard-laddningsmatris gröna. | Inga nya verkliga överbetalningar eller återbetalningar utförda. | B1/B2 och riktiga belopps-/historikbevis. | Verifiera tillåtet överbetalningsfall utan automatisk återbetalning. |
| 23. Flera fakturor i en betalning | 7,5 | 7,5 | Samlingsbetalningens mobila detalj kan öppnas och lämnas med synligt fokus; ekonomiska fördelningsregler bevaras. | Chromium 390 px: märkt Samlingsbetalning-region och retur till samma rad; fulla fördelningsfall gröna. | Ingen ny verklig samlingsbetalning/allokering prövad. | B1/B2, kompletta individdetaljer och verksamhetspolicy. | Verifiera verklig tillåten samlingsrapport och oförändrade totaler. |
| 24. Betalningshistorik | 8 | 8 | Betalningshistorikens innehåll ändras inte; vyhistorik skiljs från ekonomisk historik. | Fulla befintliga historik-/replayfall gröna; navigation kör inga finansiella kommandon. | Ingen ny produktionshistorik skapad för test. | B2 och behörigt historiskt jämförelseunderlag. | Verifiera läsande tidslinje och källspårning på rätt publicerade revision. |
| 25. Betalningsstatus | 8 | 8 | Okänd/felaktigt hämtad status visas inte som laddad noll; original- och manuella uppgifter är tydligare separerade. | 23 Dashboard-fall, åtta evidensfall och fulla statusregressioner ingår i slutgrindarna. | Sites35 har tidigare aktuella API-bevisgränser; inget nytt riktigt betalningsutfall. | B1/B2; visningen ensam bevisar inte full betalning. | Kontrollera rätt publicerad status mot tillåten faktura och komplett bankunderlag. |
| 26. Kontrollera alla betalningar | 8 | 8 | Granskningskön får robust mobilfokus och ärligare omgivande felstatus; kontrollern startas fortsatt uttryckligen. | Fokus-/kontrollsvit 41/41 och fulla grindar; modal/render/resize utlöser inga extra åtgärder. | Ingen ny produktionskontroll körd i cykel4. | B1–B4 och faktiskt fullständigt kontrollutfall; 401-utkastfelet kvarstår. | Verifiera kontrollerat driftutfall när rätt underlag och mandat finns; avsluta separat auth-fix. |
| 27. Automatiska mejlutkast | 7,5 | 8 | Utkastens granskningsunderlag skiljer bankens original, fakturareferens och separat manuell bekräftelse. | Evidensrendering plus utkast-/samma-vy-/spargränser testade; faktiskt dirty-länk/Back-beteende verifierat lokalt. | Noll riktiga mejl skickade; ny presentation ännu opublicerad. | B2; sändningsgranskning i rätt revision samt native beforeunload återstår. | Verifiera ett tillåtet utkast utan sändning; bevara uttrycklig separat sändningsåtgärd. |
| 28. Schemalagd automatisering | 6,5 | 6,5 | Gmail visar tydligare okänd/stale status; inget schema aktiveras eller ändras. | Laddnings-/fel-/nollfall och tidigare automationsregressioner ingår i 1350. | Bank/backup-lägen bevarade; Gmail-timschemat fortsatt avstängt. | B3/B4; konfiguration och worker-kontakt är inte slutfört schemalagt arbete. | Klarlägg befintlig paus och samla faktiska körnings-/OCR-kvitton inom mandatet. |
| 29. Säkerhetskopiering | 8 | 7,5 | Ny reproduktion sänker säkerhetsbedömningen: backup kan märkas complete trots borttagen tidigare verifierad kopia. | Sexfilsrepro: verifiera fem, radera kopia0, verifiera sista; main6660 gav complete/6 med bara fem kopior. Separat rättning på review. | Äldre backup: 191 kopierade; copy_readback, verified_files=0, API-bedömning unassessed. Inget nytt manifest-/restoreprov. | Öppet internt false-complete-fel, storleks-/radgränser, tidsmässig tvärlagringskonsistens och B6. | Omgranska separat backupfix, integrera med nya grindar; utför tillåtet isolerat återställningsprov. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | Kryptografisk UUID fungerar även när HTTP saknar randomUUID; ingen svag slumpfallback införs. | Exakta UUID-version/variantbitar, 1024 unika stickprov, verklig historikinitiering och fail-closed utan kryptografisk källa. | Exakt main/Sites35 verifierade; autentiserade läsningar men ingen ny webbläsarkedja efter version35. | Auth-förlust kan radera modalutkast; separat ägarbunden rättning är ännu på review. B2 kvarstår. | Omgranska identitets-/utkastkandidaten, håll den skild från cykel4 och verifiera nästa revision. |
| 31. Katastrofåterställning | 6 | 5,5 | Säkerhetsdelen sänks eftersom falskt complete även undergräver påståendet om återställbarhet. | Borttagning mellan verifieringssteg reproducerad; cykel4 innehåller ingen backupfix eller ny katastrofövning. | Inget isolerat återställningsprov av aktuell produktionsbackup; copy_readback är begränsad äldre evidens. | Öppet internt backupfel samt B6: oberoende kopia/nycklar, RPO/RTO och faktisk full återställning. | Slutför granskad backupfix och mät ett separat godkänt katastrofprov. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | 28 hashbundna ändringar integrerade; parser, UI, navigation, UUID, fokus och laddning granskade inom sina avgränsningar. | 519/519 Node + 831/831 Sites, syntax70, TypeScript/build godkända; båda fulla audits har noll i alla allvarlighetsklasser. | Senaste exakta main6660 har Actions41102309328 success och Site35. Cykel4 saknar ännu eget CI-/publiceringskvitto. | Kända auth-/backupfel och slutlig leveranskontroll kvarstår; fler tester ensamt ger ingen poänghöjning. | Pusha endast fryst kandidat, verifiera exakt Actions-SHA och separat publicering; fortsätt reproducerade fel. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Cykel3 är nu faktiskt levererad som Sites35 med exakta GitHub-/arkiv-/deploykvitton; cykel4 hålls separat. | Cykel4 lokala grindar 1350 och syntetiska Chromium-kontroller; tidigare cykel3 1161 och exakt CI. | Site35 succeeded 18:04:29.900273 UTC; läsande bank/Gmail/backupstatus. Originating browser context saknas efter deployment. | B1–B6; ingen autentiserad Site35-webbkedja, nytt bankutfall, moln-OCR eller produktionsrestore. | Verifiera nästa exakta leverans och tillåtna produktionsflöden när rätt browserkontext finns. |


## Agent 1 — avgränsat referenskontrakt, 2026-11-02

Samtliga befintliga poäng behålls: **255/330 = 7,73/10; 0/33 ≥9,5**. De berörda områdena kund-/leverantörsfakturor, originalgranskning, dubbletter, referenser, betalningsmatchning, kundutkast och återställning får nya syntetiska regressionsbevis enligt [Agent 1-kontraktet](docs/integration/invoice-reference-policy.md) och PR-grindarna. Ingen produktionsacceptans eller publicering har utförts av Agent 1, och inga bankberoende poäng höjs. Två konkreta C1-kontraktsval — exakt M.George-standard och separata avsedda/deklarerade referenser vid konflikt — föreslås uttryckligen för integrationsansvarigs granskning.
## Agent 3 — avgränsad Bankgiroleverans

[Rapporten för automatisk Bankgiroinläsning](docs/integration/agent-3-bankgiro-auto-ingest.md) tillför syntetiska bevis för original/dubbletter, köåterhämtning, behörighetslås, rapportstatus och backupkompatibilitet. Områden 6, 13, 16–19, 24, 28–32 berörs, men **inga numeriska poäng höjs**. En ansluten verklig rapportkälla, bankavtal och verifierad produktionskörning saknas. CI- och testresultat gäller den separata funktionsbranchen och dess exakta PR-huvud; de certifierar inte bankfakta eller publicerad drift. Övriga agenters områden lämnas oförändrade.

## SaaS och legacybank — evidensuppdatering utan poängändring, 2026-11-05

**VERKLIG BANKANSLUTNING GODKÄND: NEJ. Kommersiell lansering: NOT_APPROVED.** Den äldre anslutningen är reauth_required efter BANK_ACCOUNT_SCOPE_INVALID; ny verklig Open Payments-anslutning är NOT_VERIFIED. En granskad kodrättning, grön CI eller lyckad webbpublicering innebär inte godkänd verklig bankfunktion.

**Före/efter:255/330=7,73/10, förändring0;0/33 områden≥9,5.** Nya tester och avgränsade produktionsläsningar ändrar evidensen, inte betygen.

### Oförändrade områdespoäng

| Nr | Område | Före | Efter |
| ---: | --- | ---: | ---: |
| 1 | Design och färger | 8 | 8 |
| 2 | Startsida | 8,5 | 8,5 |
| 3 | Navigering | 8,5 | 8,5 |
| 4 | Mobilanpassning | 8,5 | 8,5 |
| 5 | Sökning och filtrering | 7,5 | 7,5 |
| 6 | Minimal manuell hantering | 6,5 | 6,5 |
| 7 | Kundfakturor | 8 | 8 |
| 8 | Leverantörsfakturor | 8 | 8 |
| 9 | PDF-tolkning | 8 | 8 |
| 10 | Bild-OCR | 7 | 7 |
| 11 | Gmail-anslutning | 7,5 | 7,5 |
| 12 | Automatisk fakturaregistrering | 8 | 8 |
| 13 | Dubblettkontroll | 8 | 8 |
| 14 | Dokumentgranskning | 8 | 8 |
| 15 | Swedbank-anslutning | 8,5 | 8,5 |
| 16 | Automatisk bankhämtning | 8 | 8 |
| 17 | Bankgiroimport | 8,5 | 8,5 |
| 18 | Identifiera verklig betalare | 7 | 7 |
| 19 | Verklig OCR/fakturareferens | 7 | 7 |
| 20 | Automatisk betalningsmatchning | 7,5 | 7,5 |
| 21 | Delbetalningar | 8 | 8 |
| 22 | Överbetalningar | 8 | 8 |
| 23 | Flera fakturor i en betalning | 7,5 | 7,5 |
| 24 | Betalningshistorik | 8 | 8 |
| 25 | Betalningsstatus | 8 | 8 |
| 26 | Kontrollera alla betalningar | 8 | 8 |
| 27 | Automatiska mejlutkast | 8 | 8 |
| 28 | Schemalagd automatisering | 6,5 | 6,5 |
| 29 | Säkerhetskopiering | 7,5 | 7,5 |
| 30 | Säkerhet och åtkomstkontroll | 8,5 | 8,5 |
| 31 | Katastrofåterställning | 5,5 | 5,5 |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 |
| 33 | Verifiering i verklig produktion | 6,5 | 6,5 |

### Versionsbundna bevis och kvarstående gränser

| Områden | Verifierad evidens | Begränsning |
| --- | --- | --- |
| 1,3,4: UI och mobil | Separat fixture-CUA på actual CompanyWorkspace/BankPage vid320/390/768/1024/1440, ingen horisontell overflow, stabil inmatning, dialogfokus/Escape, viewerstatus läsbar med mutationsknappar inaktiverade. | Historiska41 Chromiumfall är ingen ny körning. Produktionsbrowsern nådde ingen DOM efter verktygtimeout; ingen fysisk enhet/skärmläsaracceptans. |
| 15–17,28: bank och automation | Integrerade Node/Sites-adaptrar och säkerhetsgränser. PR43 korrigerar reproducerad legacysemantik i kontoval/synk/detaljer med full inventariekontroll och strikt vald behörighet; säker diagnostik. | Faktisk legacybank är underkänd och ny OP-anslutning overifierad. Ingen återställd status eller ny providerhämtning. Bankgiro SOURCE_NOT_CONFIGURED; Gmail pausat. |
| 13,18–26: ekonomisk korrekthet | Råoriginal, hash, replay/dedup, ad7-bankfakta samt noll allokeringar i förhandsvisning.0599 kl. 15:01 har bevarad ekonomi/revision 51. | Tre aktuella samtyckesbedömningsfält försämrades mot 13:13; den senare projektionen är inte helt identisk. Bankbevis saknas, fakturan ofullständig/oregistrerad. |
| 24,29,31: historik och återställning | Additiva migrationer,27 ägarbundna backuptabeller, exakta historiska20/22/23-format, isolerad restore som inte återupplivar leaser/behörighet. | Senaste Nov5-backup35/362 verifierad, senaste fulla Nov4-backup362/362. Ingen full produktions-DR/RPO/RTO-övning. |
| 30: säkerhet | Tre faktiska syntetiska företag och owner/admin/accountant/viewer via Node SQLite och Sites D1/R2.8KiB login,16MB total multipart/15MB fil, säkra loggar, pinnade Actions. PR43 bevarar company/callback, tenant, lease, cooldown och commitfences. | Intern avgränsad acceptans; inga produktionscertifikat/avtal, fullständigt penetrationstest eller kommersiellt godkännande. |
| 32: ursprunglig release |95d9/672 gav1 899+3 704+47=5 650, överlappande 1 064 acceptansfall; historisk PR38 hade5 608 och oberoende78. | Dessa resultat gäller äldre träd och återanvänds inte som nya PR43-körningar. |
| 32: separat PR43 | Nytt ed92-träd ger1 899+3 756+47=5 702,0 fail/skip/cancel/TODO; syntax 170, types/build/mitigation gröna. Oberoende 180 och författare 274 överlappar. | Runtimeaudits 0, full Sites8 moderate/0 high/critical, oförändrade beroenden. Ingen poänghöjning; provisoriska avbrutna försök räknas inte. |
| 11,33: verklig drift | Historisk lyckad Sites61-publicering och13:13-kontroll; senare verkligt bankfel14:04 bekräftat14:47 och ny0599-läsning15:01. | Bankanslutningen är NEJ. Gmail pausorsak inte verifierad; historisk OCRprocessed0/failed0 bevisar ingen ny dokumentgenomströmning. |

### Aktuell verklig bankanslutning: NEJ

Det schemalagda legacybankförsöket **2026-11-05T14:04:35.832Z** misslyckades med **`BANK_ACCOUNT_SCOPE_INVALID`**, bekräftat i det fullständiga automationsresultatet och den läsande kontrollen **14:47:11.579Z**. Raden är `reauth_required`, `connected=false`, `sync_failures=1`, `blocked=false`; senaste lyckade synk är fortfarande **08:05:14.646Z**. Sparad giltighet löper till **2027-01-25T19:45:06.954Z**, och äldre consentmetadata saknas. En framtida utgångsdag bevisar inte aktuell auktorisering. [Daterat incidentkvitto](docs/saas/evidence/2026-11-05/bank-incident.json).

Bekräftad felväg är samtyckesvalideringen, och den tidigare generiska felrapporteringen tappade den specifika ConsentError-diagnosen. **Exakt felande kontopredikat är inte fastställt:** det verkliga providersvaret har varken bevarats eller hämtats på nytt. Den separat reproducerade legacyregressionen gäller ett giltigt valt konto när ett annat, ovalt konto lämnar den cachade fullmängden. Dess rättning ska inte presenteras som bevisad orsak till dagens livefel.

0599 lästes på nytt **15:01:10.767Z**: revision 51, `snapshotCurrent=true`, `changed=false`, fortfarande en ekonomisk AIS-observation och en icke-ekonomisk rapport på 62 500 öre vardera (625 kr), noll allokeringar, oregistrerad faktura och ofullständigt underlag. Jämförelsen mot 13:13 är **inte helt identisk**: utöver lästiden ändrades tre fält för aktuell samtyckesbedömning. Två kontoförklaringar kräver nu en aktiv ägarbunden anslutning och rapportens aktuella AIS-medgivande kräver granskning. Övriga valda svarsfält är lika. Efter Sites62 lästes samma valda svar15:37:27.308Z och jämfördes med15:01:10.767Z: **0 skillnader när enbart rekursiva checkedAt-fält undantas**. De tre samtyckesbedömningsskillnaderna mot13:13 kvarstår; ekonomin är bevarad. Ingen full workspacepayloadjämförelse påstås.

Cachelagrad applikationsmetadata från **2026-10-27T19:45:36.601Z** innehåller callback på den äldre `asdasdsa213`-hosten, medan publicerad applikation använder `sharbelrasho.chatgpt.site`. Providerregistrering och callbackens nåbarhet behöver verifieras inför en behörigt initierad förnyelse. Detta är läst D1-cache, **ingen färsk verifiering eller ändring hos providern**. Inga manuella bankanrop, produktionsdataåterställningar, ekonomiska åtgärder eller schemaändringar gjordes. Sites62-publiceringen återställde inte reauthstatusen. Den läsande efterkontrollen15:38:53Z visar fortfarande `connected=false`, `reauth_required`, ett misslyckat försök, samma last_success08:05:14.646Z och oförändrad bankradstid14:04:45.787Z. Ingen verklig bankåterhämtning är verifierad. [Efterkontroll](docs/saas/evidence/2026-11-05/bank-compat-release.json).

### Separat kompatibilitetsrelease, PR43

[PR43](https://github.com/sharbel0022/Mgeorge/pull/43), head `ab941744c3ee38be7ecd4c3121b8e7496082b9ab`, motsvarar lokal commit `47811cbbc91df25eb715af2953c79f92e8da38a1`, repositoryträd `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1` och Sites-underträd `a17a42a1c9a4976717003defc40aeb54b9624bfa`. Alla nya fulla grindar kördes på detta frysta index utan ostagade skillnader; senare commit och publicerat head har exakt samma träd. Det är nya körningar, inte återanvända672-resultat. [Nya grindar](docs/saas/evidence/2026-11-05/bank-compat-gates.json).

**1 899 Node + 3 756 Sites + 47 bridge = 5 702 godkända**, med 0 fail/skip/cancel/TODO. Syntax 170, typer, build och installerad minimatch-mitigering godkända. Runtimeaudits är 0; full Sites-audit har 8 moderate och 0 high/critical, på oförändrade beroenden. Oberoende 180 och författarnas 274 riktade fall överlappar fullsviterna. [Oberoende granskning](docs/saas/evidence/2026-11-05/bank-compat-independent-review.md) · [fil-/logghashar](docs/saas/evidence/2026-11-05/bank-compat-independent-review.json).

Sju filer korrigerar kontoval, synk och detaljhämtning för **endast befintlig legacykontext**. Fulla råa UID-inventeringar måste fortfarande vara begränsade, giltiga och unika; alla valda konton måste finnas i cache och aktuellt medgivande. Därefter bevaras strikt kontroll av vald usage, identitetshash, bank/PSU, transaktionsscope och utgång. Nya callbacks och company-mode förblir strikt fullmängdskontrollerade. Detaljhämtning kontrollerar hela det sparade kontovalet. Kanoniska felkoder/meddelanden bevaras utan providertext eller föränderliga gettervärden. Status, leaser, cooldowns, tenantgränser och data återställs inte. Tidigare assertions behålls; detaljfixturens konto-ID rättas till giltig UUID.

| Uppföljningsfält | Verifierat slutkvitto |
| --- | --- |
| PR43 huvud-CI | [42054035748](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035748), **success**; hämtade faktiska loggar visar1 899 Node+3 756 Sites+47 bridge,0 fail/skip/cancel/TODO. |
| PR43 säkerhets-CI | [42054035605](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035605), **success**;325 Node+750 Sites=1 075 överlappande fall,0 fail/skip/cancel/TODO. |
| Normal merge / runtime-release-SHA | `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f` |
| Separat main-CI | [42055222273](https://github.com/sharbel0022/Mgeorge/actions/runs/42055222273), **success** på b2e7f4b; skapad15:27:51Z, uppdaterad15:33:32Z. Faktiska jobb127341662492/127341662657/127341662877 visar1 899/3 756/47,0 fail/skip/cancel/TODO. |
| Uppföljningens Sites-version / source | **62, publicerad** / `1972b9a803458e20c6dedd30a8624ad4b96016f7`;575 källfiler matchar exakt Sites-trädet a17a42a1c9a4976717003defc40aeb54b9624bfa; ren arbetsyta. |
| Deployment | `appgdep_6aeca22254f4819197e33847966a7c70`, **succeeded**, uppdaterad `2026-11-05T15:35:16.437170+00:00`, miljörevision9 och samma URL. |
| Läsande efterkontroll | Kvitto15:38:53Z: publicerad version62,40 tabeller, samma arbetsyta/revision51, oförändrad auth/audience/miljömetadata och alla tre scheman. Bank fortfarande reauth_required.0599 kl.15:37:27.308Z är identisk mot15:01 utom rekursiva checkedAt-fält. |

Normal merge är `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`; även den separata main-CI-körningen är success. Slutlig proveniens finns i [bank-compat-release.json](docs/saas/evidence/2026-11-05/bank-compat-release.json). Sites62 använder source `1972b9a803458e20c6dedd30a8624ad4b96016f7`; versionerna60 och61 finns kvar. Hosting- och migrationsfiler är byte-identiska mot61. De fem namngivna auktoritetstabellerna har fortsatt0 rader, roller4 och arbetsytor1. Hemliga värden var maskerade; oförändrad miljörevision/metadata och avsaknad av mutation är konfigurationsbeviset. **Den lyckade deploymenten bevarade reauth_required; verklig bankanslutning är fortfarande NEJ.**

### Historisk Sites61-cutover, inte aktuell bankhälsa

Applikationsrelease `672c152242add9427c8526af8dd92431c526c8c2`, repositoryträd `03e5f4dafd6b272463338adda52a109ed91ceae9`, publicerades som Sites61 från source `2084aa358dd24dc241213dc3b71bae975f1e1029`. Git-trädet `fead95370aead0d422f3b7da766ad7eb9c33d0bc` matchade exakt med 575 jämförda källfiler. Deployment `appgdep_6aec802803e08191b2e86f52a61d9abd` lyckades **13:10:23.873423+00:00**. [Historiskt deploymentkvitto](docs/saas/evidence/2026-11-05/site-deployment.json).

Vid **13:13:22.521Z** var de maskerade bank-/Gmail-/Bankgiro-/backupobjekten identiska mot förkontrollen. Livetabellerna var 40, varav 11 nya; en arbetsyta behöll ägare/revision 51/uppdateringstid. **Endast de fem uttryckligen kontrollerade tabellerna** `companies`, `company_memberships`, `company_worker_grants`, `saas_bank_state` och `company_bank_sync_jobs` är belagda med 0 rader; `company_roles` hade 4. Detta är ingen census av samtliga nya auktoritetstabeller. Auth/audience/scheman och miljörevision9 med 17 nycklar var oförändrade. [Före](docs/saas/evidence/2026-11-05/production-before.json) · [Historiskt efter](docs/saas/evidence/2026-11-05/production-after.json).

Bankens connected-status i detta historiska kvitto ersätts av den senare underkända statusen ovan. Gmail förblir pausat med okänd verifierad pausorsak; senaste lyckade hämtning2026-11-03T18:38:10.461Z och separat tom `connection.last_synced`. Bankgirokälla `SOURCE_NOT_CONFIGURED`. BackupNov5 hade362 kopierade/35 verifierade filer; senast fullaNov4 hade362/362, verifierad21:32:59.743Z. API-kvitton16 respektive15 och112 poster utan kvitto är andra mått än filverifiering. Historisk [OCR42013301104](https://github.com/sharbel0022/Mgeorge/actions/runs/42013301104) påf75 hade processed0/failed0; tidigare404-originfel var rättat före fortsättningen. Ingen ny dokumentgenomströmning eller full katastrofåterställning certifieras.

Aktuell separat fixture-CUA täckte fem bredder, stabil inmatning och dialogfokus; viewer kunde läsa status medan mutationsknappar var inaktiverade. Historiska41 Chromiumfall räknas inte som en ny körning. Produktionsbrowserns bootstrap lyckades men navigeringen fick verktygtimeout/sessionreset, utan DOM-observation. Ingen visuell produktionsacceptans eller appkrasch påstås; autentiserade MCP-/D1-läsningar lyckades inom sitt avgränsade scope.

Källor: [samlad rapport](docs/SAAS-MULTITENANT-BANKID-FINAL-REPORT.md), [grindkvitto](docs/saas/evidence/2026-11-05/bank-compat-gates.json), [incident](docs/saas/evidence/2026-11-05/bank-incident.json) och [oberoende granskning](docs/saas/evidence/2026-11-05/bank-compat-independent-review.md). Alla 33 numeriska poäng är oförändrade.

Färsk läsande OCR-kontroll **2026-11-05T15:39:02Z** hittade ingen nyare schemalagd körning bland API-listans senaste15. Senaste observerade är [42013301104](https://github.com/sharbel0022/Mgeorge/actions/runs/42013301104), jobb127197454985, headf75; faktisk logg10:45:30.6420193Z gav **processed0, failed0**, schedule success. Detta verifierar varken bearbetning av ett verkligt dokument eller den nya b2e7-körkoden. Ingen workflowdispatch utfördes. [Sanerat OCR-kvitto](docs/saas/evidence/2026-11-05/final-ocr-observation.json).
