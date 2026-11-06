# Agent 2 — Gmail och OCR: tillförlitlighet

## Leverans och avgränsning

Kandidaten ligger på feature/95-document-automation i [PR 67](https://github.com/sharbel0022/Mgeorge/pull/67) mot main. Basen är verifierad main f3c80629d4856c2f8ecbb1ed81be391a13ac6be8, återläst och oförändrad under arbetet.

Koden, syntetiska tester och granskningsunderlag är ändrade. AI-modelladaptern, finansiella regler, verkliga fakturor/original, motpartsbeslut, medgivanden, tokens, produktionsscheman och publicering är inte ändrade. Ingen Gmail-hämtning, OCR-körning, fakturaregistrering, köåterställning eller massbearbetning startades i produktion av detta arbete.

Detaljerade begränsningar, API-kontrakt och godkännandegrindar finns i [återhämtningsplanen](recovery-runbook.md). [Maskinläsbara observationer](observations-2026-11-06.json) innehåller sammanräknad driftstatus och körkvitton utan kundoriginal, mejltexter eller autentiseringsuppgifter.

## Aktuellt driftläge

Alla tider är UTC den 6 november 2026.

| Observation | Första läsning 22:38:08 | Senaste läsning 23:18:04 |
| --- | ---: | ---: |
| Underlag för granskning | 427 | 427 |
| Väntande OCR | 47 | 47 |
| Köade PDF-jobb | 4 | 4 |
| Slutförda dokument, rullande 24 timmar | 66 | 60 |
| Aktiva leases | 0 | 0 |
| Utgångna leases | 0 | 0 |
| Uttömda/felade jobb | 0/0 | 0/0 |

Skillnaden 66 till 60 gäller ett framflyttat 24-timmarsfönster; den är inte bevis för borttagna resultat. Äldsta väntande original har tidsstämpeln 2026-10-27T23:57:23.782Z. Efterkontrollskön rapporterade 0 väntande registreringsefterkontroller. Statusens jobbräkning registered:2 och dess separata registreringsmått registered:5 är olika mått och blandas inte ihop.

Senaste verifierade Gmail-hämtning är 22:28:06.718. Senaste molnworker-kontakt är 22:28:55.882 och senaste slutförande 22:29:00.180. Molnworkern var färsk vid första läsningen; vid den senare hade 45-minutersgränsen passerat och appen rapporterade ocr_worker_unavailable:true. Den gamla lokala workerns frånvaro används inte ensam som bevis för att moln-OCR är offline.

## Schemakörningarna är två olika kedjor

### Gmail via extern timautomation

Automationen är aktiverad och har ett timschema i Europe/Stockholm. Följande faktiska plattformsposter har lästs:

| Planerad tid | Plattformens kör-ID | Registrerat resultat | Motsvarande nytt appkvitto |
| --- | --- | --- | --- |
| 22:00 | 430b5336-57bc-8327-99c5-1512353ed450 | no_update; 22:02:24.358–22:02:25.459 | Inte observerat |
| 23:00 | 06981110-bf00-8327-ab9c-2c2d06c1b515 | no_update; 23:00:35.487–23:00:38.287 | Inte observerat |

Appens senaste automatiska invocation/result är fortfarande 16:26:56.945 /16:27:14.016. Plattformens senaste synliga resultattext hör till en annan körning vid 02:00 och får inte tillskrivas de senare körningarna.

Den sparade instruktionen kräver redan färska status-, auto-sync-, process- och efterstatusanrop, och förbjuder no_update när verktyg saknas. De tillgängliga plattformsposterna visar inte varför dispatch uteblir. Ingen autentiseringsbugg eller specifik plattformsorsak påstås vara fastställd. Applikationens nya kvitton gör nästa verkliga anrop korrelerbart; de reparerar inte i sig en extern tjänst som aldrig anropar appen.

### Moln-OCR via GitHub Actions

[Verklig schemakörning 42304814299](https://github.com/sharbel0022/Mgeorge/actions/runs/42304814299) startade 22:27:10 och avslutades framgångsrikt 22:29:03 på exakt main f3c80629d4856c2f8ecbb1ed81be391a13ac6be8. Jobb 128191356937 verifierade aktuell main 22:27:19.964 och 22:27:21.719 innan credential-steget. Resultatloggen 22:29:00.848 anger status complete, processed:6, failed:0. Appens molnslutförande ligger i samma tidsfönster.

Detta jobb föregick arbetets första statusläsning och startades inte av detta arbete. Den närmast föregående tillgängliga periodiska körningen startade 17:42:30. Konfigurationen är 7/15 minuter, men dessa körposter styrker inte kontinuerlig kvartskörning. Befintlig workflow behåller main-spärr, enkel samtidighetsgrupp, två färska main-kontroller, separata worker-credentials och maximal körtid. Cron, aktivering och hemligheter ändras inte.

## Inventering och rättade orsaker

| Del | Befintlig grund | Ändring i kandidaten |
| --- | --- | --- |
| Gmail import | Företags-/ägargräns, OAuth, lås, sidmarkör, leverantörsbackoff | Historiken materialiseras inte längre i sin helhet; högst 50 aktuella käll-ID:n per uppslag i båda implementationerna |
| Gmail schemaobservation | Invocation/result i auditlogg | Svarskvitto med kör-ID, riktiga tidsstämplar, utfall och persistensflagga; senaste matchande avslut skiljs från äldre framgång |
| PDF-kö | Högst två server-PDF per pass; övergång till OCR för skannat underlag | Accepterade resultat skyddas även efter avbrott på tidiga försök; lagringsfel får egen klass |
| OCR lease | Atomisk claim, owner/runner, tre försök | Valfritt protokoll 2, bounded heartbeats och tio minuters absolut leasetak |
| Resultat | Atomisk historik + jobbtolkning; ekonomiska registreringsspärrar | Kvittofråga löser förlorade svar; högst tre uppladdningar av samma resultat, ingen ny tolkning efter accepterat kvitto |
| Återhämtning | Slutförsök kunde räddas | Alla försök kan räddas; kandidater utanför tvåpostersbatch skyddas; jämförelse av lease och tolkning sker under skrivlåset |
| Tillfällig originallagring | Kunde felklassas som integritetsfel | Branded integritetsfel skiljs från transport; temporär completion behåller lease; accepterat resultat får fördröjd återhämtning med 24-timmarstak |
| Observerbarhet | Kontakt, köhälsa och 24-timmarsgenomströmning | Separata aktuella transport-, OCR-, integritets-, avbrotts- och granskningsmått samt accepted_pending |
| Registrering/efterkontroll | Unika atomiska registreringsmarkörer och beständig väntande efterkontroll | Bevarade och regressionstestade; en oklar efterkontroll får inte skapa ny faktura |

En oberoende granskning hittade dessutom en klientflagga som kunde kollidera med JSON från servern och en serverrace där en förlorad återhämtnings-CAS kunde falla igenom till generell lease_expired. Båda reproducerades först som felande tester och rättades. Klientens kvittobeslut är privata objektidentiteter; servern omprövar en förlorad snapshot vid nästa pass. De nya små protokollanropen läses med en verklig 4096-bytesgräns i strömmen.

## Testbevis och utförda jobb

Alla tester använder syntetiska original, syntetiska konton och SQLite/D1-fixturer. Ingen ny modellkörning eller betalningsåtgärd gjordes mot kundunderlag.

| Körning | Faktiskt utfall |
| --- | --- |
| Oändrad lokal worker-baslinje, Node 24.22.1 | 112/112 godkända |
| Första lokala Sites-baslinje | Avbruten på process-/miljönivå efter 30 godkända deltester; inte en godkänd helkörning |
| CI på tests-only 9263287, Node 24 | 3029 totalt; 3018 godkända, 11 förväntade regressioner |
| Klientkandidat 50459a6, Node 22 och 24 | Båda jobben godkända; Node 22-loggen innehåller 3029/3029 |
| Serverprotokoll före rättning | 18/18 nya fall misslyckades på förväntat beteende |
| Klientflaggekollision före rättning | 6 av 8 nya fall misslyckades |
| Gmail före rättning | 6 nya Node-fel, 12 nya Sites-fel; ytterligare invocation-persistensfall reproducerat separat |
| Oberoende recovery/body-limit-motprov före rättning | 5/5 misslyckades |
| Sammanfogad lokal Node-fokusgrind | 219/219 godkända, 0 fail/cancel/skip/TODO |
| Sammanfogad lokal Sites-fokusgrind | 339/339 godkända, 0 fail/cancel/skip/TODO |
| Syntax | 295 JavaScript-filer kontrollerade |
| Typkontroll | Direkt TypeScript noEmit godkänd; slutlig officiell typ-/installationsgrind är CI |

Exakta fokuskommandon:

```sh
node --test --test-concurrency=1 test/sites-ocr-protocol.test.js test/sites-ocr-heartbeat.test.js test/sites-ocr-pull.test.js test/sites-ocr-transport-recovery.test.js test/cloud-ocr-trigger.test.js test/gmail-adapter-reliability.test.js test/company-gmail-scheduler-integration.test.js
cd sites
node --max-old-space-size=1024 --test --test-concurrency=1 tests/document-worker-protocol.test.mjs tests/document-queue-recovery.test.mjs tests/cloud-ocr.test.mjs tests/gmail.test.mjs tests/gmail-adapter-reliability.test.mjs
```

Regressionerna omfattar omstart efter atomisk receipt, svarsförlust före/efter commit, samtidiga kompletteringar, tre accepterade utgångna jobb bakom en tvåpostersbatch, ersatt lease, exakt expiry vid skrivning, ändrat original mitt i återhämtningen, långsam heartbeat utan överlapp, avvisad autentisering, 429/Retry-After, falska kvittofält, stora strömmande payloads, saknade fakturauppgifter och ägarisolerad Gmail-deduplicering över 3000 historikrader.

Exekveringsmiljön försvann under arbetet. Källan säkrades via GitHub; efter återkomst användes ett isolerat checkout. Tillfälligt länkade beroenden gör att Sites ordinarie installationsintegritetsvakt inte kan räknas som passerad lokalt. Kandidatens slutliga bevis måste därför komma från PR:s rena CI-installation, kompletta Node 22/24- och Sites-sviter, audit, produktionsbygge, Bankgiro-bridge, Chromium, företagslastprov samt separat SaaS-säkerhetsacceptans. Exakta slutliga run-/job-ID:n och resultat redovisas i PR-beskrivningen; tidigare eller avbrutna kandidaters gröna deljobb ersätter inte dessa grindar.

## Kvarstående driftsarbete och acceptansgräns

- Kandidaten är inte publicerad. Site 69 var live vid inventeringen; ingen deployment genomfördes.
- Gmail-timdispatchen saknar fortfarande nytt matchande appkvitto. Tillgänglig historik avslöjar inte grundorsaken. Ett verkligt körspår med rätt anslutna verktyg och auktoriserat konto behövs genom tillåten driftsprocess.
- Moln-OCR har ett verkligt 6/0-schemakvitto, men regelbunden kvartskörning är inte styrkt och kontakten hade blivit gammal vid senaste statusläsning.
- Accepterade resultat bevaras och kan återhämtas. Ett klientavbrott före första varaktiga serveracceptans kan fortfarande kräva ny extraktion av originalet; ingen beständig klient-outbox införs. Det är en uttrycklig garantigräns.
- Saknade uppgifter och overifierad motpart kräver bättre dokumentevidens eller mänsklig granskning. 427 granskningsunderlag görs inte automatiskt gröna av köreparationen.
- Ingen OCR-kvalitetspoäng eller generell produktionspoäng höjs på grund av syntetisk tillförlitlighetsverifiering. Senaste konservativa totalbedömningen 258,5/330 =7,83/10 behålls tills relevanta faktiska driftbevis finns.
