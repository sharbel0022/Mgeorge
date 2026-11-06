# Oberoende granskning: begränsad bankfelsprojektion

## Beslut: READY

Exakt produkt **92b6fefe60c31d8f862f6d93f2d422e777801390** får **READY inom den angivna avgränsningen**. Inga öppna materiella fynd. Ändringen lägger en valfri, begränsad felorsak till en redan otillgänglig detaljdiagnos. Granskaren har inte ändrat någon produktfil.

Det maskinläsbara kvittot är [review-evidence.json](review-evidence.json). Full integrerad CI och publicering är separata grindar som root hanterar. Beslutet är inte ett påstående om fungerande bankanslutning eller kontots verkliga usage.

## Frysta källor

| Källa | SHA |
| --- | --- |
| Publicerad bas enligt uppdraget | 0035ea89ef3cd60f0924f901503cad00d1ab1fca |
| Fryst RED | 9c1078cadfbca8923213f066cef1476c612796c6 |
| Produkt | 92b6fefe60c31d8f862f6d93f2d422e777801390 |
| Producentens evidens/docs | 7a0d08cf0f686d975baac8bc30205e245d10aacf |
| Produktens fullständiga gitträd | 75f05809b8bbd1194304805f55940951aa8ce94d |
| Sites-träd | 4feabc128c5f677103232d1cad1e4406083e8f19 |
| service.ts SHA-256 | cc3114a7bb7a9e4d013a50d7740d9b1f1389a47861a46c44d47e9b061d8e628d |

Granskningen gjordes i egen detached worktree från producentens dokumentationscommit, med produkt- och testbytes verifierade mot produkt/RED. Den enda produktdiffen är **sites/lib/banking/service.ts, 14 tillagda och 6 borttagna rader**. [Exakt diff](product.diff) och [källmanifest](source-verification.json) är bevarade. Adapter, policy och typer, readguard/cooldown, store, MCP och package-lock är oförändrade.

De tre berörda testfilerna är byteidentiska mellan RED, produkt och producentens docs. En separat rekonstruktion mot main visar att ändringarna före RED består av tre mockåterexporter, ett avsiktligt stärkt BANK_TIMEOUT-fält i en befintlig förväntan och 36 nya fall; övriga ursprungliga testbytes är identiska. Se [independent-test-preservation.json](independent-test-preservation.json).

## Kodbedömning

providerErrorCode läser en privat WeakMap med den ursprungliga konstruktörskoden. Tjänstens befintliga BANK_JOB_ERROR_CODES avgör vilka fasta koder som får lämnas ut. Publika errorfält, prototypefterlikning, getters, objekt-/funktionsproxyer och strängliknande koder kan inte tillföra en betrodd kod.

providerResponseDiagnostic används endast när den betrodda koden är INVALID_PROVIDER_RESPONSE. Dess befintliga privata register lämnar en kopia med ett fast fältnamn och en fast typklass. Offentliga validationIssue-fält kan inte skapa eller ändra detta underlag. Råvärden, meddelanden, statusfält och retryfält kopieras inte till providerFailure.

Den nya catch-kroppen lägger inga läsningar, retries eller skrivningar till flödet. Originalets ACCOUNT_USAGE_INVALID och BANK_ACCOUNT_SCOPE_INVALID behålls som 409 vid en fortsatt auktoriserad avvisning. Diagnosen läggs på just det ursprungliga ConsentError-objektet först efter befintlig failed-audit och dess efterföljande kontextkontroll. Authförlust behåller den strängare befintliga 401-gränsen och ingen diagnos; detta är verifierat även på oförändrad RED-produkt.

Partiella observationer lämnar inga usage-counts. Ett ändrat read-marker-token maskerar den tidigare providerorsaken och behåller väntespärren. Förlorat auditsvar och applikations-/authförlust efter en redan committad audit undertrycker diagnosen. Befintlig 503 Retry-After stoppar nästa försök utan en extra GET.

Svarens cache-policy är fortsatt private, no-store. Audit innehåller ursprunglig kanonisk avvisningskod, inga nya providerdiagnoser eller rådata. Anslutningsstatus, sparat konto, ekonomiska data och framgångskvitto får ingen uppgradering av diagnosen. Det positiva ORGA-provet bevisar uttryckligen att originalavvisningen kvarstår.

## Färska egna körningar

Samtliga testkörningar använder Node v24.22.1, NODE_ENV=test, scripts/saas-test-isolation.mjs, --experimental-strip-types och --test-concurrency=1. Alla bankgränser är syntetiskt mockade. Typkontrollen kördes från sites med det ordinarie guarded verktyget.

| Körning | Exit | Exakt resultat | Sekunder | Max-RSS KiB |
| --- | ---: | --- | ---: | ---: |
| independent-red-replay | 1 | 12/37 pass; 25 fail | 11.953 | 418956 |
| independent-green-focus | 0 | 37/37 pass; 0 fail | 9.519 | 420024 |
| independent-service-regressions | 0 | 357/357 pass; 0 fail | 68.635 | 840592 |
| independent-probes | 1 | 18/20 pass; 2 fail | 5.207 | 364372 |
| independent-probes-v2 | 0 | 20/20 pass; 0 fail | 5.308 | 367464 |
| baseline-harness-controls | 0 | 2/2 pass; 0 fail | 1.621 | 200192 |
| independent-typecheck | 1 | guard avvisade symlink | 0.102 | 40568 |
| independent-typecheck-physical | 0 | pass | 13.611 | 948792 |

Alla testkörningar har **0 skipped, 0 cancelled och 0 TODO**. De 37 fokuserade fallen ingår i de 357 servicefallen och summeras inte igen. De 20 slutliga oberoende fallen tillkommer; de två baslinjekontrollerna avser granskarens uppställningar.

Det egna RED-replayet reproducerar samma 25 fel som producenten. TAP:s expected och actual har maskinellt jämförts för samtliga fel: **enda skillnaden är saknad providerFailure**. Samma 37 frysta fall blir sedan gröna. [red-failure-analysis.json](red-failure-analysis.json) bevarar namn, feltyp och jämförelse. Producentens ursprungliga RED och SHA är oförändrade.

De egna 20 motproven återanvänder befintlig fixture genom en tillfällig byteidentisk prefixkopia med tillagda granskarfall. Endast granskarens testnamn körs i den körningen; ingen hel gammal svit har lagts in som en ny permanent testsvit. Båda egna appendversionerna, deras hashbindning och borttagningen av tillfälliga filer bevaras.

## De första egna harnessproblemen är bevarade

Första egna körningen gav 18/20. De två stoppen låg i fixturehjälparens krav på ConsentError och kunde därför inte användas som bevis för produkten:

1. Ett prov bytte runtime-privatnyckel efter seedning. Den befintliga generationbindningen avvisade detta före första providerläsningen. Slutprovet använder en separat syntetisk RSA-konfiguration enbart inne i den mockade providergränsen; alla kod-, field/kind-, getter-, sekretess- och anropsassertions är kvar.
2. Ett prov tog bort autentiseringen efter audit och förväntade felaktigt fixturets auktoriserade 409. Baslinjen bevisar att befintligt beteende är 401. Slutprovet kräver nu exakt 401, begränsade svarsfält, korrekt signIn, no-store och inga diagnoser eller tillståndsändringar.

Båda bakomliggande beteendena passerar som egna 2/2 kontroller på RED-produkt, där den nya produktfixen saknas. [harness-correction.diff](harness-correction.diff), [harness-issue-analysis.json](harness-issue-analysis.json) och de första råloggarna är bevarade. Ingen produktkod eller producentassertion ändrades för att få grönt.

Den första guarded typkontrollen avvisade dessutom node_modules-symlänken. Granskaren ersatte den med en fysisk kopia av samma låsta beroenden. Den oförändrade säkerhetsspärren och TypeScript passerade därefter med exit 0 och tom fellogg. Även denna första avvisning är bevarad.

## Produktionsgräns

Site 66:s verkliga svar är rootrapporterat: attemptedCount 1, observedCount 0 och generisk DETAILS_PROVIDER_UNAVAILABLE. Det visar inte om HTTP skickades, vilken felklass som inträffade eller om kontot är ORGA. Denna review gör inga nya bankanrop och drar ingen sådan slutsats.

Inga kvalitetspoäng, samtyckesrättigheter, kontouppgifter, anslutningsstatus eller produktionsdata ändras av reviewen. Ingen push, PR-/refändring, merge, workflowdispatch eller publicering utfördes. En lokal docs-only-commit bevarar detta kvitto.

## Artefakter

[review-evidence.json](review-evidence.json) innehåller alla exakta kommandon, cwd, tider, counts, rålogghashar, 20 provnamn, kravkontroller och avgränsningar. [requirements-verification.json](requirements-verification.json) är den korta maskinläsbara kravmatrisen. Samtliga råa TAP-loggar och körningskvitton finns intill rapporten, inklusive första egna underkända körningar.

[SHA256SUMS](SHA256SUMS) omfattar alla filer i denna granskningskatalog utom manifestet självt. Manifestet verifierades före dokumentationscommitten. Granskningen slutfördes 2026-11-06T04:38:42+00:00.
