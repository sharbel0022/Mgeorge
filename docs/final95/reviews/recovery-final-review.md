# Oberoende integrationsgranskning – MG Fakturakoll final recovery

Granskad branch: `feature/final-95-recovery`.

Granskad, fryst commit: `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`.

Jämförelser: senaste inventerade main `cde9178c0f8e8e386329ed8feaa4201e87b5a78f`, PR #49:s integrationshead `03f84afd61bb1020e73c17c3cde332a1b07f55a0` och PR #55:s UI-head `d6646dd0971650878738f81215d0cfc5c04a1da3`. Read-only-granskning avslutad 2026-11-06 11:40 UTC. Arbetskopian var ren och HEAD oförändrad efter granskning/prober.

## Slutsats

**Inga nya blockerande eller materiella säkerhetsfel identifierades i den granskade konfliktlösningen.** Det gäller bankens diagnosproveniens och läsbehörigheter, SQLite-start och processharness, den nya återhämtningen av fler än två avbrutna sista OCR-försök samt överlagringen av UI #55 efter #49.

Detta är en oberoende kod- och negativtestgranskning av den angivna committen. Fullständiga testgrindar och färsk browserverifiering sköts av huvudagenten. Resultatet är inte verifiering av verklig bankanslutning, Bankgirokälla, kunders dokument, Gmail-kö eller driftsatt kod och ändrar inga kvalitetspoäng i sig.

## Kontrollerade integrationsgränser

| Område | Observation | Bedömning |
|---|---|---|
| Bankens offentliga och lagrade diagnoser | `bankAccountScopeReason()` läser main:s privata WeakMap. `consentDiagnostic()` läser en separat WeakMap med fryst, kanonisk code/message/status/reason. `bankFailure()` prioriterar main:s offentliga scope reason men behåller den mer precisa lagrade orsaken för audit. | Ingen läsbehörighet eller kontoidentitet kan härledas från de muterbara offentliga Error-fälten. Prober täcker getterfält och förfalskad prototyp. |
| Riktad account-usage-diagnostik | Den ursprungliga felinstansen och exakt samma inputobjekt med oförändrat fingerprint krävs. Planen är fryst och knuten till valda UID/primär identitet; observerade ORGA-detaljer ändrar aldrig det avslagna medgivandet. Service publicerar diagnosen först efter den skyddade felhändelsens commit. | Main:s snävare läscapability är bevarad tillsammans med #49:s mer precisa felorsaker. |
| Applikationsmetadata | `connectionHealth()` och den särskilda usage-leasen kräver `Array.isArray` för både services och countries före includes. Felaktig metadata kan därför inte annonseras som aktiv anslutning. | De fem äldre efter-svar-fallen muterar nu metadata under det tillåtna sessionssvaret; fem nya preflightfall kräver noll provideranrop. Det är utökad kontroll av båda tidsfönstren, inte försvagad assertion. |
| Förfalskad felkod | Det äldre toleranta testet för växlande getterkod är striktare: exakt `BANK_SYNC_FAILED`, ingen läsning av gettern och inget privat felinnehåll i audit/status. | Kanonisk diagnosproveniens stärkt. |
| SQLite och finansiella vakter | `src/db.js` skiljer sig från main endast med en förklarande kommentar. `busy_timeout=5000` ligger före `journal_mode=WAL`; main:s gemensamma ekonomivakter och referensregler är oförändrade. | Ingen ekonomisk eller databasrelaterad säkerhetsregression i konfliktlösningen. |
| Concurrency-harness | Tvåprocessarbetarens stderr begränsas till 8192 byte. Avslut före ready/done avslår även med exitkod 0; done väntar dessutom på lyckat processavslut. Båda löftena observeras direkt; abort stoppar barnet och cleanup inväntar close innan katalogen tas bort. | Main:s begränsade diagnostik kombinerad med #49:s strängare processlivscykel och verkliga SQLite-låstest. Ursprungliga import-, replay-, allocation-, audit- och rollbackassertioner är kvar. |
| Avbruten sista OCR-körning | Återhämtning väljer högst två utgångna jobb per pass, inklusive äldre/orphaned jobb. Endast valt jobb kan övergå till review eller failed; tidigare bulk-fail av ännu oinspekterade kvitton finns inte. | En tredje giltig receipt ligger kvar för nästa pass. Inget nytt OCR-försök eller automatisk fakturaregistrering skapas av recovery. |
| OCR-original och samtidighet | Recovery till review kräver rätt owner/document/lease/run-id, exakt kvittohistorik, rätt SHA/size, verifierade originalbytes, aktiv källa och frånvaro av registrering. Fallback till failed kräver fortfarande exakt valt lease/extraction/attempts/lease_until och ingen registrering. | Ett förnyat eller redan registrerat jobb skrivs inte över. Original, extraktion och historik behålls. Giltiga och ogiltiga första kvitton i tredokuments-backlog täcks av nya regressioner. |
| UI #55 efter #49 | Dashboard behåller main:s `activate()` → `dismiss()` → `open()` så dialogen återgår till ett beständigt sökfält. #55:s OCR-placeholder, laddnings-/felstatus och resten av presentationen finns kvar. Main:s komponent och separata etiketter för manuella fördelningar är bevarade. | Korrekt integrationsordning och konfliktlösning. |
| UI-integritet och företagsbyte | Retained review innehåll är hidden/inert vid otillgänglig läsning och rensas vid signed_out. Företagsbytets överordnade komponent monterar av det privata trädet och byter browserdokument efter servergodkännande. | Bevarade barriärer; ingen ny återanvändning av tidigare företags formulär eller pollingcache identifierad. |
| Övriga UI-filer | De jämförda UI-produktfilerna från #55 är identiska utom dashboard ovan och ett bibehållet main-meddelande om `consent_recovery_required` i bank-onboarding. | Inget oavsiktligt bortfall av senare main-skydd identifierat. |

Den publika Error-egenskapen `reason` är nu skrivbar, medan dess privata provenancepost är oföränderlig. Granskningen bekräftade att policyplanering, HTTP-projektion och audit läser de privata posterna; detta gav inget materiellt säkerhetsfynd. Kraschtestets separata engångsprocess har oförändrad stderr-hantering från båda jämförelseversionerna; granskningens 8192-byte-observation gäller den delade concurrency-arbetaren.

## Egna körda kontroller

`NODE_ENV=test node --test /workspace/scratch/0005a76ddf57/recovery-review-probes.mjs`

Node `v24.22.1`. Resultat: **6 tester, 6 PASS, 0 FAIL, 0 cancelled, 0 skipped, 0 todo**. Varaktighet 181,230 ms. Syntetiska, processlokala policydata; inga provideranrop, inga databas- eller produktionsoperationer.

De sex fallen verifierar:

1. Frysta privata diagnoser överlever fientliga getters på code/status/message/reason.
2. Förfalskad prototyp och publik felkonstruktor kan inte skapa läscapability.
3. Kopierat eller ändrat input förlorar capability.
4. Detaljobservation kan varken utvidga UID-urvalet eller reparera avslaget medgivande.
5. Offentliga scope reasons och mer precisa lagrade orsaker förblir separata och kanoniska.
6. Ogiltig, avslagen, utgången, återkallningspågående eller obehörig lagrad anslutning annonseras inte som connected/syncAllowed.

`git diff --check cde9178c0f8e8e386329ed8feaa4201e87b5a78f HEAD` gav exit 0. Inga tester ändrades eller kördes om för att dölja fel. Inga produktfiler ändrades av denna granskare. Egna prober och resultat ligger utanför repot för att inte störa huvudagentens frysta sourcemanifest.

## Evidens och återstående grindar

- `/workspace/scratch/0005a76ddf57/recovery-final-review-evidence.json`: exakt HEAD/branch, jämförelse-SHA, SHA-256 för 13 granskade produkt-/testfiler och eget testresultat.
- `/workspace/scratch/0005a76ddf57/recovery-review-probes.mjs`: reproducerbara egna negativa prober.
- `/workspace/scratch/0005a76ddf57/recovery-review-probes.tap`: verkligt testrunnerresultat.
- `/workspace/scratch/0005a76ddf57/recovery-review.md`: tidigare granskning av #49:s SaaS/security/gates och #55 innan integration.
- `/workspace/scratch/0005a76ddf57/recovery-inventory.md` och `.json`: första verifierade integrationsmatris, GitHub-status och 33-kriteriersbaseline.

Behåll ordningen aktuell main → den granskade samlade #49-leveransen → #55. De äldre överlappande öppna heads #45–47 och #50–54 ingår redan i #49:s graf; de ska inte appliceras igen. Här konstateras endast lokal integration, inte att någon av dessa PR har mergats på GitHub.

Fortsätt med huvudagentens fullständiga grindar för exakt källsnapshot, aktuell browseracceptans och efter push exakt-head-CI. Drift-, bank-, Bankgiro- och dokumentacceptans kräver separata riktiga observationer och får inte härledas från dessa syntetiska resultat.
