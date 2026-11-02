# PAYMENT-0599 – Bankgiroverifiering och säker avstämning

Datum: 2026-11-02. Rapporten beskriver uppdraget för referens **0599**. Kundoriginal, fullständiga kontoidentifierare, privata dokument-ID:n och originalhashar publiceras inte här. Tester använder syntetiska betalare, konton och original.

## Leverans och avgränsning

- Utgångspunkt: senaste lästa `origin/main`, `a9f88ae1c0f697376b3ecd140e1e80a64405125a`.
- Utvecklingsbranch: `fix/payment-0599-bankgiro-verification-20261102`.
- Implementationscommit som verifierats: **`2375efc8c3491c9afda156ed1a12e64541b927ca`**.
- Fullständig CI på implementationscommit: **[41505400686](https://github.com/sharbel0022/Mgeorge/actions/runs/41505400686)**.
- Senast kontrollerade main: **`a9f88ae1c0f697376b3ecd140e1e80a64405125a`, 2026-11-02 19:00:37 UTC; oförändrad sedan start**.
- Leveransen ska granskas i en PR mot main. Ingen automatisk merge, force-push eller Sites-publicering ingår i denna parallella utvecklingsomgång.
- Inga verkliga fakturor har registrerats, inga underlagsrelationer har bekräftats och inga allokeringar, betalstatusar eller kundmeddelanden har skrivits.

**Tekniska fel inom uppdraget är rättade och verifierade enligt testavsnittet. Det verkliga betalningsfallet är fortfarande externt blockerat.** Bankens kontorelation och kopplingen mellan rapportens insättning och AIS-posten saknar erforderligt bevis. Den riktiga fakturan är fortfarande oregistrerad och kräver separat behörigt verksamhetsgodkännande.

## 1. Inventering av den befintliga kedjan

| Del | Befintlig funktion och granskad kod | Krav på bevis |
| --- | --- | --- |
| AIS-original och identitet | `src/importers.js`, `sites/lib/banking/transactions.ts`, originalkontroller i domän/reconciliation | Bevarat bokfört banksvar, kvitto, stabil kontoidentitet och inga motstridiga bankuppgifter |
| Bankgirooriginal | `sites/lib/bankgiro-parser.js`, `sites/lib/bankgiro-xlsx.js`, Node-importören | Ägt oförändrat original, säker filstruktur, fullständigt antal och heltalsbelopp |
| Bankens kontoidentifierare | `sites/lib/banking/account-evidence.ts`, `sites/lib/bankgiro-service.ts`, `src/bankgiro-links.js` | Aktuellt ägarbundet produktionsmedgivande, valt SEK-konto, entydig uttrycklig identifierare från bankens kontoresurs |
| Rapport–insättningsrelation | `sites/lib/domain.ts`, `src/bankgiro-links.js` | Gemensam bankidentifierare för automatisk hantering, eller ett separat behörigt manuellt underlagsbeslut som förblir manuellt |
| Betalare och referens | Bevarad payer-/reference-evidens, XLSX-cellproveniens och betalningspresentation | Bankens rapporterade namn och exakt referenstext bevaras; fakturakunden ersätter inte saknade bankuppgifter |
| Fakturaförslag | `sites/lib/banking/invoice-candidates.ts`, befintligt dokument- och fakturaregister | Ett sökförslag är ingen registrering, kundattest eller betalningsallokering |
| Avstämning och commit | `sites/lib/reconciliation-evidence.ts`, `sites/lib/reconciliation.ts`, tillstånds-API | Original och varje berörd kontorelation kontrolleras före ny ekonomi; medgivandet kontrolleras igen i samma atomiska D1-transaktion |
| Granskningsförklaring | `sites/lib/payment-verification.ts`, läsande MCP-verktyg | Separata statusar för original, konto, samma insättning, betalare, referens, faktura, kund och avstämning |

Datum och belopp används bara för att hitta granskningsförslag. En innehållskontrollsumma visar att bevarade bytes stämmer med kvittot; den bevisar inte ensam bankens autenticitet eller vilket AIS-original rapporten hör till.

## 2. Aktuella privata läskontroller

De läsande produktionsverktygen returnerade oförändrat workspace vid revision **42**, med `changed=false` och `snapshotCurrent=true`. Betalningsurvalets kontrollkvitto är daterat **2026-11-02T18:53:50.602Z**; kontrollen av det ägda rapportoriginalet **2026-11-02T18:53:50.696Z**.

| Kontroll | Faktiskt läsresultat | Praktisk slutsats |
| --- | --- | --- |
| Ekonomisk insättning | En AIS-post i målurvalet har `countedEconomically=true` | En ekonomisk insättning räknas i det undersökta fallet |
| Rapportpost | En separat rapportpost har `countedEconomically=false` | Rapporten skapar ingen andra ekonomisk post |
| Rapportoriginal | Ägda bytes, storlek och SHA-256 passerar; rapportläsningen är komplett med en betalningsrad | Originalet är tillgängligt och integritetskontrollerat |
| Referens | Exakt sträng `0599`; strukturerad betalningsreferens, ingen uttryckligt styrkt formell OCR | Inledande nolla och ursprungligt fält bevaras |
| Rapportkonto | `accountVerified=false`; kontot saknar entydig relation till det aktuella valda kontot | Kontoalias får inte räknas fram eller antas |
| Samma insättning | Ingen styrkt gemensam insättningsidentifierare; ingen bekräftad manuell underlagsrelation | Liknande belopp och datum bevisar inte sambandet |
| Betalare | Rapportens individuella namn finns; AIS saknar verifierad individuell betalare | Rapportnamnet får inte föras över som bankverifierad AIS-identitet |
| Fakturaregister | Fullständig registerkontroll: `complete=true`, `matchCount=0` | Den riktiga fakturan är fortfarande oregistrerad |
| Fakturaoriginal | Ett bevarat ägt fakturaunderlag finns; originalintegritet passerar i den separata verifieringsvyn | Underlaget är ett granskningsförslag och ingen godkänd registerpost |
| Fakturaförslagets godkännande | Kandidaten har `needsReview=true` och `originalVerified=false` i förslagslistan | Integritetskontroll av bytes ersätter inte attest av innehåll och kund |
| Allokering | Båda posterna har noll bokade allokeringar och `automaticEligible=false` | Ingen automatisk fakturabetalning får göras |

**Omfattningsgräns:** hela referenssökningen anger `referenceSearchComplete=false` och `complete=false`, eftersom individuella referenser saknas på bankunderlag. Ingen nästa sida finns. Detta förväxlas inte med fakturaregistrets separata kompletta nollträff. Slutsatsen om en ekonomisk post gäller det uttryckliga målurvalet; den är inte ett påstående om att hela kontohistoriken har verifierats.

Verktygen ovan läser befintliga original och bankresurser och kontaktar inte Swedbank eller Gmail. Ett äldre komplett konto-detaljkvitto anger att ingen motsvarande uttrycklig aliasrelation hittades. Senare rate-limit-kvitton med okänd återförsökstid har inte använts som tillstånd för ett nytt bankanrop. Den äldre kontrollen presenteras som historisk, inte som en ny komplett läsning från Swedbank.

### Tidigare originalkvitton jämfört med ny kontroll

Ett befintligt privat granskningsförslag lästes i sin helhet. Det innehåller ett tidigare detaljerat cellutdrag och en PDF-granskning från **2026-11-02T10:56:32.889Z**. Metadata för två XLSX-kopior visar att filerna finns; deras råinnehåll kunde inte öppnas direkt för en ny självständig cellgranskning i denna session. Lika filstorlek används inte som bevis för byteidentitet. Det äldre kvittot redovisar byteidentitet mellan kopiorna; den aktuella ägda rapportens integritet och nytolkning styrks separat av produktionsverktyget ovan.

Det historiska cellutdraget redovisar bland annat en elektronisk betalning, noll avi-belopp, överensstämmande total- och detaljantal, ett uttryckligt mottagarkonto, löpnummer som text, avsändarnamn, exakt referens `0599` och noll formler. Det anger `currencyExplicit=false` och ingen separat bokförings- eller valutadag. Rapportframställningens tidsstämpel är inte betalningsdatum. Konto- och betalarnummer återges inte i Git.

PDF-originalet öppnades inte på nytt för visuell granskning. Det tidigare kvittot beskriver textutvinning från exakta bytes och visuell granskning, med 9/9 redovisade numeriska/datum-/valutafält per kontrollmotor och `manualReviewRequired=true`. Fakturans fält ”Er referens” innehåller enligt kvittot en kontaktperson och ska inte behandlas som OCR. Den färska kontrollen av det ägda PDF-originalets integritet ersätter inte denna innehållsgranskning eller verksamhetsattest.

En tidigare dokumenterad offentlig katalogobservation gav stöd för en möjlig juridisk kund-/betalarrelation trots olika namn och adresser. Den kontrollen återupprepades inte här, styrker inte innehav på betalningsdagen och används inte för att skapa en betrodd relation. Aktuell kundstatus förblir **kräver granskning**.

## 3. XLSX-struktur och rapportfält

Den aktuella exportprofilen är **Swedbank Bankgiro XLSX / Insättningsuppgift**. Den är ingen generell specifikation för varje export som en bank kan producera. Parsern behåller originalet och godtar endast den uttryckligen stödda strukturen.

| Fält eller struktur | Hantering och evidensgräns |
| --- | --- |
| Arbetsbok och ZIP | Begränsad komprimerad/expanderad storlek, CRC och arkivstruktur; osäkra eller okända layouter, formler, länkar, felceller och dolda data avvisas |
| Rapportdatum, normalt A5 | Bevaras som rapportens `Datum`; etiketten bevisar inte separat bokföringsdag eller valutadag |
| Mottagarkonto, normalt B5 | Bevaras från originalet; koppling kräver exakt banklevererad identifierare på rätt kontoresurs |
| Mottagarens Bankgiro, normalt C5 | Egen identifierare; är inte kontonummer, avsändarbankgiro eller individuellt betalnings-ID |
| Mottagarens namn/adress i sammanslagna celler | Tillåten layoutinformation; härleds inte till ytterligare bankidentifierare |
| Antal, belopp och betalningstyp | Elektronisk/avi, totalsumma och detaljantal måste stämma; saknade eller motstridiga delar avvisas |
| Insättningslöpnummer | Råtext bevaras. Samma rad med etikett och värde samt separat värdecell stöds; faktisk värdecell och eventuell etikettcell redovisas var för sig |
| Avsändare, normalt A19 | Endast verklig textcell godtas; ursprungligt namn, diakritiska tecken och fältkälla bevaras |
| Betalningsreferens, normalt C19 | Sträng `0599` bevaras exakt. Numerisk referens kräver uttryckligt nollformat; bortfallna nollor gissas aldrig |
| Avsändarens Bankgiro/avinummer, normalt D19 | Bevaras separat från mottagarens Bankgiro; är inte i sig verifierad organisationsidentitet |
| Individuellt belopp, normalt E19 | Heltalsören, positivt belopp och exakt summering mot rapporten |
| Valuta | Endast ett uttryckligt valutafält är bankevidens. Profilens SEK-standard är en antagandeetikett och räcker inte för verifierad koppling |
| Sidfot och genereringstid | Bevaras i originalet och valideras som tillåten sidfot; används inte som bokföringsdag eller insättningsidentitet |
| Flera rapportblock | Varje block måste vara fullständigt; samma kanoniska insättning får inte upprepas inom arbetsboken |
| Exportens fullständighet | Filens fullständighet och aritmetik kontrolleras. En filtrerad/paginerad bankexport kan ändå sakna underlag utanför filen; ett komplett bankunderlag krävs vid osäkerhet |

Bankgirots ELIN-hjälp beskriver Excel-export och att större betalningslistor kan kräva export av varje sida. Kontrollen kan därför inte ersättas med att den synliga summan på en skärmbild råkar stämma. Se de officiella källorna nedan.

## 4. Implementerade rättningar

### Aktuella och entydiga bankstyrkta kontoalias

Tidigare kontrollerade Sites återkommande den redan upplösta primära kontoidentiteten. Det ursprungliga rapportkontots relation kunde därför försvinna efter import, medan rapporten fortfarande fick ligga till grund för en ny betalningsallokering.

Nu kontrolleras paret **primärt konto + rapportens ursprungliga mottagarkonto** under förhandskontroll, ny rapportpromotion, uttrycklig originalkontroll och commit. Samma uttryckliga identifierare måste tillhöra precis en bankresurs, inklusive resurser som inte är valda eller har annan valuta. Resursen måste vara det valda SEK-kontot i rätt ägares aktiva produktionsmedgivande.

Endast typade `IBAN`, `BBAN` och `CPAN` från bankresursens identifierarfält godtas. Formateringsskillnader får jämföras utan att lägga till, ta bort eller beräkna kontosiffror. En saknad rapportidentifierare får inte ersättas med det redan upplösta IBAN-numret.

Varje distinkt kontopar kontrolleras innan identiska medgivandesnapshots sammanförs. Både ändring under första läsningen och ändring mellan snapshot och databascommit avvisas utan partiella allokeringar eller auditposter. Historiska delbetalningar, föräldrarelationer och ekonomiskt medlemskap bevaras när nytt underlag måste inväntas.

Node kontrollerar även ett direkt primärt IBAN mot alla bankresurser innan det godtas. Sites manuella underlagskoppling avvisar en aktuell kontospärr från det nytolkade originalet; att gamla observationsfält råkar vara oförändrade kan inte dölja spärren.

### Insättningsidentitet separat från innehållsfingeravtryck

Den nya interna reservationsnyckeln för den stödda ELIN-profilen består av **mottagarbankgiro + år + normaliserat insättningslöpnummer**. Bankgirot anger att insättningslöpnumret är unikt per bankgironummer och år. Därför reserverar exempelvis löpnummer `83` och `00083` samma insättning i syntetiska tester.

Befintliga rapportfingeravtryck, originalhashar och råvärden ändras inte. Både äldre och nya aktiva manuella relationer kontrolleras mot den stabila reservationsnyckeln. En ändrad export med annat namn, referens, datum inom samma år eller formatering kan inte reserveras till ytterligare en AIS-post. En återtagen relation kan efter separat granskning ersättas.

Nyckeln är ett skydd mot dubbel reservation. **Den används aldrig som bevis för AIS-samband eller som tillstånd för automatisk allokering.**

Om en annan aktiv rapports original inte kan verifieras hålls en ny reservation tills originalet återställts eller relationen granskats. En redan aktiv relation med eget intakt original förblir verifierbar; känd faktisk identitetskonflikt spärrar fortfarande.

### Referenser, namn och oregistrerade fakturor

Registrerade fakturaförslag använder samma exakta referensjämförelse som oregistrerade dokumentförslag. Det undviker att `AB12` och `AB-12` behandlas olika beroende på registreringsstatus, samtidigt som stödd etikett `Faktura 0599` kan matcha exakt referens `0599`. Referensen `599` matchar inte `0599`.

XLSX-parsern avvisar Boolean-celler som tidigare kunde bli skenbara avsändarnamn. Textnamn bevaras. Sekvensproveniens pekar nu på den faktiska värdecellen när löpnummer och etikett ligger separat.

Tidigare sparade rapporter med den gamla etikettcellsproveniensen kan fortfarande verifieras: servern härleder exakt den kända gamla representationen från det nytolkade, hashkontrollerade originalet. Alla andra fält och betalningsuppgifter måste fortfarande stämma exakt. Lagrade observationer och revisionshistorik skrivs inte om.

Granskningsvyn visar dessutom rapportens råa insättningslöpnummer och rapportdatum samt exakt vilka konto- och insättningsuppgifter som saknas. Fakturaförslag förblir en separat granskningsnivå.

## 5. Underlag som måste begäras från Swedbank

Begär ett bankutfärdat underlag för den undersökta insättningen med följande uppgifter:

1. **Kontorelation:** rapportens fullständiga mottagarkonto, mottagarens Bankgiro och det valda AIS-kontots IBAN eller bankidentifierare; uttrycklig bekräftelse att de avser samma mottagarkonto, identifierartyp och giltighetsdatum.
2. **Insättningsrelation:** AIS-postens stabila bank-ID/transaktionsreferens och bankens uttryckliga koppling till rapportens insättningslöpnummer, år och mottagarbankgiro. Ett löpnummer ensamt eller datum/belopp räcker inte.
3. **Belopp och tidsfält:** uttrycklig valuta, belopp, bokföringsdatum och valutadatum, samt förklaring av eventuella skillnader mot rapportens `Datum`.
4. **Komplett individuell betalningsspecifikation:** antal, totalsumma, alla sidor/delar, individuell betalningsidentifierare om tillgänglig, exakt avsändarnamn, avsändarbankgiro/avinummer och referensen `0599` i oförändrad text.
5. **Spårbarhet:** bankens utfärdandedatum och en verifierbar originalkälla eller ett behörigt bankärende som binder ihop uppgifterna. Ett allmänt exempel på clearingnummerformat är inte ett kontobevis för den här insättningen.

Begäran är ett underlagskrav. Ingen kontakt med banken har skickats från detta uppdrag.

När bankbeviset finns återstår **separat behörigt verksamhetsgodkännande** av fakturaoriginal, fakturaregistrering och kund-/eventuell tredjepartsrelation. Därefter måste avstämningen köras med aktuella original, aktuell kontoåtkomst, entydig referens och rätt kvarstående saldo. Den tekniska PR:n är inte denna attest.

## 6. Regressioner och verifiering

Alla tester använder syntetiska original och konton. Den lokala exekveringsmiljön blev otillgänglig under sessionen; därför kördes repositoryts oförändrade obligatoriska GitHub Actions-flöde på exakt angivna commits. Ingen lokal testframgång, Windows-körning eller faktisk Sites-driftsättning påstås.

| Kontroll | Commit / körning | Resultat |
| --- | --- | --- |
| Regressioner före rättning | `f49b2488d43c89b5503d50b03d07ee8c1b0c5f3d`, [41503280659](https://github.com/sharbel0022/Mgeorge/actions/runs/41503280659) | Node: 1081 tester, 16 förväntade fel. Sites: 1952 tester, 31 förväntade fel. Totalt 47 reproducerade fel |
| Första rättning och XLSX-blockskydd | `1dc4336c57b13fc15f2adcf81c7337ebf5cc9c20`, [41504095087](https://github.com/sharbel0022/Mgeorge/actions/runs/41504095087) | Node 1081/1081; Sites 1959/1959; noll överhoppade. Syntax/typ, båda auditkontrollerna och Sites-produktionsbygge passerar |
| Oberoende granskningsregressioner | `f1f4055c3309334434b5520f433bd2e3df0a3dab`, [41504647226](https://github.com/sharbel0022/Mgeorge/actions/runs/41504647226) | Node: 1082 tester, 1 fel. Sites: 1974 tester, 10 fel. Tio av felen reproducerade de granskade luckorna/kompatibilitetsproblemen; ett nytt cachetest utlöste en befintlig regel för flera betalningskandidater. Det syntetiska andra fallet fick därför en annan betalare och ett annat belopp för att isolera kontocachen. Produktionsregeln ändrades inte. |
| Slutlig Node-svit | `2375efc8c3491c9afda156ed1a12e64541b927ca`, [41505400686](https://github.com/sharbel0022/Mgeorge/actions/runs/41505400686) | **1082/1082 passerar**, 0 fel, 0 överhoppade |
| Slutlig Sites-svit | `2375efc8c3491c9afda156ed1a12e64541b927ca`, [41505400686](https://github.com/sharbel0022/Mgeorge/actions/runs/41505400686) | **1974/1974 passerar**, 0 fel, 0 överhoppade |
| Syntax, typkontroll, audit och produktionsbygge | [41505400686](https://github.com/sharbel0022/Mgeorge/actions/runs/41505400686) | Samtliga obligatoriska steg passerar, inklusive kontroll av installerad minimatch-mitigering och Sites-produktionsbygge. Båda produktionsauditerna rapporterar 0 sårbarheter. |

Totalt tillkommer **82 testfall**: 20 i Node och 62 i Sites. Nya regressioner täcker borttagna, omfördelade, duplicerade, otypade och nästan lika kontoalias; alla aktuella identifierarfält; flera valutor; två alias på samma primärkonto; återställd relation; saknad rapportidentifierare; båda samtidighetsfönstren; parallell avstämning och återimport; historisk delbetalning; sekvensutfyllnad, år, bankgiro och ändrade rapportfält; äldre länkar; skadat orelaterat original; exakt referenstext; avsändarcelltyp; faktisk löpnummercell och strikt bakåtkompatibel proveniens.

Den oberoende granskningen resulterade även i rättningar av en separat manuell kontospärr och två kompatibilitetsproblem. Ingen finansiell testgrind har försvagats eller tagits bort. Inga dependencies, arbetsflöden, databasscheman eller Sites-projektidentiteter har ändrats.

## 7. Integration, kvarstående begränsning och fortsättningspunkt

- Ändringarna ligger på egen branch för granskning. Ingen direkt push till main har gjorts.
- Main kontrolleras igen inför integration; andra uppdrags commits får inte skrivas över. Slutlig PR-status och kontroller finns i PR:n.
- Sites publiceras först efter samordnad integration i det befintliga projektet och godkänd gemensam verifiering.
- Aktuell kod och tester stärker interna kontroller. Produktionsberoende bankbevis, fakturaattest och kundrelation har inte fått högre kvalitetsbetyg genom syntetiska tester.
- Denna uppdragsrapport innehåller den avgränsade framstegsredovisningen. Gemensamma framstegs-/poängfiler har inte skrivits om under de sex parallella uppdragen.
- Nästa verksamhetssteg är att inhämta bankunderlaget i avsnitt 5 och separat godkännande. Ingen verklig faktura ska skapas eller markeras betald enbart därför att denna PR blir grön.

## Officiella källor och tidigare kontrollrapport

- [Bankgiroinbetalningar – teknisk manual](https://www.bankgirot.se/globalassets/dokument/tekniska-manualer/bankgiroinbetalningar_tekniskmanual_sv.pdf): insättningslöpnummer, bankgiro-/årsomfattning och åtskillnad mellan insättning och individuell betalning.
- [ELIN – hjälp och Excel-export](https://www.insup.bgonline.se/elinweb/help-sv.pdf): exportstruktur, sökning, detaljer och sidindelning.
- [Swedbank – femsiffriga clearingnummer som börjar på 8](https://www.swedbank.se/privat/betala-och-overfora/konton/clearingnummer/5-siffriga-clearingnummer-som-borjar-pa-siffran-8.html): format kan bero på avsändande bank/system. Generella formatregler används inte som bevis för det aktuella kontots relation.
- [Tidigare sanerad original-/betalningskontroll](REAL-PAYMENT-0599-FINAL-REPORT.md): historiska originalkontroller och externa begränsningar. De ersätter inte de tidsatta aktuella kontrollerna ovan.
