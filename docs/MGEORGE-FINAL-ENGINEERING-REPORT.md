# MGEORGE – final engineering

**Senaste fortsättning, 2026-11-02:** granskad kod på main `cc2be7b`, exakt [Actions41491162166](https://github.com/sharbel0022/Mgeorge/actions/runs/41491162166) med2881pass/0fail/skip och **Sites55 succeeded**. Skrivfri efterkontroll visar revision42→42 och oförändrad jämförd ekonomi/original/konfiguration. [Aktuell fortsättningsrapport](ORIGINAL-REFERENCE-INTEGRITY-REPORT.md), [aktuellt kvitto](ORIGINAL-REFERENCE-INTEGRITY-DELIVERY.json) och [alla33bedömningar](../QUALITY-SCORECARD.md). Allt nedan är första leveranscykelns daterade bevis; dess Sites54/main2410e4b ersätts inte retroaktivt. Samlat mål är fortfarande delvis uppfyllt,255/330 och0/33på9,5.

Datum: 2026-11-02. Start `087e5ced733b2cfdb3f8540d006118fb26cb6107`, Sites 53, runtime 9. Denna rapport innehåller sanerade slutsatser och syntetiska mätningar. Verkliga original, kontrollsummor, konto-/kundidentifierare och nycklar bevaras privat utanför Git.

**DELVIS LEVERERAD – TEKNISKT ARBETE ÅTERSTÅR.** De reproducerade rättningarna i denna cykel är granskade, testade, levererade till main och publicerade som Sites54. Målet9,5 i alla33områden är inte uppnått. Verkliga bank-/verksamhetsbevis, full katastrofåterställning, representativ utvärdering och utvecklingsberoendefynd kvarstår. [Exakt maskinläsbart leveranskvitto](MGEORGE-FINAL-ENGINEERING-DELIVERY.json).

## Reproducerade fel och rättningar

| Fel | Grundorsak och rättning | Regressionsbevis |
| --- | --- | --- |
| P1: sparat uppladdningsoriginal kunde raderas | D1 INSERT kan committa trots att svaret förloras. `/api/files` raderade då R2-objektet. Ägarbunden efterläsning måste nu bekräfta frånvaro före städning; okänt utfall bevarar bytes. | Tre RED-fel i sex nya multipart/SQLite/routefall. GREEN omfattar commit-/precommitfel, efterläsningsfel, retry, ägargräns och byteidentisk nedladdning. |
| P1: Windows restore avvisade sin egen fil | `lstat.dev` och `fstat.dev` använder olika representation på aktuell Windows/Node. Windows jämför nu två deskriptorers bigint dev+ino samt pathname före/efter öppning. Linuxgrenen är oförändrad. | Native krypterad SQLite-backup, misslyckad flush/städning och utbytt pathname var RED. Riktad Linux 55/55 inklusive symlänkar; Windows 48/56 med åtta verkliga EPERM-fall uttryckligen överhoppade. Junction-/WAL-/bytefallen körs. |
| P1: tvetydiga fakturadatum blev gröna | Parsern godtog ett giltigt datumprefix före extra datum eller okänt innehåll. Båda motorerna granskar nu hela märkta värdet och bibehåller den tidigare fullständiga etikettcensusen. | Direkt parsning och faktisk syntetisk PDF-autoregistrering: initialt 28 RED per motor. Oberoende censusfynd gav ytterligare RED och rättning; slutlig riktad Node 338/338, Sites 315/315. |
| P2: längre metadata-ID klipptes till ett giltigt prefix | Explicit fakturanummer i filnamn/mejlrubrik begränsades till 80 tecken innan jämförelse. Hela token jämförs nu i båda apparna. | 82-teckens konflikt kontra 80-teckens original hålls; lika identifierare och ledande nollor bevaras. |
| P1: redan attesterad betalare kunde flyttas till annan organisation | Sites tillät ändrat organisationsnummer bakom en aktiv fakturaallokering och lärde relation från den ändrade identiteten. Samma skrivgräns som skyddar bokade kärnfält skyddar nu organisationsidentiteten. | Verklig domän/avstämning med syntetiska AIS-kvitton: felaktig ny kundrelation stoppas. Node bedömd separat och har redan fryst organisationssnapshot; två SQLite-regressioner tillagda. |
| P2: känd evidensbrist doldes efter bokning | Faktura-, bank- och ekonomiprojektioner ignorerade aktuell kontospärr/händelsetyp. En gemensam bedömning följer ursprungskedjan och samtliga aktiva allokeringseffekter. | RED tio fall; kontofel, återföring och felaktig refund hålls. Korrekt explicit refund fungerar. Oberoende blandad-allokeringsprobe är ordningsoberoende efter rättning. Bokade saldon/original bevaras. |
| P2: dialog tappade fokus efter breddbyte | Desktopknappen fanns kvar i DOM men doldes på mobil. Efter Escape gick fokus till BODY. Dialogen kontrollerar nu synlighet och faktiskt återställt fokus; annars används befintligt `main-content`. | Fyra av sex RED-fall; GREEN 6/6 och 72 närliggande fall. Faktisk Chromium 1440→390→Escape ger MAIN/main-content; vanlig mobilstängning återfokuserar betalningskortet. |

Oberoende granskningar har lett till rättningsrundor för datumcensus och blandade allokeringseffekter. Grön självgranskning används inte som ersättning för dessa kontroller. Inga testkrav togs bort för att maskera produktfel; Windows filsymlänkar särredovisas och motsvarande verkliga Linuxfall körs.

## Befintliga motorer och verklig dataväg

Den tidigare [arkitekturkartan](PAYMENT-VERIFICATION-ARCHITECTURE.md) gäller fortsatt. Node använder `bank.js`/importers → bevarat original och kvitto i SQLite → aktuell ägd kontokonfiguration → `reconciliation.js`/`db.js` under skrivlås → allokering/saldo/audit. Sites använder banking-adaptrar/store → bevarat AIS/R2-original → bankgiro-service och original-/kontoevidens → reconciliation-evidence med revisions-CAS och atomisk medgivandefence → befintligt workspace/allokering/audit.

Gmail/native PDF/OCR går via respektive befintlig dokumentkö och fältparser till original-/motpartsgranskning och registreringsgräns. Registreringsförslag och läsande betalningskandidater skapar inga pengar. Bankbetalare, fakturakund, generell referens, formell OCR och manuell attest är separata evidensslag. Ingen parallell betalningsmotor, ny ekonomidatabas eller produktionsmigration införs.

## Samma korpus före och efter

[`measure-final-invoice-fields.mjs`](../scripts/measure-final-invoice-fields.mjs) kör samma 117 syntetiska text-/metadatafall genom båda fakturamotorerna mot baslinje och kandidat. Runner- och korpushash är identiska i [före](measurements/final-engineering-fields-before.json) och [efter](measurements/final-engineering-fields-after.json). Källhashar anger verklig arbetsytekod även före commit.

| Mått, per motor | Före | Efter |
| --- | ---: | ---: |
| Korrekta beslut | 103/117 | 117/117 |
| Korrekta positiva/gröna | 47/47 | 47/47 |
| Felaktigt gröna negativa | 14 | 0 |
| Korrekt hållna negativa | 56/70 | 70/70 |
| Precision bland gröna i korpusen | 77,05 % | 100 % |
| Recall för deklarerade positiva | 100 % | 100 % |
| Andel gröna av samtliga fall | 52,14 % | 40,17 % |

Detta är en avsiktligt avgränsad regressionskorpus. Minskad grön andel kommer från stoppad falsk säkerhet. Siffrorna är inte precision/recall för alla verkliga PDF:er, fotograferade underlag eller produktions-OCR. Inga nya universella OCR-, prestanda- eller volymgarantier ges. Verklig privat native-PDF och arbetsbok kontrolleras separat nedan.

## Verkligt betalningsfall – 23 skrivfria kontroller

Färsk exakt AIS-läsning är komplett, arbetsyterevision 42. Ägt rapportoriginal är intakt och komplett som strukturell enradskontroll. Den separata registerkontrollen för målreferensen är komplett utan träff. Referenssökningens övergripande `complete=false` är inte ett fullständigt referensbevis. Inget nytt bank-/Gmail-synk- eller kontodetaljanrop har gjorts.

| Nr / kontroll | Källa, regel och faktiskt bevis | Felorsak / nästa åtgärd | Allokeringsrätt här |
| --- | --- | --- | --- |
| 1. Banktransaktionens identitet | Ägt sparat AIS-original, exakt extern identitet och kvitto passerar. | Rapportrelation bedöms separat. | Nej |
| 2. Aktuellt medgivande | Ägarbunden sparad produktionsstatus är connected; aktuell kontogrind används i förhandskontrollen. | Bankens separata detaljväntetid är okänd. | Nej |
| 3. Valt ägt konto | AIS-kontot godtas i aktuellt sparat medgivande. | Rapportens kontorelation är inte styrkt. | Nej |
| 4. Originalkvitto/version | Befintlig versionsbunden AIS-kvittoprofil och omtolkning passerar. | Inga historiska kvitton skapas i efterhand. | Nej |
| 5. Rapportintegritet | Ägd R2-fil och privat kopia har samma storlek/SHA; originalbytes oförändrade. | Hash ensam bevisar inte bankautenticitet. | Nej |
| 6. Mottagarens Bankgiro | Uttrycklig originalcell läst och kontrollerad. | Konto-/Bankgirorelation behöver bankbevis. | Nej |
| 7. Bankgirots mottagarkonto | Originalets kontotext bevarad. | Bankutfärdad relation till valt AIS-konto saknas. | Nej |
| 8. Kontoalias | Senaste kompletta historiska kontoläsning saknade alias; senare detaljförsök rate-limit. | **Bankstyrkt kontoalias saknas – extern verifiering krävs.** | Nej |
| 9. Rapportfullständighet | Parserns deklarerade antal och kompletta strukturella detaljgrupp passerar. | Ingen signatur-/kanalgaranti från filstrukturen. | Nej |
| 10. Individuella rader | En detaljrad, ursprungliga betalar-/referensceller och råproveniens finns. | Relationen till AIS-insättningen återstår. | Nej |
| 11. Rapporttotal | Antal, total och detaljsumma stämmer i heltalsören. | Summalikhet ersätter inte bankidentitet. | Nej |
| 12. Gemensam insättningsidentitet | Kandidat på datum/belopp, ingen gemensam stabil bankidentitet eller beslutad originalrelation. | Bankutfärdat underlag som binder just rapport och insättning. | Nej |
| 13. Verklig betalare | Namn från individuell rapport, AIS lämnar ingen individuell betalare. | Rapportnamnet får inte automatiskt bli AIS-betalare. | Nej |
| 14. Referens/OCR | Exakt `0599` med inledande nolla; generell strukturerad betalningsreferens. | Formellt OCR-avtal/checksumma är inte styrkt. | Nej |
| 15. Fakturaoriginal | Ägt R2-original matchar privat PDF; nio visuellt/maskinellt kontrollerade fält per motor passerar. | Native PDF är gul/granskningspliktig; ingen registrering. | Nej |
| 16. Fakturaregister | Aktuell fullständig målregistersökning har noll träffar. | Privat förberett ej insänt förslag; separat registreringsgodkännande krävs. | Nej |
| 17. Kund-/tredjepartsrelation | Originalets juridiska identitet finns; ingen färdig registerattest skapas. | Separat behörig original-/kundgranskning. | Nej |
| 18. Valuta/datum | AIS anger bokförd SEK-händelse; rapportdatum/belopp kan passa. | Rapportens SEK är profilantagande; uttrycklig valuta och relevanta datum måste styrkas. | Nej |
| 19. Tidigare allokeringar | Noll aktiva kopplingar på de relevanta observationerna. | Inga riktiga kopplingar tillförs som test. | Nej |
| 20. Dubblettkontroll | Två observationer, AIS ekonomiskt räknad en gång och rapport noll gånger. | Avgränsad kontroll, ingen oberoende full ledgerexport. | Nej |
| 21. Matchningsbeslut | Befintlig skrivfri förhandskontroll anger blockerad och automaticEligible=false. | Åtgärda externa bevis; nytt förslag före beslut. | Nej |
| 22. Fakturasaldo | Registerpost saknas; inget verkligt registersaldo kan räknas. | Visa inte påhittat nollsaldo eller betaldstatus. | Nej |
| 23. Revisionshistorik | Befintliga kopplingar bevaras, läsverktygen anger changed=false. | Ingen fullständig separat audithistorikexport påstås; ekonomiska beslut måste revideras separat. | Nej |

Privat kontroll efter parserfrysning: 12/12 workbookkontroller och 9/9 fakturafält i vardera verklig motor passerar; PDF har gul nivå och noll parserissues. Originalens bytes, ägarskap/hash och storlek stämmer. Ingen kundidentitet, verklig originalhash eller kontouppgift läggs i Git. Inga verkliga fakturor, saldon, originalrelationer eller allokeringar har ändrats.

## Gmail, bank, backup och drift

Gmail är anslutet; timschemat är uttryckligen pausat och senaste lyckade hämtning är 2026-10-29. Ett konfigurerat schema, lokal arbetarheartbeat och ansluten OAuth är olika bevis; de styrker inte aktuell schemalagd hämtning eller slutfört moln-OCR-jobb. Läsningen visar 183 dokument som behöver granskning, med betydande saknade fält/obekräftad motpart. Den avsiktliga pausen bevaras; inga kundmejl skickas.

Bankens ordinarie hämtning lyckades 2026-11-02 14:07Z och nästa ordinarie tid anges 20:06Z. Detta är inte kontodetalj-API:ts Retry-After. Den gamla detaljdeadlinen är okänd; inga fler sådana bankanrop eller nya kontoautomatiseringar görs.

Backupstatus anger verifierat manifestpass 195/195 filer och kontroll av elva kvittoförsedda API-original; 112 äldre API-poster saknar kvitto i den redovisade omfattningen. Fullständig katastrofåterställning av faktisk produktionsbackup, separat katastrofkopia och tillgång till betrodda återställningsnycklar är inte verifierade. Inga produktionsåterställningar utförs.

## Webbläsare och mätgräns

Lokal Chromium med fiktiv minnesdemo: översikt vid320/390/768/1024/1440px utan dokumentoverflow, mobilmeny/navigation, exakt fakturasökning, specifikationsfilter, betalningsdialog, fel-/tomläge och Escape/fokus. Syntetisk XLSX gick via riktig filväljare till preview och uttrycklig bekräftelse endast i minnesdemot; den visades som spärrat granskningsunderlag, exakt referens med ledande nollor och inga nya pengar. [Observationer](measurements/final-engineering-browser.json). Lokal D1 är en separat syntetisk instans; inget produktionsschema tillämpades. Publicerad Sites54-startsida/inloggningsgräns är observerad. Produktionsinloggad ekonomiresa, fysisk mobil och hela verkliga dokument-/betalningskedjan är separata kvarstående acceptansprov.

## GitHub och arkiv

Efter uttryckligt nytt användargodkännande för de fem exakta branchnamnen kontrollerades huvuden igen. En atomisk radering med förväntade SHA-villkor tog bort dem utan att mutera main eller force-pusha någon commit. Ny fjärrlista innehåller **endast main**. PR #9 och #10 är därefter verifierat closed/unmerged; de stängdes av GitHub när huvudbrancherna raderades.

Komplett privat Gitbundle har återställts som fristående mirror och passerat strict fsck. Alla 17 vanliga lokala-/fjärrreferenser och deras träd stämmer med arkivet. Arkivet innehåller även Codex kontrollreferenser; dessa räknas inte som utvecklingsbrancher. Tre unika PR-commits är bevarade, och den valfria runnern integreras inte automatiskt. Arkiv, manifest och återställningsväg finns privat utanför Git. Den befintliga andra arbetskatalogen har inte ändrats.

## Kvalitet, leverans och fortsättning

Alla 33 före-/efterbedömningar med fynd, test-/produktionsgräns, risk och nästa åtgärd finns i den översta fullständiga tabellen i [QUALITY-SCORECARD](../QUALITY-SCORECARD.md). Dokumentära områdespoäng behålls: **255/330 = 7,73/10, 0/33 på 9,5**. Förbättrade kontrollregler eller en lyckad deploy är inte slutlig verksamhetsacceptans.

Root/Sites paket och lockfiler är oförändrade. Rootaudit och Sites produktionsaudit har noll sårbarheter; full Sitesaudit behåller 16 moderate utvecklingsfynd och high-grinden passerar. Brytande godtyckliga verktygsnedgraderingar är inte en verifierad säkerhetsfix. Ingen full prestanda-/samtidighets-SLA eller representativ generell OCRprecision har fastställts.

En färsk [kompatibilitetsundersökning](DEPENDENCY-COMPATIBILITY-FOLLOWUP.md) verifierar den konkreta gränsen: global minimatch11override gav fyra verkliga lintregelkrascher och ett ESM-importfel. Publicerade beroende-/peerintervall ger ännu ingen stödd helkedja, och nuvarandeESLint9 har passerat sin supportperiod. Detta är öppna tekniska/uppströmsberoende krav, inte en åtgärdad audit genom borttagna kontroller. En separat fullt verifierad verktygsmigrering/fork kan behövas om uppströms inte levererar kompatibla versioner.

## Verifierad leverans

| Del | Faktiskt bevis |
| --- | --- |
| Main-kandidat och normal push | `2410e4b667fe3180c7119607e8fb602257ccdd01`, sex små commits från start087e5ce; ingen commit-forcepush. |
| Kodträdet | Hela leveransträdet `0b0df9e9e11f33e8da8651435459a700f7c53c46`; Sites-delträdet `f539428088e93afaed113e40b605cda768c1537d`. |
| Exakt Actions | [41480737514](https://github.com/sharbel0022/Mgeorge/actions/runs/41480737514), båda jobb success på2410e4b: Linux Node991/991, Sites1609/1609,0fail/skip, rena installationer, syntax101, TS/audits/bygge. |
| Lokala slutgrindar | Windows Node992:984pass/0fail/8filsymlänk-EPERMskip; Sites1609/1609, syntax101, TS och produktionsbygge passerar. Separat full Linux22.23.4-körning passerar991/991,0skip i isolerad read-only container med befintliga systemfonter monterade read-only. |
| Tidiga miljöprober | Den extra Alpinekontrollen krävde en exekverbar egen temporär testmount och tillgängliga fonter. Tidiga noexec/native-binding- respektive fontlösa OCRfel redovisas som miljöprober; inga tester eller produktregler försvagades. Slutlig full körning och obligatorisk exakt CI är båda gröna. Container och temporära testtillstånd är avslutade. |
| Sites-källa | `26b380015cae63bbfc44c1f7dce7720220c6efbd`, exakt samma Sites-träd som verifierad main. Separat ren installation, TS, bygge och officiell packning passerade i publiceringscheckouten. |
| Publicerad version | Sites54, version-ID `appgprj_6adf2f7f7e848191b64192161886b528~appgver_b77c2fe955e88191bb5cbbca09031aaa`. |
| Deployment | `appgdep_6ae8b9b37f8c8191a456248720d30271`, succeeded2026-11-02T16:26:54.424558Z, runtime9. [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/). |
| Artefakt |347 byggfiler,0QA-referenser. Lokalt gziparkiv, dekomprimerat lokalt tar och Sites lagrade tar har olika storlek/hash och redovisas separat i kvittot. Matchande källträd, filantal och backendens publiceringskvitto är verifierade; separat filbytesparitet mot en nedladdad server-tar påstås inte. |
| Efterkontroll | Revision42→42 och exakt oförändrad jämförd ekonomisk projektion, målregister komplett/0träffar,0allokeringar, AIS ekonomiskt1/rapport0. Rapporthash och ägt fakturaoriginal oförändrade; privat Node/Sites-originalkontroll12bankfil-/9PDFfält per motor passerar. |
| Bevarad produktion | Authklient/policy, runtimeposternas redovisade metadata/värden och revision9, alla tre scheman, D1översikt26tabeller, R2/DB-deklarationer och migrationskällor oförändrade. Hemligheters dolda värden exponeras inte. Backup195verifierade manifestfiler. |
| Återgång | Sparad Sites53 och normala Git-revertcommits, ingen destruktiv ekonomisk databasrollback. |

Efterkontrollen gjordes med de befintliga ägarbundna skrivfria verktygen. Den bekräftar jämförda fält/original och konfiguration, inte en oberoende fullständig export av hela ekonomiregistret eller en ny verksamhetsallokering. Ingen riktig faktura, betalning, manuell originalrelation, kundattest, schema eller runtimehemlighet skrevs av leveransen.

Efterföljande dokumentationskvitto uppdaterar denna rapport/PROGRESS/scorecard utan ändrad produktkod eller nytt Sites-träd; dess aktuella main-SHA verifieras separat vid push. Därför avser2410e4b den exakt verifierade kodleveransen och inte ett löfte att inga senare dokumentationscommits finns.

Fortsättningspunkt: utgå från denna verifierade kodleverans2410e4b, exakt Actions41480737514 och Sites54 med ovanstående källa/träd. Hämta aktuellmain och bedöm senare dokumentationsskillnader innan testbevis återanvänds. Bankutfärdat kontoalias/Bankgirokonto och rapport-/insättningsidentitet, explicit valuta/datum och separat konkret fakturaregistrerings-/kund-/allokeringsbeslut krävs före verklig avstämning. Fortsätt med kompatibel beroendekedja, ägarinloggad UIacceptans, relevant godkänt Gmail-schema med faktisk lyckad hämtning, representativ OCR-/volymutvärdering och isolerat verkligt katastrofprov. Fullt slutgodkännande/alla33≥9,5 påstås inte; ingen ny obemannad automation har skapats.
