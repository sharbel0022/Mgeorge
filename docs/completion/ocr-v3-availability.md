# OCR V3: begränsad tillgänglighetskontroll, 6 november 2026

**Det historiska V3-paketet är inte tillgängligt genom de kontrollerade lokatorerna. Dess first-use-status är UNKNOWN. Det kan därför inte användas som ett verifierat oanvänt engångsprov i denna miljö.** Detta är inte ett påstående att materialet saknas i all möjlig lagring eller att första optiken bevisligen har förbrukats.

## Vad som finns och vad som kontrollerades

[integration-review-wave3.md](../quality8/integration-review-wave3.md) beskriver en separat frysning på commit `e2b61ae7504d07f2753e575eeddec8bf5966da84`: tolv normalbilder, två stressbilder, 1600 × 2000, noll OCR-/parseranrop vid frysningen. Senare historiska [release-wave3](../quality8/release-wave3.md) och [release-wave4](../quality8/release-wave4.md) beskriver fortfarande V3 som förseglad. Dessa är administrativa historikuppgifter, inte en aktuell kontroll av originalpaketet eller alla köranspråk.

| Historisk bindning | SHA-256 |
| --- | --- |
| Dataset | `85014b30c976ac45356a8c4ea9454c6f804a9938c9faf610e686a200ec1f673b` |
| Manifest | `e4298dd83ccba9ea283d41672597029656d3401a879cb7f507f53677f4c8226e` |
| Gold | `e1cfc1ad5e3445b2e843a93777b8d56e7ab86a4633abae805199fa511e3d5048` |
| Mätkod | `42a498b2df4a6256c7dbe177be0a3a27277f82355adeddf8439a47e30202ab6e` |

Den läsande kontrollen sökte filnamn och administrativ protokolltext i aktuella `Mgeorge/docs/quality8`, `scripts/quality8` och `test/fixtures/quality8`, inklusive ignorerade filer i dessa områden. Tre tillgängliga äldre träd under `/workspace/scratch/0005a76ddf57` kontrollerades också: `Mgeorge`, `Mgeorge-ocr` och `Mgeorge-ocr-residual`. Inga V3-original, fullständigt manifest, V3-mätkod eller köranspråk återfanns. `git cat-file -t` kunde inte läsa fryskommitten i något av de fyra repositoryträden. Den äldre angivna scratchmiljön `/workspace/scratch/4d79ab4bea8e` finns inte tillgänglig. Detta överensstämmer med den tidigare [oberoende administrativa granskningen](independent-security-review.md).

**Separat root-rapporterad kontroll:** GitHub API-anropet för `commits/e2b61ae7504d07f2753e575eeddec8bf5966da84` gav HTTP 422, `No commit found for SHA`. Denna granskare gjorde inte API-anropet själv. Svaret gäller den kontrollerade GitHub-lokatorn och bevisar inte frånvaro i andra repositoryn, referenser eller arkiv.

Originalbytes saknas här för jämförelse mot de historiska hashvärdena. Frånvaron av ett lokalt run-claim är därför **inte** bevis för oanvänd one-shot-kapacitet när själva paketet och dess fullständiga historik också saknas.

## Återfunna grindar och deras begränsning

Den historiska sammanfattningen kräver en oberoende READY-granskad, fryst slutkälla och separat exakt källbindning före första optiska mätningen. För var och en av parsermotorerna ska både all13 och mandatory10 på normalfallen nå minst 98 % precision och 85 % recall, med noll kritiskt falskgröna och avstående på båda stressfallen. Nämnarna är 156/120/108 för all13/mandatory10/image9. Image9 och dokumentmått redovisas separat; metadata-direction får inte beskrivas som bildigenkänning. Tidigare förstautfall bevaras.

Någon numerisk utvecklings-readinessgrind återfanns inte. Den nu planerade alias-/censusrättningen behöver ändå den av root angivna oberoende granskningen, CI och slutliga källfrysningen. De stegen kan inte ersätta ett saknat ursprungligt V3-paket eller verifierad körhistorik. Fullt V3-protokoll och run-claim-status går inte att attestera från sammanfattningen. Befintliga V2-skript gäller en annan korpus och är ingen ersättning för V3:s frysta mätkod.

## Beslut och utfört scope

Root har bekräftat att **V3 inte körs och inte rekonstrueras**. Det nya giltiga SEK-provets första utfall, 62 TP/0 FP/46 FN av 108 = 57,41 % recall, bevaras som sitt eget oberoende förstaprov. En efterföljande aliasfix som prövas på dessa nu kända underlag är utvecklingsreplay och ska inte ometiketteras som V3 eller nytt oberoende slutprov.

Ingen V3-bild, goldpost, prediction eller generator öppnades. Inga optiska anrop, produktparseranrop, bindningar, köranspråk, hämtningar av det saknade paketet eller produktändringar utfördes. Endast denna dokumentnotering tillkom.
