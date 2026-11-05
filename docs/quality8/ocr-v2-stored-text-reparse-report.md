# Känd V2: omtolkning av sparad text

**Utvecklingsregression, inte ett nytt hållprov.** Första V2-resultatet är oförändrat FAILED. Denna körning gjorde 0 OCR-anrop och 24 parseranrop på de oförändrade historiska optiska observationerna. Ingen ny geometri rekonstruerades.

Källa: `635ca5e3bcf3c1c8ecff16b192a44cde35175d69`. Runner fryst i `41632dd` före körningen. Originaltext, faktisk konfidens, ordbevis och bildhash gavs oförändrade till båda verkliga parsrarna. Alla källhashar och originalbevis förblev stabila.

| Omfattning, per parser | TP | FP | FN | Precision | Recall | Helt korrekta normaldokument |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all13 | 85 | 0 | 45 | 100.00% | 65.38% | 1/10 |
| mandatory10 | 63 | 0 | 37 | 100.00% | 63.00% | 1/10 |
| image9 | 53 | 0 | 37 | 100.00% | 58.89% | 1/10 |

Node och Sites har identiska utfall. Båda stressbilderna avstår och inga kritiska falskt gröna resultat uppstår. Det första provets mandatory-recall var60%; omtolkningen är63%. Tre ytterligare obligatoriska fält återvinns, men85%-kravet är fortfarande långt ifrån uppfyllt. Ingen poäng höjs av denna omtolkning.

[Fullständigt resultat](ocr-v2-stored-text-reparse-result.json), [körbar runner](../../scripts/quality8/reparse-v2-stored-observations.mjs).

Fortsatt generell optisk-/layoutanalys på den redan kända populationen krävs. Det separat frysta V3-provet hålls orört tills en granskad kandidat har trovärdig återvinning; V3:s facit eller bildinnehåll används inte i denna utvecklingsanalys.
