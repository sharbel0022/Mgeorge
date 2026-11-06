# Site 66 — granskad parser, dokumentåterköning och bankdiagnos

Site 66 publicerades **2026-11-06 04:01:09 UTC** från normalt mergad PR 58 och exakt huvudgren `0035ea89ef3cd60f0924f901503cad00d1ab1fca`. Alla **7569/7569** obligatoriska tester passerade på denna huvudgren. Målet är fortfarande inte uppnått: **28/33 områden når minst 8**, och 6, 10, 15, 16 och 28 återstår.

## Exakt leveranskedja

| Del | Verifierat underlag |
| --- | --- |
| PR | [58](https://github.com/sharbel0022/Mgeorge/pull/58), huvud `f488841afccdefba17a6b584320347581f60c3f4` |
| PR-grindar | Payment 42157715027 och SaaS 42157715038, båda success; [fullt PR-kvitto](wave4-final-pr-ci/README.md) |
| Normal merge | `0035ea89ef3cd60f0924f901503cad00d1ab1fca`, fullständigt träd `2f22b5e154646507f78e9e44952513d7456905e4` |
| Main-grind | [Payment 42158636715](https://github.com/sharbel0022/Mgeorge/actions/runs/42158636715), push/main, success; [fullt main-kvitto](wave4-main-ci/README.md) |
| Main-tester | Node 2321, Sites 5201, bridge 47; 0 fail/cancelled/skipped/TODO |
| Bygge och audit | Samtliga 16 obligatoriska steg passerade. Sites build kördes 03:52:24–03:52:36 UTC. Node/bridge audit 0; Sites har 8 moderate men inga high/critical enligt den använda auditgrinden. |
| Native source | `0b119b8d472f70a1bfeac686c12889b618a32fb2` |
| Identiskt Sites-träd | `58c2cae56a5be177842c360ae46d5caed83fdd9b`, 629 spårade filer |
| Paketerat arkiv | 18 605 800 byte, SHA256 `8cb1aace94955204027302b08acdbb9e308b57c40a1fc95f33ace1830b8fee2d` |
| Produktion | Version 66, deployment succeeded, MCP aktivt, miljörevision 10 |

Den sparade versionens tjänstekvitto beskriver också sitt uppackade tar-arkiv. Dess storlek och hash ska inte förväxlas med det lokala gzip-paketet ovan. Alla opaka versions- och deployment-ID:n finns oförändrade i [maskinläsbart leveranskvitto](release-wave4.json).

PR:s SaaS-testantal överlappar övriga sviter och adderas inte. Workflowfilen startar inte SaaS på push till main; ingen sådan körning påstås. Fulla CI-råloggar bevaras förlustfritt i gzip, med ursprungliga och lagrade hashvärden. Tidigare underkända PR-körningar och båda refuserade paketen är fortsatt dokumenterade och publicerades inte.

## Vad som ändrades

Den granskade parsern hindrar ett färdigt företagsnamn från att absorbera en senare partsroll och hindrar tvetydiga namn från att ge ett omärkt organisationsnummer fel ägare. Bokstavliga rollord inne i ett normalt företagsnamn bevaras. [Oberoende granskning](party-boundary-independent/recheck-96d1404/REVIEW.md) och [producentens bevarade RED/GREEN](party-boundary-repair/README.md) beskriver exakt omfattning.

En ägd dokumentkälla kan återköas via samma spärrade tillståndsövergång som appens **Tolka igen**. Det nya MCP-anropet registrerar inget självt: den ordinarie processorn måste på nytt verifiera original, källa, motpart, konfidens och dubbletter. Verktyget fanns ännu inte i den här sessionens anslutna verktygslista efter publiceringen. Appens privata webbläsarvy kräver inloggning; den utvalda äldre kandidaten har därför inte återköats.

Bankdiagnosen gör högst fem kontrollerade detaljläsningar för redan valda konton med sparat explicit null. Den ursprungliga avvisningen och alla åtkomst-, tids- och revisionsspärrar bevaras. Ingen konto- eller samtyckesuppgift normaliseras. Testharnessens minnesrättning bevarar tidigare fixtures och assertions.

## Verkliga efterkontroller

Ett normalt bankrevalideringsanrop avvisades fortfarande med `ACCOUNT_USAGE_INVALID`: ett valt konto har sparat explicit null och aktuellt utelämnat usage. Detaljdiagnosen visar ett försök men **ingen verifierad observation**, `DETAILS_PROVIDER_UNAVAILABLE`. Kontots usageklass är därmed okänd och banken är fortfarande frånkopplad. Den begränsade Worker-loggläsningen gav ingen närmare felorsak; frånvaro av loggmarkör bevisar inte ett lyckat HTTP-anrop.

Den vanliga Gmail-hämtningen importerade **9 nya underlag**, och fyra efterföljande begränsade processoranrop flyttade återstående kö till OCR. Slutstatus: 386 behöver granskning, 63 väntar på OCR och samma 2 dokumentregistreringsrader finns kvar. Inget nytt automatiskt registreringskvitto uppstod. Gmail-hämtningen avslutades 04:06 UTC och är åter färsk. Dessa manuellt initierade appanrop räknas inte som nya periodiska bevis.

Det senaste Gmail-schemakvittot hade sagt `no_update` utan motsvarande färsk appinvokering. Den befintliga timuppgiftens instruktion kräver nu färsk status, ett vanligt tillåtet hämtningsanrop, begränsad köbearbetning och separat slutstatus innan ett oförändrat läge får rapporteras. Exakt prompt lästes tillbaka; schema, uppgifts-ID, aktivering och bankschema bevarades. En verklig periodisk körning med den ändrade instruktionen återstår.

Två fullständiga betalningsläsningar före publiceringen och efter alla ovanstående appanrop visar **revision 52, noll nya bokningar och oförändrade ekonomiska värden och spärrar**. Jämförelsen tar endast bort kontrollernas `checkedAt`-tidsstämplar; de fulla svaren och ursprungs-ID:n har hållits privata. Rapportunderlaget räknas fortsatt inte som en extra ekonomisk insättning. Den separata AIS-insättningen får inga påhittade betalare eller referenser.

Backupen är fortfarande verifierad för dagens frysta manifest: **430/430 filer, 185 567 855 byte, manifest_pass**. Nya Gmail-original efter manifestets frysning omfattas inte av denna snapshot. Den redan färdiga kopian prövar inte den korrigerade automatiska anropsbudgeten från ett ofärdigt läge. Tidigare faktiskt periodiskt OCR-bevis kvarstår separat i [körningen 02:54 UTC](ocr-periodic-20261106/README.md).

Alla offentliga driftuppgifter, efterjämförelser och schemabegränsningar finns i [efterkontrollernas kvitto](wave4-postpublication-observations.json). Kundoriginal, e-postadress, kontouppgifter, privata chattreferenser och autentiseringsuppgifter ingår inte.

## Fortsatt arbete

OCR-observationerna och fältregionerna A/B är en separat kandidat, ännu inte publicerad. Känd textreplay med den levererade parsern ger 57/100 obligatoriska fält och 79/130 All13 utan falska fältvärden i den lagrade PSM3-gruppen; den är ingen ny optisk körning eller blind mätning. V3 är fortfarande förseglad. Nästa kandidat måste få oberoende granskning och följa ett fryst mätprotokoll innan nya optiska resultat används för betyg.

En smal komplettering av bankdiagnosen utreds för att skilja säkra, fasta transport-/kontraktsfelkategorier utan rå banksvarstext. Det faktiska nuvarande felet motiverar ingen aktivering eller antagen bankbehörighet. [Aktuella 33 rader](current-33-assessment.json) behåller samtliga numeriska betyg.
