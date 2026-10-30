# Cykel 3 – API-original och återställningsbar proveniens

**Den isolerade bankkandidaten är oberoende granskad och klarar 469 Node + 692 Sites = 1 161 tester.** Detta dokument beskriver den frysta koden före push/publicering. Senaste faktiskt levererade main är `9d9a10c48e4725ec22e188f946da3c03cdfa5814`, med grön Actions 41099298812 och publicerad Sites34. Nästa leverans räknas först när motsvarande externa kvitton finns.

## Varför ändringen behövs

Sites bevarade provider-JSON men kunde lita på senare ändrade sammanfattningar utan en gemensam aktuell kontroll mot originalet. Samma svaghet påverkade direkt avstämning, historiska betalningspåståenden, kontroll av utebliven betalning och kundmeddelandens gransknings-/sändningsgränser. Originalets integritet måste kontrolleras varje gång underlaget används, även efter återställning eller manuell komplettering.

## Förändrat beteende

- Nya bank-API-original får en versionsmärkt SHA-256-kontrollsumma vid den betrodda normaliseringsgränsen. Summan avser exakt sparad UTF-8 av `JSON.stringify` för det parsade svaret, inte HTTP-svarets ursprungliga överföringsbytes och inte en bankunderskrift.
- Den gemensamma kontrollen jämför aktuell valuta, bokföringsstatus, tecken/belopp, datum, kontobunden identitet, betalare och referensinformation mot det bevarade originalet. En ändrad `evidence`-etikett kan inte kringgå kontrollen. Manuell bekräftelse förblir ett separat, uttryckligt bevis.
- Saknat eller skadat API-original spärrar nya och aktuella betalningspåståenden. Historiska allokeringar och belopp raderas inte. En förälder som saknas eller ingår i en cykel kan inte ersättas med barnets ofullständiga fakta.
- En historisk post utan båda kvittofälten kan återfå aktuellt bevis först när ett färskt, betrott och identiskt providersvar finns. Tomma strängar, null och andra uttryckligen ogiltiga värden behandlas inte som frånvarande historiska fält. Återhämtningen skapar inte en extra bankhändelse eller mer tillgängliga pengar.
- Komplettering med en verkligt återläst bankfil binder filens referensmetadata till dess dokument-ID och bytehash. Den ersätter inte API-originalet. Gammal, annan eller lånad metadata får inte fungera som bevis; ägar- och R2-kontroller gäller fortsatt.
- Backup kontrollerar API-original i arbetsytan, inkommande konflikter och både `bank.import_rejected` och `bank.sync_rejected`. Ett bevarat original med skadat kvitto stoppar certifiering och slutförande. Historik som helt saknar gamla kvittofält arkiveras troget och räknas separat som `records_without_receipt`; en backup får aldrig skapa ett bankkvitto av sina egna återlästa data.
- Additiv migration 0015 sparar backupens ärliga bedömningsomfattning. Den innehåller inga destruktiva schemaändringar. Ett äldre arkiv utan sådan bedömning visas som ännu inte bedömt.

Det nya synkrona hashstödet använder det exakt låsta beroendet `@noble/hashes`2.4.0. TypeScript, faktiskt Worker-bygge och full beroendegranskning passerar. Tolv befintliga testfiler/testhjälpare använder nu färska syntetiska API-kvitton; korrupta negativa fall förblir korrupta och förseglas inte om för att få testerna gröna.

## Regressioner och oberoende kontroll

Den första oberoende granskningen hittade fyra Important-fel i kandidaten: utelämnad `bank.sync_rejected`-historik i backup, för tillåtande återhämtning av tomma kvittofält, föräldralösa/cykliska kedjor och kringgång via ändrad bevisetikett. Dessa rättades efter reproducerade fel. 21 permanenta ytterligare regressioner lades till; totalt finns 49 API-originalfall och 19 API-backupfall i de nya testfilerna.

Omgranskaren körde sina 29 ursprungliga prov oförändrade och 90 fokuserade API-/backupfall, samtliga godkända. Sju nya oberoende fall verifierade fil-ID/hash, saknade eller lånade metadatakvitton, ändrad referens, fel ägare, bevarad manuell bekräftelse, senare skadat API-original och säker återkomst av en saknad förälder. Båda tidigare reproducerade allokeringsfelen ger nu avvisat original, 0 nya allokeringar och oförändrat saldo 62500 i den syntetiska modellen.

De permanenta testen finns i `sites/tests/bank-api-original-q8.test.mjs` och `sites/tests/bank-api-backup-q8.test.mjs`. Exakta 26 källhashar finns i [kandidatmanifestet](QUALITY-8H-CYCLE3.json). Oberoende prov använde riktig isolerad SQLite/lagring och mockad extern leverans; inga riktiga kundmeddelanden skickades.

## Slutgrindar

| Grind | Resultat |
| --- | ---: |
| Node, full svit | 469/469 |
| Sites, full svit | 692/692 |
| Fel / överhoppade / avbrutna | 0 / 0 / 0 |
| JavaScript-syntax | 69 filer godkända |
| Sites TypeScript | Godkänd |
| Produktionsbygge | Build complete, exit0 |
| Node / Sites beroendegranskning | 0 / 0 kända sårbarheter |
| Oberoende omgranskning | Inget kvarstående Critical/Important i fryst omfattning |

Alla grindar kördes från en isolerad kandidat som integrerats på senaste main9d. Hasharna kontrollerades före och efter. UI/navigering/UUID är separata arbetsändringar och ingår inte i denna bankkandidats 26 filer eller testsumma.

## Produktionsbevis och kvarstående arbete

[Version34s publiceringsrapport](QUALITY-8H-SITES-CYCLE2-PUBLICATION.md) verifierar föregående leverans, autentiserade läsningar, aktuella granskningsorsaker, bevarad policy/identitet/scheman och ett nytt mobilt fokusfel. Dessa observationer bevisar inte den ännu opublicerade API-rättningen.

Äldre bankposter utan nytt kvitto hålls osäkra tills betrott original återkommer eller underlaget granskas på avsedd väg. Detta är avsiktlig försiktighet, inte bevis för att betalningen saknas. Individuella Swedbankrapporter, rätt företagsprofil/OCR-avtal och representativa autentiska faktura-/OCR-facit saknas fortfarande. Backupens storleksgränser, tidsmässiga konsistens mellan D1/R2 och ett isolerat återställningsprov av produktionsbackupen kvarstår. Gmail-schemat är fortsatt pausat.

Kända UI-brister rättas i en separat kandidat: felaktig benämning av manuella original och fakturareferens som OCR, okänd Gmailstatus som noll, kontrast, URL/historik/utkast samt mobilens granskningsfokus. Dessa är inte externt blockerade. Arbetet fortsätter med kod och verkliga webbläsarprov inom samma åttatimmarsbudget.
