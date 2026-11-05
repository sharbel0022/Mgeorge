# Betalningar och sökning: verifierad förbättring, 2026-11-05

## Omfattning och grund

Arbetsgren: `feature/rating8-payments-20261105`. Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.

Arbetet förbättrar område 5 (sök/filter), presentationen av område 18–19 (betalare och referens), samt säker granskning i område 20 och 23 (matchning och flera fakturor). Gemensam bedömningsregel finns i `docs/quality8/PLAN.md` efter integration. Ingen poängtabell eller PROGRESS har ändrats här. Ingen bankkontakt, produktionsåtkomst, produktionsekonomisk skrivning eller ändring av ett medgivande har genomförts. Databasproven använder enbart isolerade syntetiska SQLite-filer.

## Reproducerade beteendefel och levererad ändring

| Fel före ändringen | Verifierat resultat efter ändringen | Bevis |
|---|---|---|
| Sites sökte en sammanhängande textsträng utan datum; `123,00 26/10/2026 REF-1` gav ingen träff. | Alla söktermer måste passa samma post, oberoende av ordning. Svenska belopp och ISO-/svenska sifferdatum stöds. | `sites/tests/workspace-search-final.test.mjs` |
| De första fyra delträffarna dolde en senare exakt referens. | Exakta referenser prioriteras innan fyra fakturor och fyra bankposter väljs. | Samma komponenttest och `test/workspace-search-quality8.test.js` |
| Node-fakturalistan kunde inte kombinera belopp, referens och datum. | Samma söklogik används i den levererade listan; befintliga status-/datumfilter och sortering består. Fullständiga filterresultat kapas inte till förslagsgränsen. | `test/ui-final-node.test.js` |
| En historisk koppling fick `invoiceVerified=true` trots beslut REVIEW utan fakturaoriginal. | Verifieringsmarkeringen kräver det aktuella beslutet VERIFIED. Historisk koppling och saldo bevaras. | `sites/tests/payment-evidence-status-final.test.mjs` |
| En historisk koppling fick samma markering trots BLOCKED när bankbetalaren saknades. | BLOCKED ger ingen verifierad fakturakoppling. Bankens saknade betalare fylls inte från fakturan. | Samma bevisstatustest |
| Förslagsvyn accepterade ett felaktigt VERIFIED-svar med flera allokeringar. | Flera fakturor kräver REVIEW, uttryckligt granskningsskäl, exakt summa och fullständiga delbelopp. Icke-ekonomiska observationer får inga föreslagna allokeringar. Delbetalning/överskott kan inte hävda VERIFIED; även en rad märkt full kräver noll fakturarest. | `sites/tests/reconciliation-proposal.test.mjs` |
| Flerfakturavyn visade delrader utan total/rest. | Tillgängligt belopp, fördelat i förslaget och kvar att fördela visas i hela ören. Inga skrivknappar införs. | Samma renderings-/transporttest |

Dessa sju beteendefall kördes röda mot den tidigare implementationen och gröna efter ändringen. Ett ytterligare gränsfall upptäcktes under arbetet i den nya beloppsparsningen: `SYN-001 123,00` kunde tolkas som beloppet 1 123,00. Ett separat rött test reproducerade det; parsningen kräver nu en ordgräns och låter inte en nollutfylld referens bilda första tusentalsgruppen. Vanlig `1 123,00` fungerar fortfarande.

Sökningen är läsande och etablerar inga ekonomiska samband. Dess Unicode-/deltextmatchning används aldrig för bankreferenspolicyn eller automatisk allokering. Sites indexerar och visar bankens referens via den befintliga källväljaren `bankPaymentReference`; en manuell referensöverlagring marknadsförs inte till bankreferens. Det beteendet är även testat genom den verkliga sökkomponenten.

## Sökprestanda och korrekthet

Mätfil: `docs/quality8/search-measurement.json`. Reproducerbar körning: `scripts/measure-workspace-search-quality8.mjs`. Tid: 2026-11-05T17:17:14.424Z. Runtime: v24.22.1.

Population: 10,000 helt syntetiska poster (fakturor och bankposter), nio fasta frågefall, en uppvärmning och tolv mätningar per fall och implementation. Den gamla produktionsalgoritmen körs på exakt samma poster: normalisering och valutaformatering på varje sökning, sammanhängande textmatchning, ingen datumindexering och stopp efter fyra träffar. Ny kod bygger index en gång per ändrat state och använder det för efterföljande frågor. Källans SHA-256 sparas i JSON.

- Korrekt utfall: **4/9 → 9/9**.
- Långsammaste enskilda scenarios p95: **1765.95 → 16.29 ms**.
- Separat indexbygge: **154.04 ms**.

| Sökfall | Före p50 / p95, ms | Efter p50 / p95, ms | Rätt efter |
|---|---:|---:|---|
| common-party-many-results | 0.268 / 9.331 | 4.436 / 16.030 | Ja |
| combined-swedish | 1372.334 / 1765.949 | 0.716 / 9.005 | Ja |
| reordered-swedish | 1200.705 / 1415.242 | 0.636 / 0.664 | Ja |
| date-and-amount | 1105.297 / 1718.200 | 0.653 / 0.678 | Ja |
| exact-ranks-before-limit | 241.032 / 335.949 | 4.437 / 16.290 | Ja |
| negative-amount | 1044.235 / 1509.497 | 0.705 / 2.082 | Ja |
| fullwidth-reference | 776.785 / 1203.452 | 0.947 / 3.165 | Ja |
| no-match | 774.019 / 1045.868 | 0.879 / 2.194 | Ja |
| blank | 0.001 / 0.002 | 0.001 / 0.003 | Ja |

En bred fråga som hittade sina fyra första rader direkt är långsammare med det nya fullständiga urvalet; det redovisas i första raden. Det är kostnaden för att kunna hitta en exakt träff även långt ned i registret. Mätningen gjordes i en delad utvecklingsmiljö med annan aktivitet och avser lokal CPU-logik, inte React-rendering, skärmläsare, nätverk eller en produktions-SLA. Variation mellan körningar är väntad; ovan redovisas slutkörningen med den levererade sökmodulens källhash. Tolv prov per fall är en liten jämförelsemätning, inte ett populationsestimat.

Node och Sites har byteidentisk sökmodul. Node levererar en klassisk skriptadapter före `app.js`; paritet testas. Den faktiska statiska hanteraren testas för `text/javascript; charset=utf-8`, medan försök att hämta privata `src`-/`sites`-sökvägar fortfarande ger 404. Frågor begränsas till 512 tecken och 32 termer; tomma, för långa och saknade frågor ger deterministiskt tomt resultat.

## Separat betalningsacceptans

Korpus: `test/helpers/payment-acceptance-quality8.mjs`. Mätfil: `docs/quality8/payment-acceptance-measurement.json`. Körning: `scripts/measure-payment-acceptance-quality8.mjs`. Tid: 2026-11-05T17:11:08.654Z. Förväntningarna är explicit angivna utanför produktionskoden och var fasta före slutmätningen.

**21/21 rätt beslut. Ett förväntat VERIFIED-förslag, noll falskt VERIFIED bland 20 fall där verifiering ska avstås, och 20/20 avståenden med förklarande koder. Noll inmatningsmutationer och noll ekonomiska skrivningar i förhandsgranskningen.**

Populationen innehåller exakta fördelningar över två och tre fakturor med ojämna ören; en öres underskott/överskott; motstridig kund; oregistrerad/ogiltig/ofullständig referens; saknad/manuellt angiven betalare; annat konto; utgånget medgivande; saknat bank-/fakturaoriginal; icke-ekonomisk observation; fraktionellt öre; konkurrerande betalningar; tvetydiga delmängdssummor; skillnad i ledande nollor; och två ägare till samma referens.

Varje fall kontrollerar korrekt status och fördelning, heltalsören, inga ändringar i indata samt samma resultat och snapshot vid upprepning. Båda testsviterna kör samma separata korpus mot det delade avstämningskontraktet. Ett uttryckligt företagsgodkännande kan fortfarande inte exekvera ett REVIEW-förslag för flera fakturor.

Detta mäter förslagets beslutsgräns, inte bankens förmåga att leverera riktiga betalar-/OCR-fält. Noll falska verifieringar i 20 negativa syntetiska fall är inte en uppskattad felfrekvens för verkliga betalningar. Den finansiella matchningsmotorn och dess beviskrav har inte lättats.

## Verifiering på levererade ändringar

- Node: **124/124** fokustester godkända, inklusive statisk leverans, båda bankvyerna, företagsbyte, sökning, accepterad korpus, verklig tvåprocesskonkurrens mot syntetisk SQLite, återstart/replay och kraschrollback.
- Sites: **100/100** fokustester godkända, inklusive sökkomponentens tangentbord/aktivering, betalningskällor, blockerade markeringar, förslagets transportgräns och renderade totalsummor.
- `tsc --noEmit --incremental false`: godkänd.
- `git diff --check`: godkänd.
- Fulla huvudsviter/CI och oberoende integrationstest återstår hos root; dessa fokustester ersätter inte dem.

Node-kommando från reporoten:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/workspace-search-quality8.test.js test/ui-final-node.test.js test/payment-control-ui.test.js test/payment-evidence-ui.test.js test/bank-ui.test.js test/bank-xlsx-ui.test.js test/company-ui.test.js test/payment-acceptance-quality8.test.js test/payment-concurrency.test.js test/payer-verification-atomic.test.js
```

Sites-kommando från `sites/`:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ../scripts/saas-test-isolation.mjs --test --test-concurrency=1 tests/workspace-search-final.test.mjs tests/payment-evidence-status-final.test.mjs tests/reconciliation-proposal.test.mjs tests/payment-acceptance-quality8.test.mjs tests/payment-evidence-ui-q8.test.mjs tests/bank-payment-ui.test.mjs
```

De tidigare SQLite-testerna bevisar att två processer importerar och avstämmer samma syntetiska betalning en gång, omkörning efter omstart inte dubbelräknar, abrupt avbrott rullar tillbaka importen och ett revisionsloggfel rullar tillbaka en betalarrelation. Dessa gäller befintliga skrivgränser. De är **inte** bevis för en ny atomär flerfaktura-batchoperation; någon sådan har inte införts.

## Kvarstående bevisgränser

Område 5 har nu konkreta funktions- och mätbevis på båda implementationerna. Berörd UI-layout har inte testats i en riktig webbläsare i detta delspår; den gemensamma visuella verifieringen och slutbedömningen ligger hos root.

Område 18–19 behöver fortfarande verkliga originaluppgifter från korrekt bankkälla. En rättad markering eller syntetisk korpus kan inte fylla den luckan. För den tidigare observerade referensen 0599 gäller fortsatt **en ekonomisk AIS-post, en icke-ekonomisk rapportobservation, noll allokeringar, oregistrerad faktura och ofullständigt underlag**; detta delspår har inte läst om eller ändrat produktionen.

Område 20 får utökad oberoende acceptans och bibehållna atomära/idempotenta säkerhetsgränser. Område 23 får säkrare och tydligare förslag med explicita hela-öre-fördelningar, men C4-förslaget är fortsatt en läsande granskning. Verkligt godkända flerfakturafördelningar och deras fullständiga operativa flöde har inte verifierats här. Ingen generell höjning till 8 i bankberoende områden hävdas av denna rapport.
