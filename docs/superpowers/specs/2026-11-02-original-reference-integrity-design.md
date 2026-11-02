# Originalreferenser och samtidiga uppladdningar

Den fortsatta engineering-cykeln utgår från verifierad main `38769f2` och Sites 54. Användaren har uttryckligen begärt självständiga rättningar, tester, granskning, main-push och publicering i befintligt Sites-projekt. Detta är tekniska beslut inom det uppdraget, inte nya verksamhetsbeslut.

## Krav och vägval

- Två samtidiga uppladdningar av samma bytes för samma ägare ska återanvända en dokumentpost och dess bevarade original. Samma hash hos olika ägare hålls separat. Gmail och manuell uppladdning delar dokumentregistret och måste bedömas tillsammans.
- Använd atomisk villkorad infogning och ägarbunden kontroll av faktiskt utfall. En ny global unik constraint väljs bort eftersom befintliga specialiserade original/snapshots har egna kontrakt. En in-memory-låsning väljs bort eftersom den inte omfattar alla Workers-instansers skrivningar.
- Förlorat D1-svar eller fel vid efterläsning får aldrig radera ett original som kan vara refererat. En säker återförsökning ska hitta samma registrerade original. Städfel får bevara en oregistrerad R2-kopia hellre än förlora ett original.
- Node-backup får inte verifieras eller återställas som giltig om SQLite rapporterar brutna främmande nycklar. Befintliga byte-, WAL-, filidentitets- och originalhashgrindar kvarstår.
- Kända producentfält i Node/Sites-historik och deklarerade typade originalreferenser ingår också. En ersatt bilaga eller bankdetalj får inte försvinna ur backupens omfattning. Aktiva och återtagna Bankgiro-länkar måste behålla samma deklarerade originalhash som det bevarade underlaget. Godtyckliga användar-/provider-/auditnycklar tolkas inte rekursivt som referenser.
- Sites-backup ska kontrollera att deklarerade dokumentreferenser i den frysta ägarsnapshoten finns i samma dokumentmanifest. Tydliga bevarade hashbevis måste stämma. Avsiktligt tomma dokumentreferenser, exempelvis avvisad Gmailkälla, är fortfarande tillåtna enligt befintligt kontrakt.
- Ingen saknad metadata eller faktura registreras automatiskt för att göra backupen komplett. Fel ska vara synligt och bevara befintliga objekt och historik.

## Acceptans och gräns

Syntetiska regressioner ska först reproducera dubblettracen respektive felaktigt godkända skadade snapshotar. Positiva fullständiga snapshotar, isolerade ägare, avbrott, okänt commitutfall och giltiga äldre former ska behållas. Oberoende granskning och alla aktuella CI-grindar krävs före push/publicering. Produktionskontrollen är skrivskyddad; denna rättning är inget fullständigt katastrofprov eller bankbevis.

## Uppmätt avstämningskostnad

Lokal syntetisk Sites-avstämning av 100 oberoende fakturor/betalningar tog 52,76 sekunder. En separat CPU-profil av 50 par visar upprepad namnnormalisering som dominerande kostnad. Lägg därför till återanvändning av exakt normaliserade strängar endast under samma rena analysanrop i båda motorerna. Inga referens-, identitets-, dubblett-, medgivande- eller saldoavgöranden får ändras. Global cache och borttagna omkontroller väljs bort eftersom senare relationer och mutationer ska bedömas på nytt. Före-/efterrunner och handbestämda positiva/negativa regressioner ska visa oförändrade beslut, bevarad indata och mätbar förbättring. Ett lokalt diagnostiskt 20-sekundersmål för de 100 paren är ingen produktions-SLA och ska inte göras till ett tidskänsligt CI-test.
