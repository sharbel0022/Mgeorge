# Cykel 4 – navigation, ärliga tillstånd, mobilfokus och fakturaparsning

**Den frysta kandidaten klarar 519/519 Node + 831/831 Sites = 1 350 tester. Den är ännu inte pushad eller publicerad.** Bedömningen är registrerad **2026-10-30T20:31:30+00:00** och gäller exakt28 käll-/testfiler ovanpå main `6660bd712ba523b0cdbcb619e30c3bf43d9bc9b9`. Fulla hashvärden, grindar, browserbevis och samtliga33 områdesbedömningar finns i [QUALITY-8H-CYCLE4.json](QUALITY-8H-CYCLE4.json).

Senaste faktiskt levererade version är **Sites35**, main `6660bd712ba523b0cdbcb619e30c3bf43d9bc9b9`, [Actions41102309328 success](https://github.com/sharbel0022/Mgeorge/actions/runs/41102309328). [Publiceringsrapporten](QUALITY-8H-SITES-CYCLE3-PUBLICATION.md) skiljer exakt GitHub-kod, Sites-källa, komprimerat lokalt arkiv och serverns TAR. Cykel4s nya main-SHA, CI och eventuell nästa Sites-version fylls endast i av samordnaren efter verifierade kvitton.

## Vad kandidaten rättar

### Navigation, historik och användararbete

En gemensam allowlist för12 vyer används av serverns startsida och browserhistoriken. Översikten använder `/`, andra vyer `/?view=<tillåten vy>`. Den avsedda bankimportlänken med `view=bank&import=1` bevaras. Kundnamn, faktura-/dokument-ID, sökningar och utkast hamnar inte i URL eller persistent browserlagring.

Huvud- och undernavigation är riktiga länkar med tydlig `aria-current`. Modifierade klick, mittenklick och externa mål behåller normalt länkbeteende. Vanlig navigation, Back, Forward och omladdning återställer rätt vy. Sök/filter sparas per vy i RAM; samma-vy-länkar avmonterar inte ett öppet ärende. Navigation kör inga finansiella kommandon. Sena lässvar kan inte skriva över en senare godkänd sparning eller nyligen redigerade inställningsfält.

Ändrade formulär har en avgränsad utkastkontroll. Sök/filter och oförändrade fält orsakar inte varningar. Öppna dialogutkast behåller instans och fokus genom vanlig vyhistorik; godkänd sparning kvitterar de faktiskt skickade fälten. Detta löser **inte** det separat reproducerade401-fallet som ännu kan radera ett modalutkast. Den rättningen är en annan kandidat på review.

HTTP-preview kraschade faktiskt under hydrering när `crypto.randomUUID` saknades. Navigation och domänens UUID använder nu en gemensam kryptografisk hjälpare med `getRandomValues`-fallback och korrekta UUIDv4-bitar. Ingen `Math.random`-/tidsstämpelfallback införs. Regressionen anropar verkliga `createWorkspaceHistory`; den återgav TypeError före rättningen.

### Synligt fokus och läsbar svartvit presentation

Mobilens inline-granskning flyttar fokus till en synlig märkt detaljregion när CSS döljer listan. Tillbaka återför fokus till ursprungsraden eller en synlig reserv om ärendet försvunnit. Desktop behåller radfokus. Borttagna fält, viewportbyte och avmontering täcks; öppna dialoger och externa fokuserade element behåller fokus. Ingen åtgärd startas automatiskt av render/resize.

Tre svaga textfärger är rättade inom den svartvita paletten. De berörda kombinationerna gick från cirka3,664–3,970:1 till5,090–5,742:1; testerna räknar på faktisk CSS och kräver4,5:1 för normal text. Detta är avgränsade kontrastfall, inte en full tillgänglighetscertifiering.

### Bevisetiketter och okända data

Transaktionsoriginal och kundmeddelandens granskningsunderlag skiljer bankens ursprungsuppgifter, manuell registrering/komplettering och overifierad historik. Senare manuell bekräftelse gör inte ett tidigare original till bankbevis. OCR, fakturareferens och generell referens har egna etiketter; ledande nollor och originalets egna värden bevaras. Matchnings-, saldo- och sändningsregler ändras inte av denna presentationsrättning.

Gmail och de tre listvyerna Bank/Kundfakturor/Leverantörsfakturor skiljer väntande, lyckat, misslyckat och utloggat tillstånd. Saknade data visas inte som0kr, tom laddad tabell eller utfört arbete. Verkligt laddad noll finns kvar som positiv kontroll. Efter misslyckad uppdatering döljs gamla finansiella listvärden utan att underliggande state/utkast raderas bara för att GET misslyckades. CSV är spärrad när listdata är otillgänglig. Retry hämtar status läsande.

### Fakturaparsning i båda motorerna

Den syntetiska korpusen reproducerade felaktiga fakturaidentiteter från närliggande rubriker och ett VAT-procenttal som blev ett penningbelopp. Två PDF:er kunde ha identiska renderade pixlar men motsatt ritordning och därmed olika extraherad textordning. Kandidaten gissar därför inte faktura-/OCR-roller från den ordningen: kända rubrikserier, även med skiljetecken, hålls med null-identiteter och utan registrering. Oberoende review hittade och fick rättat även slash/pipe/semikolon-varianter.

Hela identifieraren valideras utan tyst trunkering. Motstridiga eller oläsbara märkta förekomster kan inte döljas av en senare giltig förekomst. VAT med procenttecken behandlas inte som kronor. Explicit märkta svenska datum som24-10-2026 normaliseras före kalenderkontroll. Giltiga identifierare, ledande nollor och tillåtna slash/dash-varianter bevaras exakt.

Varje motor har50 permanenta korpusfall. Riktiga syntetiska PDF:er går genom extraktion och faktisk lokal registrering med verifierad syntetisk motpart; originalbytes/hash bevaras och andra kopian blir dubblett. Ett Node-fall kör faktisk offline-Tesseract på en genererad bild och behåller låg säkerhet som granskningsbehov. Ingen slutsats om de183 verkliga granskningsdokumenten dras från denna syntetiska korpus. Okända layouter, månadsnamn och procent-plus-belopp kvarstår som begränsningar.

## Exakta slutgrindar och oberoende granskning

| Grind | Resultat |
| --- | ---: |
| Frysta käll-/testfiler på main6660 | **28**, hashjämförelse28/28 |
| Node, full svit | **519/519** |
| Sites, full svit | **831/831** |
| Total / fel / överhoppade / avbrutna | **1350 / 0 / 0 / 0** |
| JavaScript-syntax | **70 filer godkända** |
| Sites TypeScript | **Godkänd, exit0** |
| Produktionsbygge | **Build complete, exit0** |
| Full Node-audit, samtliga klasser | **0** |
| Full Sites-audit, inklusive utvecklingsberoenden, samtliga klasser | **0** |

Grindarna kördes30oktober19:30:43–19:31:27UTC på den isolerade integrerade kandidaten. Manifestet och grind-JSON finns återgivna i cykel4-JSON. Individuella handoffs/reviews av UI, navigation, UUID, fokus, laddning och parser är avgränsade delbevis. Den slutliga hashfrysningen registrerar dem som granskade; den registrerar också det kvarvarande auth-utkastfelet. Ett grönt testantal stänger inte ett senare reproducerat fel utanför den rättade omfattningen.

Rött/grönt är dokumenterat separat: fokus3pass/6fail blev9/9; UUID4pass/1TypeError blev5/5; Dashboard hade17 initiala verkliga fel och två senare racefel före rättning; UI gav faktiska etikett-/noll-/kontrastfel. Parserns oförändrade oberoende ritordnings- och separatorprov klarar nu båda verkliga registreringskedjorna. Tidiga delsviter summeras inte en gång till utöver1350.

## Faktisk lokal Chromium – och vad som inte är verifierat

Alla observationer nedan gäller syntetisk lokal data. Navigationens observation är18:01UTC; mobilkontrollerna18:17/18:23UTC.

| Kontroll | Observerat utfall |
| --- | --- |
| HTTP-hydrering | Fungerar utan `crypto.randomUUID` när kryptografiska random bytes finns. |
| Vy-URL, Back, Forward, reload | Rätt tillåten vy återkommer; huvudfokus följer navigationen. |
| Sök/filter | `1003` och delbetalningsfilter behålls efter Back. |
| Dirty Settings | Länk/Back visar bekräftelse; avbryt behåller text. Två snabba native Back gav en synlig bekräftelse och avbryt återställde samma vy/text. |
| Modal genom Back | Text/fokus bevarades; stängning fokuserade main. Detta prövar inte401. |
| Mobil390px | Tangentbord öppnar Samlingsbetalning till märkt region; Tillbaka återgår till samma rad. Klient-/scrollbredd375/375. |
| Desktop1440px → mobil320px | Desktop behåller fakturaraden; minskning ger synlig detalj. Bredd1425/1425 respektive305/305. |
| Mobilmeny320px | Shift+Tab/Tab omsluter synliga kontroller; Escape återför fokus till öppnaren. |
| Slutliga28-filerskandidatens utloggade listor | Bank, kund- och leverantörsfakturor visar inloggning; inga0kr/tomma laddade tabeller; CSV inaktiverad. |

Den sista listobservationen rapporterades av samordnaren den30oktober och registreras **2026-10-30T20:31:30+00:00**; exakt exekveringstid är inte sparad. Dashboard-hash: `a18df4da045af9b9346da223ee5a468856f405a9013379aa503d7a015fefac5a`. Mobilens filterremsa får avsiktligt scrolla horisontellt; hela dokumentet hade inte horisontell overflow. Iframe-viewport bevisar inte fysisk touch eller alla webbläsare.

**Native beforeunload är fortfarande overifierad i miljön.** Appens reload/råa länk gav ingen synlig varning, men en fristående standard-HTML-sida med native input och ovillkorlig korrekt beforeunload-handler gav inte heller någon. Detta är inte klassat som ett bekräftat appfel. Unit-handler är testad; den hanterade navigationens vanliga confirm är faktiskt observerad.

**Autentiserad produktionsbrowser efter Site35 saknas** eftersom originating browser context inte var tillgänglig. Senaste verifierade produktionsbrowser är version34. Lokal Chromium ersätter inte den kontrollen.

## Kvarstående interna fel och externa krav

- **Important –401 förstör modalutkast:** GET401 och control authorization loss kan avmontera InvoiceEditor. En separat isolerad kandidat är på oberoende review. Den ingår inte i28 filer,1350 tester eller denna poänghöjning.
- **Important –backup kan bli falskt complete:** verifiera fem av sex kopior, radera en tidigare verifierad kopia och verifiera den sista. Main6660 kunde rapportera complete/6 trots bara fem återställbara kopior. Separat backupfix är på review och ingår inte i cykel4. Område29 och31 sänks därför.
- **B1–B6 kvarstår:** autentisk bankrapport/profil/kanal; aktuell autentiserad produktionskedja; pausat Gmail-schema; bevisad moln-OCR; representativ godkänd fakturakorpus; isolerat produktionsrestore med oberoende kopia/nycklar och mätta RPO/RTO. De exakta kraven finns i JSON och scorecard.
- Produktionsbackupens observerade complete är det äldre statusfältet:191 kopierade, `copy_readback`, `verified_files:0`, API-scope `unassessed`. Ingen ny full manifestkontroll eller produktionsrestore utförd. Bank/Gmail-tiderna i Site35-kvittot är läsande observationer, inga nya slutförda verksamhetsflöden.

## Konservativ poängändring

Utgångspunkt: **250/330**. De åtta höjda områdena ger **+4,5**, medan två backupsänkningar ger **−1,0**. Exakt nytt resultat är **253,5/330 = 7,68/10**, nettot **+3,5**. Planeringsuppskattningen254 stämmer inte med de uttryckliga delpoängsändringarna och används inte. Alla andra delpoäng är oförändrade. **0/33** når9,5; samtliga33 återstår.

| Område | Ändrad delpoäng | Områdespoäng |
| --- | --- | --- |
| 1. Design och färger | S: 1 → 1,5 | 7,5 → 8 |
| 3. Navigering | F: 1,5 → 2, K: 1,5 → 2 | 7,5 → 8,5 |
| 4. Mobilanpassning | S: 1,5 → 2 | 8 → 8,5 |
| 5. Sökning och filtrering | K: 1,5 → 2 | 7 → 7,5 |
| 11. Gmail-anslutning | U: 1 → 1,5 | 7 → 7,5 |
| 18. Identifiera verklig betalare | S: 1,5 → 2 | 6 → 6,5 |
| 19. Verklig OCR/fakturareferens | S: 1,5 → 2 | 6 → 6,5 |
| 27. Automatiska mejlutkast | S: 1,5 → 2 | 7,5 → 8 |
| 29. Säkerhetskopiering | S: 1,5 → 1 | 8 → 7,5 |
| 31. Katastrofåterställning | S: 1,5 → 1 | 6 → 5,5 |

Produktionsdelpoäng höjs inte automatiskt av publiceringskvittot eller lokala tester. Poängen beskriver verifierad kvalitet inom angiven omfattning, inte en felfrihetsprocent. Kända blockerare får inte döljas av medelvärdet.

## Delta för alla33 områden

Varje rad innehåller föregående och ny poäng, faktisk förbättring/observation, test- och produktionsbevis, kvarstående brist och konkret nästa åtgärd. De fulla fem delpoängen och evidens-ID finns i JSON. Samma senaste deltatabell finns i [QUALITY-SCORECARD.md](../QUALITY-SCORECARD.md).

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

## Fortsättningspunkt inom samma budget

Uppdraget började15:31:15UTC och slutar senast23:31:15UTC. Det är fortfarande pågående; ingen automatisk bakgrundsfortsättning antas. Samordnaren hanterar normal main-integration, exakt-SHA Actions och därefter separat publicering på samma Sites-projekt. Endast faktiska framtida leveranskvitton får fylla cykel4s tomma leveransfält. Under tiden hålls auth-utkast- och backupkandidaterna isolerade för review och nya integrerade grindar. Gmail-paus, identitet, lagring och skydd bevaras. Ingen riktig kundsändning, bankbetalning eller produktionsåterställning ingår i denna verifiering.
