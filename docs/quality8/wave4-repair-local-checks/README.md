# Avbruten lokal banktestprocess

Den sammanförda körningen gav 420 pass och ett filfel. Bankprocessen dog efter 228 godkända assertions utan ett vanligt assertionsfel; övriga valda testfall passerade. Ett felaktigt sista filnamn i första kommandot korrigerades genom separat full company-request-körning, 20/20.

En oförändrad, separat full banksvit med TAP reproducerade filavbrottet efter 221 godkända fall. Barnprocessen fick **SIGKILL**, och processens maximala observerade RSS var **3 009 760 KiB**. Detta är inte en godkänd körning och bevisar inte ensamt vem som skickade signalen. Den befintliga harnessen skapar stora unika nästlade data-URL-moduler per fixture; dess minneskostnad utreds innan full CI.

Alla råloggar och exakta kommandon är bevarade i checkpoint.json och diagnostic.json. Inga assertions eller produktgrindar har ändrats. En eventuell rättning ska gälla testmodulernas lagring/livscykel och verifieras med oförändrade fulla fall.
