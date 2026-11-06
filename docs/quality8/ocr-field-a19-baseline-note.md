# Känd OCR-regression på den granskade a19-kandidaten

Detta är en bevarad producentkörning av redan kända indata på exakt `a19e0a8ce7a7ddedb85de1a8f9e21b617ba90b77`: 52 parseranrop och **0 optiska anrop**. Körningen är varken ett oberoende hållprov eller ett nytt acceptansprov. [Hela rårapporten](ocr-field-a19-baseline.json) har SHA256 `15e1c73339c6bcaf505d1dc89d24fb29685bd58de009a52e35831d8352a2f1a7`.

Med sparad PSM3-text från V2 är mandatory-resultatet **57/100**, och alla 13 fält ger **79 rätt, 0 felaktiga och 51 saknade**. Detta är lägre recall än känd omtolkning på Site 65 (63/100 respektive 85/130): de striktare organisations-/rollgränserna avstår från sex tidigare återfunna värden. De säkrare ägargränserna är granskade, men detta får inte beskrivas som en recallförbättring eller som uppfyllt OCR-mål.

Den sparade PSM6-replayen på samma a19 ger **50/100 mandatory**, och alla 13 fält ger **60 rätt, 2 felaktiga och 70 saknade**. Båda felvärdena gäller `kind=other` på redan röda dokument. PSM6 införs inte som produktionsläge. Ingen kritisk felaktigt grön faktura uppstod; stressfallen förblev avvisade.

De fem aktuella parser-/layoutfilerna i integrationskandidaten har kontrollerats mot rapportens a19-hashar. Rapportens bredare statiska importinventering beskriver producentens a19-träd, inte ett påstående att alla servicefiler i integrationen är oförändrade. Det separata arbetet med full rå ordevidens är ännu inte levererat. V3 är orört och förseglat. Område 10 behåller 6,5; första V2-resultatets 60 % mandatory recall står kvar som historiskt förstaprov.
