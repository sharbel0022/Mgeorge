# Mgeorge V2 publicering och testbevis

Den 28 oktober 2026 publicerades **Sites version 27** på [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site).

| Kontroll | Resultat |
| --- | --- |
| Sites publicering | `succeeded` |
| Sites källcommit | `52363e69d630595160052d4c4244acc7f12934e0` |
| Sites deployment | `appgdep_6ae2573d5c2c81919e8ce96957620fbf` |
| Sites projekt | `appgprj_6adf2f7f7e848191b64192161886b528` |
| Node tester | **238 av 238** godkända |
| Sites tester | **277 av 277** godkända |
| JavaScript syntaxkontroll | **50 filer** godkända |
| TypeScript | Godkänd |
| Sites produktionsbygge | Godkänt genom Sites byggverktyg |
| Beroendegranskning | **0 kända sårbarheter** i båda apparna, inklusive utvecklingsberoenden |
| Källparitet | Samtliga **234** versionshanterade `sites/`-filer identiska med den paketerade Sites-källan |
| Node datamigrering | Additiva kolumner för original och referensbelägg; befintliga data bevaras |
| Sites datamigrering | Ingen ny D1-migrering; nya arbetsytefält är valfria |

515 automatiserade tester omfattar referenskonflikter, saknade OCR-fält, betalningsriktning, flera fakturor med samma belopp, dubbletter, fullständig importrollback, ägaråtkomst, sessionsbortfall, Gmail, PDF/OCR, bevarade original och återställning av krypterad backup. Integrationssvaren är kontrollerade; de verifierar inte nya verkliga bank- eller Google-medgivanden.

Lokal webbläsargranskning använde en isolerad Workers-miljö och appens separata demoläge. Desktop- och mobilöversikt, alla bankposter, samlingspostens saknade OCR och granskningslistans växling till detalj och tillbaka verifierades. Mobilöversikten hade lika stor dokument- och scrollbredd, 390 px. Granskningsdetaljens motsvarande värden var båda 375 px vid samma mobiltest; ingen yttre överrullning uppstod. Bilderna i `docs/v2/` innehåller fiktiva ekonomiska uppgifter.

Publiceringen bevarar den befintliga åtkomstpolicyn, användaridentiteten, D1/R2-bindningarna och runtimehemligheterna. De två befintliga molnschemana var pausade och har inte återaktiverats. Inga verkliga kundmejl eller bankbetalningar skickades som del av verifieringen. Bankens individuella betalningsspecifikation krävs fortfarande när OCR inte finns i det auktoriserade underlaget.

GitHub-leveransen finns i `main`. Övriga lokala och fjärrbrancher rensas efter leveransen enligt beställningen. En fullständig lokal Git-bundle bevarar alla referenser före rensningen i den Git-ignorerade mappen `.codex-work/`; den innehåller källhistorik, inte en backup av företagets ekonomidatabas.
