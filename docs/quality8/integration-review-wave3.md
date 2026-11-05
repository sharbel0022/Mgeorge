# Wave3: fortsatt OCR- och bankdiagnosarbete

Status vid 2026-11-05 23:10 UTC: **inte publicerad**. Den publicerade versionen är fortfarande Site64/main819adee med den separata aktuella33-bedömningen27/33≥8. Detta dokument är en integrationslogg, inte ett nytt godkännande av OCR eller banken.

## Integrerad och avgränsat verifierad parsning

| Ursprung | Integrerad commit | Omfattning |
| --- | --- | --- |
| e653a8d | 09e9c45 | Två tidigare auktoriserade optiska efterdiagnoser på kända V2-bilder; frysta råsvar och mätkvitton, inte nytt hållprov |
| abe5c1e | e36a186 | Explicita moms-/totaletiketter och leverantörsroller; ursprunglig NOT READY-review bevarad |
| ae56dc9 | 0ddba8b | Gemensam monetär fältgrammatik, full konkurrerande evidens, okända namn-/orggränser |
| 8271da8 | 90791a7 | Oförändrad oberoende64-matris och historiskt underkänt resultat |
| def09e9 | 5e74af0 | Oberoende READY för exakt ae56;32 ytterligare motprov |
| b020d02 | bb73204 | Läsande bankdiagnos på publicerad819adee,62 rena syntetiska policyfall, ingen ny bankkontakt |

Alla fyra integrerade parserfiler jämfördes byte för byte med den oberoende granskade ae56-källan. Hashar:

- src/invoice-extraction.js: 4acea4e1afb431fcd8457eed1cc1e3a384b546af6f93895810274d3538a7a11d
- src/invoice-details.js och sites/lib/invoice-details.js: 055c0e746502cc5151e140e123e1b0e59117c078168fced46bd0654220ed6ce4
- sites/lib/invoice-fields.js: f22fe3cdc4f5456e620d8d50e9f8c5bf9b857a9938586a4fb45608e0841176e6

Root körde den integrerade56+80+64+32-matrisen med direkt Node24.22.1, NODE_ENV=test, befintlig nätverksspärr och test-concurrency=1: **232/232**,0fel/skip/cancel/TODO,3264.275308ms. Testfilerna är invoice-v2-explicit-grammar, invoice-grammar-boundaries, review-v2-explicit-grammar-independent och review-v2-grammar-followup-independent. Inga OCR-anrop ingår. Två tidigare root-kommandon stoppades redan vid teststart på fel relativ preloader-sökväg respektive saknat NODE_ENV; de körde inga assertions och räknas inte som produktfel eller godkända testkörningar.

## Oberoende bedömning av publicerad release

Betalningsgranskaren kontrolläste Site64-kvitto och33-bedömning vid5e74af0. Inga Critical/Important dokumentfynd; två Minor stängdes i b9b8cf2:

1. Bankrelationen beskrivs uttryckligen som ännu obevisad.
2. Periodisk drift ligger under område28, inte som ett extra krav för område6.

Poängen27/33,256,5/330 och återstående6/10/15/16/28/33 ändrades inte. Leveransens tre källhashar och det identiska nativeSites-trädet verifierades.

## Förseglat nästa bildprov

Fryst separat corpuscommit: e2b61ae7504d07f2753e575eeddec8bf5966da84. Tolv normalbilder och två separata stressbilder,1600×2000. Ingen OCR eller produktparser körd vid frysningen. Root och implementationsteamet har bara metadata, inte bilder/facit/generator.

- Dataset SHA256: 85014b30c976ac45356a8c4ea9454c6f804a9938c9faf610e686a200ec1f673b
- Manifest SHA256: e4298dd83ccba9ea283d41672597029656d3401a879cb7f507f53677f4c8226e
- Gold SHA256: e1cfc1ad5e3445b2e843a93777b8d56e7ab86a4633abae805199fa511e3d5048
- Mätkod SHA256: 42a498b2df4a6256c7dbe177be0a3a27277f82355adeddf8439a47e30202ab6e

Alla13/mandatory10/image9 har nämnare156/120/108 per parser. Förregistrerad bedömning kräver≥98% precision och≥85% recall för de två första, noll kritiskt falskt grönt och avstående på båda stressbilderna. Dokumentnivå och image9 redovisas separat. Exakt källbindning och första optiska mätningen återstår efter oberoende READY.

De första V1/V2-resultaten är orörda:
V1 SHA25691e1bfd75277c0175a4145739e70759fa9f65b900a75d94dcf94e131b5e59c46,
V2 SHA25613557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7.

## Kvar före leverans

Separat geometri och mer precis usage-diagnos är ännu under implementation/granskning. Ingen ny bankpolicy eller kontotyp normaliseras för att få ett godkänt resultat. Exakt full CI, normal merge, nativeSite-publicering och avgränsad verklig efterkontroll återstår för nästa release. Resultat från kända V1/V2-underlag ska märkas utvecklingsregression, inte oberoende acceptans.

## Leveranskandidat, 23:27 UTC

Bankdiagnostik `1b2089840efd953070b0eb021b63721e57d69400` är integrerad som `cbc2113`. Root har läst alla tre produktdiffar och den oberoende 256-kombinationsgranskningen. Endast ett privat, genuint fel från just revalideringens eget valideringsanrop kan få fasta usage-räknare efter befintlig ägar-/leasebunden failed-event. Strikt validerare och affärspredikat är oförändrade. Ingen ny statusyta eller bank-/databasförfrågan införs.

Roots integrerade återkontroll: 34/34 nya policyfall och 25/25 verkliga service-/HTTP MCP-fall, 0 fel/skip/cancel/TODO. Körningarna tog 179.58424 ms respektive 8315.113265 ms. Tillsammans med de separata 232 parserfallen är detta 291 riktade gröna tester; full CI återstår och dessa får inte adderas en gång till efter den.

Oberoende review av den **separata, ej integrerade** geometrin `6d6968d` hittade ett Important-fynd: en kolonförsedd ny mottagarroll kunde svälja en annan ofullständig roll/okänd kolonetikett och ge falskt grönt i native PDF. Den geometrin ingår därför inte i denna leveranskandidat. Korrigering och återreview pågår i separat branch.

Den nya sparad-text-regressionen på exakt `635ca5e3bcf3c1c8ecff16b192a44cde35175d69` gjorde 0 OCR och 24 parseranrop. Per motor: all13 85TP/0FP/45FN, mandatory10 63TP/0FP/37FN, image9 53TP/0FP/37FN, 1/10 exakta normaldokument. Resultatet är en känd utvecklingsregression och ligger långt under recallkravet; [rapport](ocr-v2-stored-text-reparse-report.md). Första V2-resultatet förblir oförändrat FAILED. V3 hålls förseglat.

