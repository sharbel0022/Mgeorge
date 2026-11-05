# Wave 2: publicerad Site 64 med verifierat källträd

**Site 64 är publicerad och efterkontrollerad. Målet 8/10 i alla 33 områden är ännu inte uppnått.** Den levererade versionen har 6 534 godkända obligatoriska tester. Aktuell bedömning är 27/33 områden med minst 8; kvarvarande områden är 6,10,15,16,28 och 33.

## Leverans och exakt CI

| Del | Verifierat resultat |
| --- | --- |
| PR | [56](https://github.com/sharbel0022/Mgeorge/pull/56), normal merge |
| Main | `819adee2f3848b474167eb6b15f82584caeb39af` |
| Main-träd | `3df3558ac496afc13c09227bf6d0f3ad5bd2a0d1` |
| Sites-träd | `6e024c917ba8833e516db5723f8be1ff1d1bc4dc` |
| Native Site-källa | `e6c313e1356a0043b76d0f83dffa7bcc86a5f217`, exakt samma Sites-träd |
| Main-CI | [42123382389](https://github.com/sharbel0022/Mgeorge/actions/runs/42123382389):2277 Node + 4210 Sites + 47 bridge = 6534,0 fel/skip/cancel/TODO |
| Övriga obligatoriska grindar | Installation, syntax, TypeScript, minimatchkontroll, audit och produktionsbygge godkända |
| Audit | Root/bridge/produktionsberoenden 0; Sites totalt 8 moderate utvecklingsfynd,0 high/critical |
| Publicering | Site 64, `appgdep_6aed07dafe148191a5e013c8498846f6`, succeeded 22:49:18.621 UTC, MCP finns, envrevision 10 |

[Maskinläsbart leveranskvitto](release-wave2.json) innehåller arkivhashar, versions-ID och jobbreferenser. Publik adress och befintlig ägare, databas, originalförvaring och tre aktiverade scheman är bevarade.

Den första PR-körningen[42120342085](https://github.com/sharbel0022/Mgeorge/actions/runs/42120342085) hade 8 Sites-fel och publicerades inte. Fem positiva referensfixturer saknade det original-/detaljbevis den nya policyn kräver. Fixturerna fick explicit syntetiskt originalstöd, med gamla assertions bevarade och 11 nya negativa fall. Tre UI-fel krävde rättning av granskningsorsakernas ordning och en komplett positiv faktura-fixtur. Oberoende granskning hittade därefter tre ytterligare viktiga hårda spärrar som kunde döljas av chargeback-granskning; även dessa stängdes. Slutligt integrerat fokusprov 108/108 och oberoende slutreview 124/124 överlappar full CI och adderas därför inte till 6534. [Integrationshistorik](integration-review-wave2.md), [slutreview](payment-presentation-review-22dc.md), [fixturreview](invoice-candidates-ci-fixture-review.md).

## Vad som faktiskt är levererat

- Översikt, betalningslista och detalj skiljer registrerade kopplingar från verifierade bankfakta. Historiska saldon bevaras, medan saknade original, kontobevis och referenser stoppar verifierad visning.
- Explicit manuell fördelning på flera fakturor har egen förhandsgranskning, godkännande, atomaritet och idempotent kvitto. Automatisk tvetydig matchning förblir spärrad.
- Sökrutan återfår fokus när en öppnad träff stängs. Smala formulär och berörda huvudvyer har kontrollerats lokalt vid 320/390/768/1024/1440 px,25/25 geometrier.
- OCR har starkare gränser för ordgeometri, datum, belopp, konton och fältursprung. Detta förbättrar säkerheten, men det första oberoende V2-provet är fortfarande underkänt på återfunna fält.
- Bankavvisningar har en sluten säker reasonkod. OCR-kön återupptas också efter godkänd CI på exakt aktuell main; en sådan körning får inte kallas periodiskt schemabevis.

## Verkliga efterkontroller

[Efterkontrollen](wave2-postpublication-observations.json) jämförs med [förekontrollen](wave2-prepublication-observations.json). En exakt vald rapport och två separata betalningsobservationer kontrollästes. Arbetsytans revision var 52 före och efter. Originalets storlek/kontrollsumma stämde; detta bevisar bytesens integritet, inte bankautenticitet.

Rapportens faktiska angivna betalare och generella referens överensstämde med sparade uppgifter. AIS-insättningens saknade betalare och referens förblev okända. Rapporten räknades inte som en extra insättning. `accountVerified=false`, `targetRelationProved=false` och 0 bokade fakturakopplingar kvarstod. Ingen generell referens märktes formell OCR. Detta uppfyller de avgränsade presentationskriterierna för 18/19 enligt [oberoende ombedömning](payer-reference-live-evidence-reassessment.md), utan att påstå bankstyrkt relation eller rätt kund.

[Publicerad browserkontroll](browser-wave2/publication64/README.md) bekräftade utloggat okänt läge, tydligt separat demo, preliminär översikt och tangentbordsresa sökning→öppna→Escape→återställt fokus. Bankdialogen visade `Registrerade kopplingar` och ingången `Fördela på flera fakturor`, med demoåtkomst korrekt spärrad. Ingen autentiserad produktionsresa eller fysisk mobiltest påstås.

Bankens enda revalidering efter publicering gav `BANK_ACCOUNT_SCOPE_INVALID` med `ACCOUNT_USAGE_INVALID`; anslutningen förblev frånkopplad. Senaste lyckade bankhämtning är 08:05:14.646 UTC. Bankgirokälla är fortfarande uttryckligen ej konfigurerad.

OCR-körning[42124413524](https://github.com/sharbel0022/Mgeorge/actions/runs/42124413524), event`workflow_run`, behandlade 6 underlag med 0 körfel 22:47–22:49. Gmailstatus visar färsk molnarbetare,368 underlag för granskning och 41 väntande OCR, med senaste Gmailhämtning 21:58:47 UTC. Denna OCR-körning är CI-utlöst; senaste observerade periodiska OCR-körning är fortfarande 18:23. `background_ready=false` och `external_schedule_unverified` bevaras.

Backupsnapshoten den 5 november är fullständigt kontrolläst:362/362 original,142 968 213 byte, verifierad 16:55:10 UTC. Senare importer ingår inte. Den tidigare isolerade återställningsövningens lokala RTO och simulerade RPO behåller sin tydliga avgränsning.

## Kvar för 8 i samtliga områden

| Område | Kvarvarande konkret krav |
| --- | --- |
| 6 Minimal manuell hantering | Normalfall genom hela avsedda kön med verklig progress och säkert nästa steg. |
| 10 Bild-OCR | Ny generell förbättring och nytt fryst oberoende första prov. V 2 första:100% precision,60% mandatory recall,0/10 kompletta normaldokument. |
| 15 Swedbank | Förklara verklig kontoanvändningsavvisning och få aktuell godkänd anslutning till rätt konto. |
| 16 Automatisk bankhämtning | En färsk lyckad behörig körning med korrekt konto, period, dubblettskydd och nästa tid. |
| 28 Schemaläggning | Observera aktuell periodisk OCR-körning och korrekt sen-/spärrstatus. CI-triggad återhämtning räcker inte. |
| 33 Produktion | Slutföra relevant bank-/normalflödesverifiering med samma ekonomiska skydd. |

Fortsatt parser- och geometriförbättring är separat från denna release. V1/V2:s första underkända resultat och första underkända CI/review ligger kvar. Inga betyg har höjts enbart för att antalet tester ökade.
