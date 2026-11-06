# Oberoende slutgranskning: SQL-gräns och bankens saknade tokenschema

Datum: 2026-11-06. Granskaren implementerade OCR-/Gmail-spåret och författade inte denna säkerhetsrättning. Granskningen gäller säkerhetsdiffen efter PR 61, inte en ny penetrationstestning av hela produkten. Inga produktionsanrop, kunddata eller externa provideranrop användes.

## Fynd och rättning

Den första integrerade quotescannern på `37c618366d0ba5243d56e594d58a62cf8dcec951` tog bort citattecknets tokengräns i SQL-kontrollformen. SQLite accepterar `SELECT owner FROM"workspaces"`, men scannerns `FROMworkspaces` matchade varken tabellcensus eller ägarprojektion. En sådan fråga returnerade båda isolerade syntetiska företagens rader. Samma form kunde läsa `company_application_token_control`. Detta var ett verkligt blockerande fynd i en läsgräns, även om SQL-frågorna kommer från intern produktkod och ingen generell extern SQL-endpoint påvisades.

Fyndet skickades till säkerhetsspåret. Där frystes nya regressioner före rättningen. Den slutliga fixen `c22bd94a68144a41b3b40664225509ef89f40722` behåller mellanrum runt varje citerad identifierare i kontrollformen. SQL-strängen bevarar sina riktiga citerade namn. En separat sexradersdiff mot föregående scanner rättar dessutom ägar-CTE-prefixet vid `WITH`/`RECURSIVE` utan krav på ett extra blanksteg före ett citerat CTE-namn.

## Egen oförändrad kontroll

Samma självständigt skrivna 28 kontrollfall kördes före och efter fixen mot riktiga isolerade SQLite-databaser och projektets tenantadapter:

| Kandidat | Godkända | Underkända | Tolkning |
| --- | ---: | ---: | --- |
| Integrerad `37c6183` | 1 | 27 | Bekräftad otillräcklig tabell-/kontrollgräns och kompakt SQL-kompatibilitet |
| Rättad `c22bd94` | 28 | 0 | Samma frågor/assertions, inga ändrade förväntningar |

Proberna omfattar dubbla citattecken, hakparenteser och backticks; kompakt `AS`, `WHERE`, `JOIN` och `UNION`; vanlig och rekursiv citerad CTE; fem globala kontroll-/katalogtabeller; batchläsning; samt en legitim ägarskrivning som bevarar det andra företagets revision. Kontrollfallens källfil och de uppmätta produktfilerna är SHA-256-bundna. Produktfilen kontrollerades oförändrad före och efter varje körning. Rårapporter och det reproducerbara skriptet finns i [evidenskatalogen](independent-security-review/manifest.json).

**Bedömning: inga kvarstående blockerande fynd identifierade i den avgränsade säkerhetsdiffen efter rättningen.** Huvudspårets fulla CI och återställningsgrind på exakt integrerad kod är separata krav. Denna omgranskning ersätter inte dem.

## Bankens saknade tokenschema

Den additiva ändringen i `sites/tests/openpayments-workers-runtime.test.mjs` har också lästs. Den använder faktiskt server-/bankruntime och isolerad SQLite för frånvarande token-/kontrolltabeller och kontrollrad. Testerna kräver nekad bankoperation utan tokenutgivning, vanlig fetch, schemaåterställning eller ekonomisk ändring, samtidigt som vanliga företags-/legacyarbetsytor går att läsa. De fångar intern felkod i fixturen men ändrar ingen produktfunktion. Inget blockerande fynd identifierades i denna testdiff. Den separata bankintegrationens verkliga providerstatus eller medgivande har inte bedömts av dessa syntetiska tester.

## OCR-hållprovets administrativa status

Den här slutgranskningen öppnade inga nya OCR-bilder eller facit och gjorde inga optiska anrop. Repositoryt refererar historiskt till en förseglad V3-korpus, men ingen verifierbar OCR-V3-locator eller fullständig öppningsplan kunde återfinnas i dess administrativa rapporter, de tillgängliga tidigare scratchfilnamnen eller Library-metadata. Den äldre uppgivna scratchmiljön `4d79ab4bea8e` är inte tillgänglig. Personal Context rapporterade att tidigare samtalskontext inte var tillgänglig.

De verifierbara administrativa texterna kräver en oberoende granskad fryst kandidat och ett fryst mätprotokoll; ingen numerisk readinessgrind återfanns. Det finns därför inget stöd för att behandla känd utvecklingsrecall 74/100 som ett förbud mot ett ärligt oberoende prov. Huvudspåret avser att låta en separat utvärderare skapa och frysa en ny syntetisk korpus utan parser-/resultatinsyn och bevara dess första uppmätta utfall. Ett sådant prov ska beskrivas som en ny korpus, inte som återfunnen V3. Denna rapport innehåller inget resultat från det framtida provet.
