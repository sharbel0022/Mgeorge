# Stabilisering och säker branchrensning

Aktuellt användarmandat omfattar självständig felsökning, tester, granskning, main-push, befintlig Sites-publicering och säker branchrensning. Inga verksamhetsmutationer, kundutskick, bankbetalningar eller produktionsåterställningar ingår.

Bas: aktuell origin/main a4f09b86ba3261cce36c58debebaef694fd25a9c, Sites51/runtime9. Befintlig isolerad arbetskatalog återanvänds; ny lokal arbetsbranch codex/final-main-cleanup. Befintliga privata original stannar utanför Git.

## Vald väg

Rätta reproducerade grundorsaker i befintliga motorer med avgränsade regressioner. En ny betalningsmotor eller bred omstrukturering skulle öka risk utan att lösa de observerade felen. Arkivera samtliga branchhuvuden privat och verifiera återställning innan radering; ett arkiv i det publika repositoryt är inte privat. Ändra inga produktionshemligheter eller databasscheman.

## Konkreta fel

1. Node-restore öppnar den nya målfilen med SQLite och kan spela upp en redan existerande främmande WAL, trots verifierat arkiv. Återställningen ska vägra befintlig målfil/sidecars inklusive symboliska länkar och får inte verifiera målbytes genom en osäker SQLite-öppning. Verifiera arkivet isolerat, skriv exklusivt och kontrollera levererade bytes; främmande data får aldrig rapporteras som korrekt återställd.
2. Node autentiserar före väntan på JSON-kroppen. Logout under väntan stoppar inte alla efterföljande mutationer. Skyddade anrop måste återkontrollera samma levande session efter asynkrona gränser och före skrivning/extern sidoeffekt. Login, lokal administratör och redan korrekt fencade bankflöden ska behålla sina avsedda regler.
3. Vanliga dokumentvyn saknar workspace-refresh efter Gmail-åtgärder som kan registrera fakturor. Vyn ska invänta/meddela rätt uppdatering utan nya ekonomiska operationer.
4. Äldre bankförslag överlever revisionsbyte och misslyckad kandidatförfrågan. Förslag ska vara bundna till aktuell revision och inte återkomma från sena svar.

## Brancher och drift

Fem fjärrbrancher utöver main har inventerats; tre är ancestry-integrerade. Två öppna draft-PR:er kräver granskning och privat bevarande av unikt arbete innan beslut. Kontrollera exakta SHA, protection, aktuella PR:er/workflows och återställningsarkiv före radering. Bevara okänd/aktiv/skyddad utveckling. GitHub-anslutningen kan skriva kod men har inget branch-delete-verktyg; vanlig Git-write saknar autentisering. Använd endast behörig tillgänglig alternativ yta och redovisa verkliga verktygsgränser.

Bankfallet förblir beroende av bankstyrkt kontorelation, insättningsidentitet och valuta/datum. En lyckad backup-manifestscan är historisk kontroll över flera anrop, ingen atomisk garanti mot senare R2-förändringar.
