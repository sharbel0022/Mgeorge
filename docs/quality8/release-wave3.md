# Site 65: publicerad parser- och bankdiagnostik

**Site 65 är publicerad och avgränsat efterkontrollerad. Målet minst 8 i alla 33 områden är fortfarande inte uppnått: 27/33, summa 256,5/330.** Inga poäng höjs i denna release.

[Maskinläsbar leveranskedja](release-wave3.json) och [faktiska efterkontroller](wave3-postpublication-observations.json) skiljer den levererade koden från fortsatt OCR- och bankarbete.

## Exakt leverans och kontroller

[PR 57](https://github.com/sharbel0022/Mgeorge/pull/57) mergades normalt till main `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Både PR-körningen och den separata [main-körningen 42131115405](https://github.com/sharbel0022/Mgeorge/actions/runs/42131115405) lyckades. Det separata SaaS-säkerhetsjobbet på PR-huvudet lyckades också.

| Obligatorisk svit | Main: godkända | Fel / överhoppade |
| --- | ---: | ---: |
| Node | 2 277 | 0 / 0 |
| Sites | 4 495 | 0 / 0 |
| Isolerad Bankgiro-brygga | 47 | 0 / 0 |
| Totalt | **6 819** | **0 / 0** |

Installation, syntax, typer, beroendegranskning och produktionsbygge passerade. Inga high/critical-fynd rapporterades; åtta moderate-fynd i Sites utvecklingsberoenden kvarstår. Riktade lokala tester ingår i den fulla sviten och adderas inte en andra gång.

Native Site-källa `25d68b799c6baa2f57b4dd6ad745e225bfe5bf1f` har exakt samma träd som main:s Sites-del: `3d55730c517ae0d9c22c20c74c81762d0bd3f15a`. 612 spårade källfiler kopierades, byggdes och pushades genom ordinarie Site-flöde. Version 65 sparades med ett lokalt byggt arkiv och publicerades först efter godkänd exakt main-CI. Deploymenten rapporterade **succeeded 2026-11-05 23:48:25.739259 UTC**, MCP tillgängligt och miljörevision 10. Publik åtkomst och befintliga scheman ändrades inte.

Publicerad adress: [MG Fakturakoll](https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site/).

## Vad som ändrades

Den oberoende granskade parsern hanterar de explicita moms-/totaletiketterna och leverantörsrollerna med gemensamma fältgränser. Konkurrerande eller ofullständigt underlag får inte försvinna för att ett annat värde ser användbart ut. Den riktade integrationskontrollen var 232/232 före full CI; tidigare underkända granskningsfall är bevarade.

Bankrevalideringens befintliga fel kan nu ge fasta, källbundna räknare för kontotypen i sparat respektive aktuellt urval. Valideringspolicy, kontoval, behörighet, giltighet och felkod ändrades inte. Endast det egna äkta valideringsfelet får räknare efter godkänd befintlig ägar-/leasebunden failed-audit.

De senare geometri-, mottagaralias- och organisationskontextändringarna ingår **inte** i Site 65. Deras separata granskning fann felaktiga part-/orgkopplingar som måste stängas före leverans.

## Faktisk drift efter publicering

En enda ordinarie bankrevalidering 23:50:44 UTC gav fortsatt `BANK_ACCOUNT_SCOPE_INVALID / ACCOUNT_USAGE_INVALID`. Det enda valda kontot hade **sparat explicit null**, medan aktuell sessionsresurs **utelämnade usage**. Det är varken ett ORGA- eller PRIV-bevis. Anslutningen är fortsatt frånkopplad; ingen senare lyckad bankhämtning än 08:05:14 UTC observerades. Bankens [API-referens](https://enablebanking.com/docs/api/reference/) och [OpenAPI-schema](https://enablebanking.com/docs/api/reference/enablebanking-api.yaml) ger ingen dokumenterad null-semantik för Usage. Ingen uppgift normaliserades eller uppgraderades för att få godkänt.

Gmail hade en färsk lyckad hämtning 23:02:40 UTC. Den nya [moln-OCR-körningen 42132076896](https://github.com/sharbel0022/Mgeorge/actions/runs/42132076896) rapporterade **6 behandlade, 0 körfel** och avslutades 23:50:50. Den var uttryckligen `workflow_run`. Statusläsningen visade väntande OCR 50→44 och granskning 368→374; registrerade dokument låg kvar på 2. En kontrolläsning av GitHub 00:04:06 den 6 november visade fortfarande den senaste periodiska körningen från 18:21 den 5 november. CI-utlöst progress ersätter inte schemabevis.

Två exakta, skrivfria betalningsläsningar 00:06:28 var kompletta för respektive vald rad, aktuella och utan outputbegränsning. Båda behöll revision 52, noll fakturabokningar och oförändrade kontrollsteg jämfört med Site 64. Rapportobservationens angivna betalare/generella referens bevarades; AIS-postens saknade uppgifter förblev saknade. Konto- och avstämningssteg var fortsatt spärrade. Inga ekonomiska ändringar utfördes som kvalitetstest.

Den senast fullständigt verifierade backupen omfattar 362 original. En ny separat snapshot omfattar 430 och var fortfarande under kopiering; [hela delresultatet och busy-stoppet](backup-2026-11-06-resume-report.md) bevaras. Den är inte redovisad som fullständigt verifierad.

## Kvar för målet

| Område | Poäng | Kvarstående bevis eller arbete |
| --- | ---: | --- |
| 6 Minimal manuell hantering | 6,5 | Ett redan tillåtet verkligt normalunderlag genom aktuell kö till beständigt registreringskvitto. |
| 10 Bild-OCR | 6,5 | Generell faktisk återvinning och ett nytt fryst oberoende prov över oförändrad acceptansgräns. |
| 15 Swedbank | 6,5 | Aktuell giltig anslutning och läsning av rätt konto; null-observationen måste utredas. |
| 16 Automatisk bankhämtning | 6,5 | En ny lyckad behörig körning med korrekt operativ status. |
| 28 Schemaläggning | 6,5 | Observerad aktuell periodisk OCR-körning och progress. |
| 33 Produktionsverifiering | 7 | Återstående bank- och normalflöde med relevant faktisk acceptans. |

V2:s första prov står kvar underkänt: 60% mandatory recall och 100% precision. Omtolkning av de redan kända lagrade texterna med den nu levererade grammatiken ger 63% mandatory recall, inte ett nytt hållprov. Den separata V3-korpusen är fortfarande förseglad och okörd.
