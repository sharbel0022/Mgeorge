# Skrivfri diagnos och syntetisk RED-plan för känt V2-resultat på c5

## Status och exakt avgränsning

Analysen avser endast produktkällan c5cdd0fe57d300ba40f6572cbbe39c7fce9397e7 och det redan utförda kända utvecklingsprovet. Resultatet är låst i evidenscommit 2ca47860bd1dc587e0fec0a3dfbcedac8477a6fb. Resultatets SHA-256 är 8957731b7f0f1ed9fed6bb53683b65cf352138e4b1f3f7fa0ee8f5980dfa2756. Arkivkvittots SHA-256 är fe9b332ba9de45e77a74eefaabba20087fbff556ac326d8fa52d68b9fbd32bb1.

Detta dokument innehåller diagnos och föreslagna prövningar. Det innehåller ingen produktändring, ingen ny optisk körning, inget V3-material och inget nytt acceptansanspråk. Ett nytt genomförande måste få en egen källbindning; c5-resultatet får inte tillskrivas senare kod.

Miljön blev unavailable innan rapporten kunde skrivas till disk och innan sista geometridiagnosens slutresultat kunde kontrolleras. Ingen analyscommit finns. Den isolerade analysbranchen står på c5. Input-result.json med ovanstående exakta hash och geometry-diagnostics.mjs hade sparats. Att raw-word-index.json och geometry-diagnostics.json verkligen hann bli färdiga är ännu inte bekräftat. Den här rapporten och strukturerad känd evidens är därför bevarade i functions.store; de behöver sparas och hashbindas i analysbranchen när miljön återkommer.

Allt nedan skiljer observerade fakta från hypoteser som ännu kräver ett syntetiskt RED-prov. Jag har inte en komplett verifierad ordlista för samtliga sex saknade namn eller alla 39 saknade fält. Inga saknade ord-ID:n eller slutna regiongränser har fyllts i genom gissning.

## Slutsats

De största återstående bortfallen kommer från ägarskap och begränsad strukturbindning. Tio organisationsnummer finns korrekt som råord, men parsern saknar stöd för att tilldela dem rätt part. Sex namn finns i råtexten utan en uttrycklig leverantörsroll. Dessa två grupper kan inte slås ihop till sexton säkra återvinningsbara fält.

Ett tydligt avgränsat första ägarskapsförslag är ett uttryckligt leverantörsblock där adressrader skiljer namn från organisationsnummer. Fall 03 är den kända observation som motiverar att pröva denna generella mekanism. För oetiketterade huvudgrupper krävs ytterligare rollbevis. Samlokalisering av namn och org, separat mottagare och fakturarubrik stödjer en utställarhypotes men räcker inte automatiskt för att verifiera den.

Andra möjliga förbättringar är snäv valutapunkt-normalisering, bättre typad bindning av tryckta sammanställningsceller, åtskillnad mellan löptext och verkliga fältförekomster samt direkt Bankgiro-bevis från råceller. Alla måste behålla full negativ förekomsttäckning. Ett korrekt värde i en cell får aldrig ersätta en annan ogiltig eller konfliktande förekomst.

## Vad den låsta körningen faktiskt visar

Körningen gjorde 12 workers och 24 parseranrop, utan worker- eller parserfel. Node och Sites ger samma normalutfall: 91/130 för alla 13 fält, 69/100 mandatory och 59/90 image9. FP är noll i alla tre måtten. Inget av de tio normaldokumenten blir grönt; samtliga kräver granskning. Båda stressfallen är icke-gröna. Recallkravet är underkänt. Detta är känd utvecklingsdata, inte blindacceptans.

Alla tolv producerade observationer är giltiga. Alla 24 parserutfall behåller hela DTO:n och ryms under 50 000 tecken. Därmed är varken transportbortfall, för liten completionbudget eller whole-drop vid skrivgränsen en förklaring till dessa bortfall.

Per parser saknas 39 fält: org 10, party 6, VAT 5, currency 4, reference 4, Bankgiro 4, net 3 och total 3.

| Fall | Saknade fält | Serialized extraction, tecken |
|---|---|---:|
| 01 | currency, net, org, party, total, vat | 13279 |
| 02 | org, party, reference, vat | 12553 |
| 03 | org | 12792 |
| 04 | bankgiro, currency, org, party, reference | 12686 |
| 05 | bankgiro, currency, org | 13741 |
| 06 | org, party | 11398 |
| 07 | bankgiro, net, org, party, reference, total, vat | 11541 |
| 08 | bankgiro, org, party | 12474 |
| 09 | org, vat | 13545 |
| 10 | currency, net, org, reference, total, vat | 13929 |

Det är inte visat att samtliga 39 kan återvinnas säkert. Förekomst av siffror eller ett bolagsnamn är inte samma sak som korrekt fältroll, ägare eller tillräcklig ordkonfidens.

## Organisationsnummer: samtliga tio råord

ID-formatet är [page, block, paragraph, line, word]. Boxformatet är [x0, y0, x1, y1] i den bundna sidrastern. Konfidensen är den faktiskt observerade ordkonfidensen, inte en föreslagen ny nivå.

| Fall | Faktiskt råord | Källord-ID | Ordconfidence | Bounding box | Census klassad table |
|---|---|---|---:|---|---|
| 01 | 559762-3114 | [1,1,0,0,1] | 91 | [314,355,591,389] | Inte markerat som table i den lästa sammanställningen |
| 02 | 559762-3122 | [1,12,0,0,1] | 91 | [604,2722,854,2754] | Inte markerat som table i den lästa sammanställningen |
| 03 | 559762-3130 | [1,14,0,1,1] | 87 | [1452,616,1737,653] | Inte markerat som table i den lästa sammanställningen |
| 04 | 559762-3148 | [1,3,0,0,1] | 24 | [336,580,653,615] | Inte markerat som table i den lästa sammanställningen |
| 05 | 559762-3155 | [1,6,0,0,1] | 92 | [730,2722,1044,2757] | Ja |
| 06 | 559762-3163 | [1,2,0,1,1] | 91 | [327,573,611,609] | Inte markerat som table i den lästa sammanställningen |
| 07 | 559762-3171 | [1,8,0,0,1] | 89 | [652,2722,929,2756] | Ja |
| 08 | 559762-3189 | [1,1,0,3,1] | 90 | [426,603,743,638] | Inte markerat som table i den lästa sammanställningen |
| 09 | 559762-3197 | [1,8,0,0,1] | 92 | [604,2722,855,2754] | Ja |
| 10 | 559762-3205 | [1,18,0,0,1] | 91 | [691,2722,976,2759] | Inte markerat som table i den lästa sammanställningen |

Samtliga tio är lexikalt giltiga orgvärden i den lästa råcensusen. Detta är en utsaga om vad OCR-data innehåller, inte en företagsregisterverifiering eller en verifierad fakturautställare.

Fall 01, 04, 06 och 08 har ett oetiketterat namn/adress/org-kluster och en uttrycklig, separat mottagare. Detta stärker kopplingen mellan namnet och numret men lämnar rollen öppen. Jag har ännu inte kontrollerat fullständiga geometriska kantvillkor för hela dessa kluster efter det sista verktygsavbrottet; de ska inte beskrivas som bevisat slutna utställarregioner.

Fall 02 och 07 har oetiketterat namn upptill och org i sidfoten. Det är ett större inferenssteg att koppla dem. Att ett nummer är det enda checksummegiltiga numret får inte bli urvalsregel.

Fall 05, 09 och 10 har en uttryckligt bunden leverantör med namn, men org i en separat sidfot. Sidfotens placering eller en skattefras är inte i sig ett ordbevis på vem numret ägs av. I 05 och 09 är org dessutom efter den första identifierade tabellgränsen och klassas table. Att en sådan klassning hindrar positiv bindning är en ytterligare mekanism; att ta bort tabellskyddet löser inte ägarskapet.

Fall 03 skiljer sig. Leverantörsetiketten är [1,12,0,0,0]. Namnet ligger i [1,13,0,0,0..3], och numret i [1,14,0,1,1]. Adressrader ligger mellan namn och org i samma beskrivna högra adressblock. Nuvarande ägarbindning tillåter bara en mycket snäv distans och ett fullt redovisat mellanrum. Här bör ett syntetiskt prov pröva en uttryckligt rollbunden identitetsregion med adresstext som tillåtet innehåll, utan att vidga alla avstånd eller välja närmaste org.

Orgordet i 04 har faktisk confidence 24. Ett korrekt teckenutfall i den kända mätningen berättigar inte till höjd konfidens. Även om en framtida rollbindning skulle lyckas måste den låga källkonfidensen följa med och fältet förbli tydligt granskningskrävande enligt ett uttryckligt beslutat kontrakt.

## De sex saknade namnen och rollbevisets gräns

| Fall | Observerat namn | Relation till org i den lästa råbilden |
|---|---|---|
| 01 | Exempel Kustteknik AB | Samma visuellt beskrivna namn/adress/org-grupp |
| 02 | Fiktiva Björk Konsult AB | Organisationsnumret ligger i ett frikopplat sidfotsområde |
| 04 | Fiktiva Lönn Kontor AB | Samma visuellt beskrivna namn/adress/org-grupp |
| 06 | Fiktiva Skärvik IT AB | Samma visuellt beskrivna namn/adress/org-grupp |
| 07 | Exempel Fräsverkstan AB | Organisationsnumret ligger i ett frikopplat sidfotsområde |
| 08 | Fiktiva Rönn Frakt AB | Samma visuellt beskrivna namn/adress/org-grupp |

Alla sex har en uttrycklig separat mottagare i det lästa materialet, men saknar en uttrycklig leverantörs-/utställaretikett för det saknade namnet. Exakta namnord-ID:n och namnboxar var inte fullständigt överförda till den beständiga analysen när miljön avbröts. De måste hämtas ur den låsta observationen före en slutlig regionspecifikation. Jag rekonstruerar dem inte från konsumenttextens ordordning.

Följande källledtrådar har olika bevisvärde:

- Namn och org inom samma slutna grafiska identitetsblock kan styrka att de hör ihop. Det avgör inte om blocket avser säljare, mottagare, ombud, betalningsmottagare eller ett koncernnamn.
- En uttrycklig separat mottagare kan utesluta att just den mottagarregionen äger ett annat block. Den bevisar inte att alla återstående block tillhör utställaren.
- Dokumentrubriken Faktura styrker dokumenttypen. Den binder inte själv en viss identitet till en utställarroll.
- En faktisk utställar-/leverantörsrelation i källorden, bunden till samma identitetsregion och utan konkurrerande roll- eller orgförekomster, ger starkare oberoende rollbevis.
- Direction, headerposition, checksumma, en lyckad beloppssumma och frånvaro av en andra igenkänd kandidat får inte ersätta det rollbeviset.

Ett generellt starkt positivt kontrakt bör därför först omfatta en uttryckligt rollbunden region. Det ska definiera sina gränser genom verkliga etiketter/celler/ord, ha en redovisad adressdel och behålla alla egna och okända konkurrerande identitetsförekomster. En senare uttrycklig men namnlös roll måste fortfarande hindra ett falskt komplett ägarbevis.

### Separat designmöjlighet: granskningsförslag

Ett oetiketterat namn/org-kluster kan eventuellt visas som ett obekräftat förslag med källordsankare, faktiska ordkonfidenser och begripliga skäl, exempelvis gemensam identitetsregion och separat mottagare. Förslaget måste ha semantisk status obekräftad. Det ska inte skriva över canonical party/org, räknas som korrekt återvunnet fält, bli MCP-fakturakandidat eller tillåta automatisk registrering. Om produkten vill visa en rollhypotes bör ordet utställare uttryckligen märkas som en hypotes.

Ingen numerisk semantisk konfidens bör hittas på genom att summera några signaler. OCR:s ordconfidence mäter ordigenkänning och är inte sannolikheten att namnet äger fakturan. Denna design är separat från parserreparationen och är ännu varken implementerad eller accepterad.

## Övriga felmekanismer

### Tryckta sammanställningsceller

Nuvarande observationstolkare stödjer ett strikt mönster med tre vertikalt ordnade monetära rader, oberoende högra värdeceller, begränsade avstånd och full ordtäckning i rektangeln. Det bevarar säkerhet men utesluter andra tydligt tryckta strukturer.

I 01 finns netto-, moms- och totalbelopp utskrivna i en separat kolumn. Momsens kvalifikator innehåller det alfabetiska OCR-utfallet Yo. Den nuvarande kvalifikatorgrinden tillåter endast tecken ur en snäv numerisk uppsättning. Det är en konkret misstänkt avvisningspunkt. Huruvida varje annat geometrivillkor också är uppfyllt måste kontrolleras i den ännu inte verifierade diagnostikfilen.

I 02 är netto och total kompletta på sina egna rader medan momsbeloppet ligger i en separat cell bredvid en skadad procentsats. Att kräva tre samtidigt fria värdeceller kan hindra just denna blandade struktur. Detta är en förklaringshypotes till VAT-bortfallet, inte en slutverifierad enstaka orsak.

I 07 ligger tre rubriker på en rad och tre belopp på nästa. Det är ett horisontellt sammanställningsmönster som den vertikala specialbindningen inte uttrycker. En eventuell utvidgning måste bindas direkt till tre avgränsade kolumner, inte till första/närmaste belopp eller gissad tabellslutpunkt.

I 10 står SEK bredvid totaletiketten medan beloppet ligger separat. En sådan typad valutakvalifikator kan göra att totalnoden faller ur trippeln; den nuvarande regeln tillåter inline-kvalifikator bara för VAT. Även här återstår kontroll av alla geometrivillkor.

Positiva kontroller finns redan i 04, 05 och 08: korrekt separat tryckt VAT-belopp kan återvinnas samtidigt som en skadad procentsats ger en uttrycklig issue. Det visar det avsedda säkerhetskontraktet. Ingen reparation får beräkna VAT från netto eller total, ändra procentglypher eller behandla en hopslagen textsträng som bevis på två separata cellvärden.

I 09 är det rätta momsbeloppet faktiskt bundet: Summa moms har etikettorden [1,6,0,0,0..1], och beloppets ord ligger i [1,13,0,1,0..1]. Men en tidigare meningsrad med Moms och skadad procentsats blir en annan obligatorisk, ogiltig VAT-förekomst. Fullcensusen håller därför korrekt fältet tills den semantiska typen avgjorts. En framtida åtskillnad mellan rate/prosa och monetary-label måste lämna verkliga negativa Momsbelopp: ??? och konflikter orörda. Att bara ta bort table- eller invalid-noder skulle återinföra B:s redan underkända grundfel.

### Valuta

01 och 05 innehåller ett komplett ISO-valutaord med avslutande punkt. Den snäva konverteraren godtar bara det exakta valutakodordet. En mycket begränsad normalisering av ett helt valutavärde med meningspunkt är därför en rimlig första prövning.

04 har en faktisk separat Valuta/SEK-cell, men den ligger efter första tabelltoppen och blandas i konsumentraden med en momsrad till höger. Både regionens positiva behörighet och textgränsen kan hindra den. Terminal punkt ensam löser inte detta.

10 har Valuta: SEK. följt av en mening med betalningsreferens. Det är inte ett enskilt punctuerat valutavärde. Här krävs ett självständigt motiverat menings-/fältgränskontrakt. Vi får inte acceptera godtycklig text efter SEK, och ett explicit ogiltigt valutafält ska fortfarande blockera implicit återfyllning.

### Referens

02 har en tydlig OCR-rubrik [1,16,0,8,0] och korrekt bundet värde [1,16,0,9,0]. Löptexten Ange OCR vid betalning blir samtidigt en obligatorisk unbound-förekomst och håller hela fältet.

04 och 10 har en uppmaningsform Ange OCR-nummer i en verklig betalningscell med nummer under, men samma ord i löptext/fottext skapar ytterligare förekomster. Det behövs en generell skillnad mellan en källbunden fältuppmaning och ett omnämnande. Båda motorerna och text-/observationsvägen måste dela den auktoritativa grammatiken.

07 har det faktiska OCR-felet OCKR-referens i rubriken. Siffrorna finns, men rubriken är inte en accepterad label. Det finns ingen grund för ett korpusspecifikt alias eller en tyst rättning av bokstaven. Detta fall ska fortsätta hållas med nuvarande kontrakt.

### Bankgiro

Den särskilda Bankgiro-kontrollen kräver en komplett motsvarande konsumentrad och minst 90 i faktisk ordconfidence. Den använder inte automatiskt den allmänna source-region-bindningen.

I 04 är labelordet [1,1,0,0,4], confidence 96, box [1579,368,1759,408]. Värdet 5736-0828 är [1,1,0,1,2], confidence 94, box [1579,436,1850,474]. Den allmänna B-bindningen är giltig, men råtextordningen blandar panelen med företags-/adressrader till vänster. Den särskilda radbevisningen blir tom.

I 05 ligger label/värde i [1,3,0,0,0] respektive [1,3,0,1,0], confidence 96/91. I 08 ligger de i [1,1,0,13,0] respektive [1,1,0,14,0], confidence 96/96. Dessa ligger efter tabelltoppen och delar läsrad med sammanställning till höger. En strikt egen betalningscell skulle kunna prövas som alternativt positivt ordbevis, med full negativ census och samma konfidensgräns.

I 07 har värdet [1,6,2,0,0] verklig confidence 89. Det ska förbli null även om den geometriska bindningen förbättras. Varken sidans confidence eller det kända korrekta teckenutfallet får höja det till 90.

## Prioriterad föreslagen arbetsordning

1. Slutför den hashbundna diagnosen när miljön återkommer, särskilt namnord/regionkanter och de återstående geometripredikaten. Detta är en verifieringsuppgift, ingen produktändring.
2. Pröva små självständiga kontrakt: helt valutavärde med terminal punkt, och separat tryckt VAT-belopp trots en otolkbar rate-kvalifikator. Behåll riktiga negativa dubbletter och alla belopp bokstavligt från trycket.
3. Pröva explicit rollbunden identitetsregion över adressrader samt råcellsbevis för Bankgiro. Båda ska ha slutna, redovisade gränser och full negativ täckning.
4. Pröva blandade och horisontella monetära sammanställningar med typade kolumner/celler. Detta är större än en teckennormalisering och behöver egna strukturmotexempel.
5. Pröva en auktoritativ skillnad mellan fältetikett, fältuppmaning och löptext. Denna ändrar censusens semantik och behöver särskilt starka negativa prov.
6. Behandla obekräftade partsförslag som en separat produktdesign. Den ska inte användas för att pressa upp återvinningsmått.

Detta är en risk-/mekanismordning, ingen beräknad återvinningsprognos. Jag har inte summerat överlappande kända fall till en ny förväntad recall eller till en områdespoäng.

## Konkret syntetisk RED-plan

Följande är föreslagna nya prov, inte redan körda RED-resultat. De använder nya oberoende testnamn, tal och koordinater. De ska först frysas mot c5 med verkliga utfall. Om ett positivt prov redan går grönt är det en kontroll, inte en RED som ska tvingas fram.

En gemensam strukturmall kan använda 20 px ordhöjd, betalnings-/summaceller vid x=180 och x=810 och rader y=1420,1495,1570. Källraster, hela råtexten, varje ords box och confidence samt hela förekomstcensus ska ingå. Mallen är syntetisk; den har ingen relation till en verklig faktura eller bankinstruktion.

Nya namn kan vara Syntetisk Tallspira Test AB respektive Syntetisk Ekerled Test AB. Independenta syntetiska checksummevärden har förberetts som fixturelitteraler i separat store-post, inte som verifierade bolags- eller bankfakta. Tryckta beloppslitteraler kan vara 2 184,40, 546,10 och 2 730,50; parsern ska läsa vart och ett från sin egen cell och aldrig beräkna ett saknat belopp.

**S1–S6, monetära celler:** samma tryckta belopp i en vertikal trecellsgrupp med alfabetiskt skadad rate-kvalifikator; en variant där netto och total är kompletta inline men VAT separat; en variant med valutakod vid totaletiketten; en två-raders horisontell trekolumnstabell; ett saknat VAT-belopp som ska förbli null; och en senare verklig ogiltig/konfliktande VAT-förekomst som ska hålla VAT trots den positiva sammanställningen. Lägg till geometriska kontroller för en extra okänd cell, överlappande kolumner, två konkurrerande värden, större mellanrum och omkastad OCR-blockordning.

**C1–C4, valuta:** hela värdet Valuta: NOK. jämfört med Valuta: NOK; Valuta: NOK. följt av godtyckligt textinnehåll som ska hållas; ett korrekt och ett explicit skadat valutafält; och två olika accepterade valutakoder som ska förbli konflikt. Ingen genomsökning efter första giltiga ISO-kod får användas.

**R1–R5, referens/rateprosa:** ett tydligt OCR-fält och en separat betalningsinstruktion som nämner OCR; samma struktur med en riktig senare OCR: ???; två olika giltiga OCR-värden; en självständigt avgränsad uppmaningscell med nummer under jämfört med samma ord i löptext; och en ny skadad rubrik som saknar erkänd label och ska fortsätta hållas. Motsvarande VAT-par ska skilja verklig rateprosa från ett explicit ogiltigt monetärt VAT-fält. Råcensusen måste redovisa både de klassificerade omnämnandena och de verkliga värdeförekomsterna.

**B1–B6, Bankgiro:** en explicit betalningscell i högerkolumn medan råordningen blandar in en vänster adress; samma struktur efter en verklig artikeltabell med en sluten separat betalningsregion; samma värde med confidence 89; en skadad ytterligare Bankgiro-förekomst; ett annat korrekt konto i en andra ägarregion; och samma i full server-completion. Minst 90 gäller varje relevant faktiskt ord. Om hela beviset inte ryms efter serverannotationer måste hela omtolkningen återgå till legacy.

**O1–O7, ägarskap:** uttryckligt Leverantör plus namn, två adressrader och org inom en avskild region; samma geometri med en verklig mottagar-/ombudsgräns före org; två olika org i samma leverantörsregion; en senare explicit men namnlös roll; ett oetiketterat namn/org-block och separat kund; samma layout med en tydlig betalningsmottagare/ombudsroll; samt namn upptill och frikopplat org i sidfot. Endast det uttryckligt styrkta positiva kontraktet får återvinna canonical org. De oetiketterade fallen ska fortfarande ha canonical null; eventuellt förslag prövas i separat kontrakt och får inte påverka kandidater eller registrering.

För alla grupper behövs Node/Sites-paritet, oförändrad text-only-väg och riktiga negativa censusprov från den tidigare oberoende B-granskningen. Alla befintliga rootgränser för rollord i legitima bolagsnamn, uttryckliga kolonnamn, nya bara roller, organisation över rollgräns och parentesgränser ska bestå. Det gamla fallet med explicit ägd men namnlös andra roll ska uttryckligen ingå.

Original/owner/lease-guards, OCR-manualreviewtak, hela DTO:n och verkliga serverns 50k-gräns är oförändrade säkerhetsvillkor. Inga assertions eller äldre RED-kvitton ska skrivas över. Nya mekanismer får en egen commit och egen källbindning efter rootbeslut och separat granskning.

## Vad som återstår före en färdig analyscommit

- Kontrollera att raw-word-index.json och geometry-diagnostics.json skrevs färdigt och om diagnosskriptet avslutades korrekt. Ett verktygsavbrott är inget testresultat.
- Hämta och redovisa exakta namnord/boxar och alla ord som avgränsar de sex oetiketterade grupperna. För varje tänkt ägarregion ska samtliga inre och konkurrerande källord förklaras.
- Slutför en 39-radig fältmatris med primär/sekundär orsak, exact census-node, label/value-word-ID:n och källhänvisning. Ett table-state är inte alltid samma sak som slutbeslutet; fungerande legacyfält ska inte felklassas som fel.
- Kontrollera samtliga geometripredikat i 01/02/07/10 innan en enstaka mekanism anges som fullständig förklaring.
- Spara denna text och strukturerad evidens i den isolerade analysbranchen, skapa manifest och commit endast analysfiler. Ingen produktändring eller ny optik följer av den åtgärden.
