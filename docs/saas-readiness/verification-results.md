# Verifieringsresultat — frysta regressioner och slutgrind

[PR 66](https://github.com/sharbel0022/Mgeorge/pull/66) innehåller de aktuella fulla CI-kontrollerna. Den här filen bevarar observerade utvecklingsresultat med exakt källa. En senare dokumentationscommit får egna kontroller; den är inte automatiskt samma körning som de frysta resultaten nedan. Slutlig CI-status och jobb för PR:ns aktuella huvudcommit ska anges i PR-beskrivningen innan integration.

Baslinje: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Lokal exekveringsmiljö blev otillgänglig; alla listade resultat är observerade GitHub Actions-körningar med syntetiska data.

## Reproducerade regressioner

| Kontroll | RED före rättning | GREEN efter rättning | Faktiskt körd omfattning |
| --- | --- | --- | --- |
| Privat nyckelfil | [47d9359, jobb 128199701361](https://github.com/sharbel0022/Mgeorge/actions/runs/42307283132/job/128199701361): 4/14, 10 fel | [1eba506, Node 22](https://github.com/sharbel0022/Mgeorge/actions/runs/42307532599/job/128200554569) och [Node 24](https://github.com/sharbel0022/Mgeorge/actions/runs/42307532599/job/128200554197): 14/14 vardera | Samma 14 tester i två runtimes. RED-jobbet slutfördes trots att den övriga push-körningen senare avbröts. |
| Sessionscookies | [7ae959f, jobb 128203695537](https://github.com/sharbel0022/Mgeorge/actions/runs/42308462021/job/128203695537): 4/11, 7 fel | [4f703b3, jobb 128205377402](https://github.com/sharbel0022/Mgeorge/actions/runs/42308964853/job/128205377402): 11/11 | Verklig HTTP och två SQLite-företag; 11 ingående tester i det kombinerade jobbet. |
| Företagsversion | [34466a0, jobb 128204157754](https://github.com/sharbel0022/Mgeorge/actions/runs/42308595454/job/128204157754): 2/9, 7 fel | Samma GREEN-jobb på 4f703b3: 9/9 | Sju ogiltiga versioner, replay och samtidiga val. |
| Återställningsproveniens | Samma RED-jobb på 7ae959f: 3/14, 11 fel | Samma GREEN-jobb på 4f703b3: 14/14 | Ändrade kvittofält/källfiler; autentisk baseline och ekonomiska referensmotprov. |
| Sparat återställningskvitto, oberoende review | [ee1e714, jobb 128206341547](https://github.com/sharbel0022/Mgeorge/actions/runs/42309256114/job/128206341547): 104/112, 8 fel | [d2cad86, jobb 128208396473](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880334/job/128208396473): 112/112 | Åtta nya negativa kvittofall ingår i totalt 67 tester av releaseverifieringen. |

Kombinerade RED-jobb: 7ae959f körde 25 tester med 7 godkända/18 fel; 34466a0 körde 34 med 9 godkända/25 fel. Det första kombinerade GREEN-jobbet körde 104/104. Efter de åtta ytterligare motproven och rättningen kördes 112/112. Dessa är överlappande sviter och ska inte summeras till ett större oberoende testantal.

## Senaste frysta fokuskandidat

Huvudcommit `d2cad86a65237ae7a7bbaf2e1d8bc72de847d111` testades som PR-merge `bad0a67b1e61c562c420f4e53f391c136c07e662`, träd `235fb2d55ffeabeb735882fa59db40e0aab157f5`.

| Del | Observerat resultat |
| --- | --- |
| Nyckelfilsgrind | 14/14 på Node 22.23.4 och 14/14 på Node 24.22.1 i [run 42309880334](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880334). |
| Kombinerad fokusgrind | 112/112; noll fail/cancel/skip/TODO; 5 989,683 ms. |
| Releaseverifiering | 67 tester inom fokusgrinden; inkluderar tomma/partiella/ändrade/stale/felaktigt bundna kvitton. |
| Samlad säkerhetsacceptans | [Jobb 128208396775](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880196/job/128208396775): Node 481/481 och Sites 1 244/1 244, totalt 1 725; separat kvittoverifierare godkänd. |
| Full Node-kvalitet | [Node 22](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880197/job/128208516108) och [Node 24](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880197/job/128208516198): 3 113/3 113 vardera samt syntax och båda audit-stegen. |
| Migration | Två nya tester inom fokusgrinden: fullständig ordnad journal och beständig upgrade/adoption/omstart med bevarande och spärr mot gamla skrivningar. |
| Samtidighet | 1/10/100 företag; faktiskt uppmätta samtidiga toppar 1/5/5 även vid replay. |
| Formatåterställning | 1/1 samlat formatprov med PDF, PNG, CSV, XML och XLSX; alla fem parsers accepterade före/efter. [Kvitto](evidence/recovery-format-fidelity.json). |
| Full isolerad återställning | 430 original, 185 567 855 byte, 27 tabeller, 430 hashkontroller, 22 avvisade negativa fall; 3 080,262 ms från lokal bunt till oberoende acceptans. [Full rapport](backup-recovery.md). |

Samtidighetens första körning tog 14,64 / 60,43 / 480,09 ms för respektive 1/10/100 företag; replay tog 5,49 / 46,42 / 394,37 ms i denna fokusmiljö. Detta är en mätning av databas/planerare och syntetisk providerstub, inte bank- eller Internetprestanda.

## Sparad evidens

- [Nyckelfil RED, Node 22](evidence/private-key-red-node22.tap), [GREEN Node 22](evidence/private-key-green-node22.tap) och [GREEN Node 24](evidence/private-key-green-node24.log).
- [Session/proveniens RED](evidence/session-recovery-red-node24.tap), [företagsversion RED](evidence/company-selection-red-node24.tap) och [första kombinerade GREEN](evidence/security-recovery-green-node24.tap).
- [Strikt kvitto RED](evidence/release-receipt-red-node24.tap) och [GREEN](evidence/release-receipt-green-node24.tap).
- [Full restore: källa och utgång](evidence/recovery-d2cad86-receipt.json), [återställningsresultat](evidence/recovery-d2cad86-result.json) och [formatbevis](evidence/recovery-format-fidelity.json).
- [Maskinläsbart index](evidence/index.json) kopplar de normaliserade loggarna till originaljobb och testade commits.

TAP-utdragen har fått GitHubs radvisa tidsstämpelprefiks borttagna. Node 24:s första nyckelfilsjobb använde spec-reporter och sparas därför som `.log`, inte som påstådd TAP. Återställnings-JSON är det rapporterade syntetiska aggregatet. Originalnycklar, krypterade buntar och originalfiler läggs inte i repositoryt.

## Slutlig releasegrind

Full Node 22/24, Sites typkontroll/tester/production build, låsta installationer/audit, bridge, Chromium och syntetisk prestanda ska vara gröna på aktuell PR-källa. Därutöver krävs `security_acceptance`, `full_synthetic_recovery` och fokusgrinden. Artefaktens källa, checkout/head/base, utgång, tidsfönster och testmanifest ska stämma. [Releasegrindarna](release-gates.md) beskriver exakt kontroller och återstående administrativ enforcement.

De frysta resultaten bevisar de angivna regressionerna och den isolerade övningen. De är inte regulatoriskt godkännande, ett slutligt produktionsbetyg eller bevis för verklig nyckelförvaring, faktisk bankbehörighet eller produktionens RPO/RTO.
