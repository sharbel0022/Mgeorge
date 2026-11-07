# MG Fakturakoll — slutlig integration och releasegrindar

Källinventering och integration uppdaterad 2026-11-07 00:02 UTC. **Den begärda 9,5-releasen är inte godkänd. Målet 314/330 är inte styrkt.** Detta dokument fryser underlaget före den kombinerade slutkörningen; aktuella slutresultat och exakt slut-SHA redovisas i [PR63](https://github.com/sharbel0022/Mgeorge/pull/63) och Agent 6:s slutrapport.

## Verifierad bas och publicerad produkt

Main är `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`, tree `c1912a91e44ecaca7095dcaca1201c3904df87d7`. Publicerat är fortfarande **Site 69**, native commit `1df8cb96eda374f2506c81aa776263388ddb666a`, miljörevision 10. Integrationsarbetet har inte skrivit produktionsdata, ändrat medgivanden eller publicerat en ny produktversion.

## Sammanförda leveranser

| Ordning | Leverans | Granskad head | Integration |
| --- | --- | --- | --- |
| 1 | [PR66, SaaS och säkerhet](https://github.com/sharbel0022/Mgeorge/pull/66) | `c85f2375` | `c6bb149b` |
| 2 | [PR67, Gmail/OCR](https://github.com/sharbel0022/Mgeorge/pull/67) | `b2178405` | Produkt från `57abcd8` i `b9081cf`; sista testdeltat ingår i denna slutkandidat |
| 3 | [PR64, OpenAI](https://github.com/sharbel0022/Mgeorge/pull/64) | `ce6fa615` | `7a2fb40c` |
| 3a | [PR69, oberoende AI-rättningar](https://github.com/sharbel0022/Mgeorge/pull/69) | `38d731c0` | `a6171086` |
| 4 | [PR65, bankåterhämtning](https://github.com/sharbel0022/Mgeorge/pull/65) | `9529701a` | `8dfcd8ec` |
| 5 | [PR68, Bankgiro/avstämning](https://github.com/sharbel0022/Mgeorge/pull/68) | `7cbcba72` | `124e452d` |

Alla nya produktändringar är sammanförda i integrationsgrenen, inte i main. De nio äldre 95-grenarna var redan förfäder till bas-main och räknas inte som nya integrationer. [Exakta SHA, beroenden och granskningsdimensioner](integration-matrix.json).

## Faktiska granskningsfynd

- AI måste återkontrollera behörighet före varje providerrequest och avstå från ny debitering efter ett accepterat dokumentkvitto. Tvetydiga genereringsfel får inte automatiskt skickas igen. Kostnadsredovisningen måste bevara okänd kostnad vid oväntat cacheutnyttjande.
- Ett återställt kostnadsregister får inte återanvända gamla budgetar. Ny snäv läskapabilitet genom befintliga företagsgränser blockerar AI både under återställning och efter bankens återhämtning. Förlust av redan obligatoriska centrala kontrolltabeller blockerar också AI. Ingen funktion häver AI-spärren.
- Gmail/OCR:s riktiga worker och AI-tolkning behövde en gemensam regression. Den reproducerade ett saknat dynamiskt modulalias i testfixturen. Efter rättning verifieras att aktiverad AI utan godkännanden inte kontaktar provider och att förlorad kvittens återhämtas med exakt ett sparat resultat.
- Bankgrenens två nya säkerhetsfiler riskerade att falla bort vid SaaS-grenens centralisering. Testet mot den verkliga säkerhetskörningens kvitto gick först rött; båda filerna finns nu i det gemensamma omfånget och regressionen passerar.
- Sista Gmail-teständringen skiljer korrekt mellan legacy och receipt-v2. Legacy måste fortfarande rapportera osäker leverans. V2 får räkna ett matchat varaktigt kvitto. Båda kräver ett enda completion-anrop och oförändrade original/historik.

[Oberoende granskning och begränsningar](reviews/agent6-final-integration.md). [Elva bevarade lokala fokusloggar med SHA-256, verkliga RED/GREEN och exakta källträd](evidence/agent6-review/verification.json). Fokusresultat överlappar fullsviter och ska inte summeras som unika scenarier.

## Slutlig CI måste avse samma källa

Obligatoriskt på den frysta PR-kandidaten:

1. Payment control: Node 22 och 24, full Sites med typer/produktionsbygge, Bankgiro bridge, Chromium samt 1/10/100 företag.
2. SaaS security acceptance: både säkerhetsjobbet och **full_synthetic_recovery**, inklusive råbevisverifiering mot den faktiska checkout-SHA:n.
3. SaaS readiness: nyckelfiler på Node 22/24 samt sessioner, migreringar och återställningsproveniens.
4. OpenAI invoice checks: riktiga adapter-/integrationskontrakt och faktiskt optiskt utvecklingsprov. Ej tillgängliga live-AI-armar måste stå som ej mätta.

Den tidiga extra `final95-recovery.yml` tas bort eftersom PR66 nu kör den fullständigare 430-originalsövningen med 22 negativa kontroller och strikt proveniens i ordinarie säkerhetsworkflow. Den tidiga lyckade körningen [42308817867](https://github.com/sharbel0022/Mgeorge/actions/runs/42308817867) är historiskt bevis, inte slutkandidatens kvitto.

GitHubs PR-CI checkar ut en merge-ref. Rapportera både PR-head och den faktiska checkouten, och verifiera identiskt filträd. Kontrollera noll fail/cancel/skip/TODO, rena/oförändrade källmanifest och artefakthashar. Tidigare gröna PR-körningar ersätter inte den slutliga kombinationen. Main saknar branch protection och repository rulesets vid denna observation; grön CI är inte mekaniskt tvingande mergepolicy.

## Färsk produktion och verklig acceptans

[Sanerad observation 23:59 UTC](production-observation-2026-11-06T2359Z.json):

- Gmail är anslutet, senaste lyckade fetch 22:28:06 UTC. Kö: 427 granskningsdokument, 47 väntar OCR och 4 PDF. 54 accepterade dokument under det senaste rullande dygnet; 0 aktiva, utgångna, uttömda eller felande jobb. Det förändrade dygnsantalet jämfört med tidigare observation är inte belägg för förlorade dokument.
- OCR:s senaste lyckade completion är 22:29 UTC. Vid 23:59 visas workern inte som nyligen aktiv. `background_ready=false`, `external_schedule_verified=false`, `ocr_worker_unavailable=true`.
- Ett verkligt schemalagt OCR-jobb [42304814299](https://github.com/sharbel0022/Mgeorge/actions/runs/42304814299) på bas-main gav 6 behandlade, 0 fel. Det styrker den körningen, inte regelbunden 15-minuterstakt eller extraktionsprecision. Gmail-automationens `no_update` saknar separat dispatchbevis.
- Swedbank: `connected=false`, `reauth_required`, `syncAllowed=false`, `BANK_RECONNECT_REQUIRED`. Sista sparade lyckade synk 2026-11-05 08:05 UTC. Inget bankanrop har gjorts av integrationsagenten.
- Bankgiro: `DISABLED / SOURCE_NOT_CONFIGURED`, behörighet `UNKNOWN`, 0 jobb. **0599 / 625,00 SEK är fortsatt overifierad** som verklig rapport–konto–fakturarelation.
- Riktig backup har 430/430 original, 185 567 855 byte och verifierat manifest 2026-11-06 00:48:58 UTC. Senare importer ingår inte i manifestet. Detta är inte ett nytt produktionsrestoreprov.
- Publik utloggad startsida inspekterades visuellt cirka 23:27 UTC: läsbar navigation, inloggningskrav, dolda belopp och inaktiva ekonomiska åtgärder. Autentiserad och responsiv produktions-UI är inte nyverifierad. En stor ekonomisk databasrespons trunkerades; fullständig ekonomisk före/efter-kontroll är [NOT_VERIFIED](financial-comparison-limit.json).

## AI, OCR och betyg

AI är avstängd som standard och kräver servernyckel, betrott företag, allowlist samt sekretess-, säkerhets- och kostnadsgodkännande. Profilerna anger `gpt-6-luna` och `gpt-6.1-sol`; faktisk projektåtkomst, livekostnad och liveprecision är inte verifierade. Återställd miljö förblir AI-spärrad tills kostnadsavstämning och uttrycklig återacceptans har ordnats.

Det faktiskt körda utvecklingsprovet på den tidigare granskade AI-kandidaten omfattade 4 syntetiska dokument: **46 TP, 0 FP, 6 FN av 52 förväntade fält**, precision 100 %, recall 88,46 %, kompletta dokument 1/4, granskning 4/4. Setet är tidigare använt och inte oberoende accepterat. AI-armarna mättes inte. Slutkandidatens workflow ska upprepa mätningen och redovisa sitt eget utfall. Den historiska oberoende 12-dokumentsmätningen (62/108 fält, recall 57,41 %) är en annan population och får inte blandas med utvecklingsprovet.

**Senaste konservativa produktbedömning: 258,5/330 = 7,83/10.** Inga nya poäng tilldelas för fler fixturetester eller opublicerade ändringar. En full 33-punktsbedömning med slutlig CI hör till slutrapporten.

## Nästa releasebeslut

Godkänn inte den begärda releasen enbart för att integrationen kompilerar och fixturetester passerar. Verifiera oberoende AI/OCR-acceptans, Gmail-dispatch och driftskadens, giltigt bankmedgivande och avtalad Bankgiro-källa, faktisk flerföretagsdrift, aktuell backup/rollback samt full ekonomisk jämförelse före och efter en eventuell kontrollerad publicering. Main-merge, main-CI och ny Sites-version återstår tills dessa releasevillkor kan styrkas.
