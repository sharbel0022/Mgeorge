# Mgeorge V4 – godkänd main och Sites-publicering

Publicerad 29 oktober 2026 efter användarens uttryckliga instruktioner att pusha till main och publicera V4 på den befintliga Sites-sidan.

## Leveransidentitet

- PR #13 mergad till main: `fdbfec48b8c14ea330f9fb66ac3911739c08b030`.
- Sites-källrepository synkroniserat med samtliga 263 spårade filer i main:s `sites/`; bytejämförelsen passerade före bygg och paketering.
- Pushad Sites-källcommit: `de8f49f924b8afde4772cba814b300e4dc41399d`.
- Samma projekt: `appgprj_6adf2f7f7e848191b64192161886b528`.
- Publicerad Sites-version: **31**.
- Sparad version: `appgprj_6adf2f7f7e848191b64192161886b528~appgver_b454b3b7ac20819192cc260b714f858b`.
- Deployment: `appgdep_6ae285148e748191a29d0f6134f44a93`, **succeeded**.
- Runtime-revision för miljövariabler/hemligheter: **9**, samma som föregående publicering.
- Adress: [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site).
- Lokalt pakets SHA-256: `057ba8b0dac4a3c32e6a9681595b1fe812e30415ab0fbbc765d3d91973e5482b`.
- Sites normaliserade arkivhash: `sha256:f96292fd593d49596c9120f13d1067b1a9bfcddeb87e8177635f8130ca6d49e4` (325 filer). Detta avser plattformens normaliserade arkiv, inte det lokala gzip-paketets bytehash.

## Verifiering och bevarande

De fullständiga kodsviterna och CI före merge är dokumenterade i [V4-leveransen](V4-DELIVERY.md): 312 Node-tester, 394 Sites-tester och beroendegranskning utan kända sårbarheter. TypeScript och produktionsbygget kördes även framgångsrikt i Sites-källcheckouten före paketering. Det exakta pushade källtillståndet byggdes/paketerades med Sites officiella källhelper och sparades före deployment.

Arkivet innehåller de additiva migrationerna 0012–0013. Sites ordinarie publicering ansvarar för migrationssteget före Worker-upload; ingen separat SQL-körning, backfill, databasåterställning eller radering begärdes. Manifestet behåller D1-bindningen `DB`, R2-bindningen `BUCKET`, MCP-funktionen, samma projektidentitet och befintligt åtkomstläge. Inga runtimehemligheter ändrades.

Läsande efterkontroller bekräftade version 31, samma URL/ägare/åtkomstläge och samma tre aktiva scheman med oförändrade ID:n för bank, Gmail och backup. Bankstatus visade ansluten, automatiken aktiverad med sex timmars intervall, inga fel, inga förbrukade felåterförsök och ingen väntande efterkontrollvarning. Senaste lyckade bankhämtning var oförändrad: `2026-10-28T22:33:25.913Z`. Backupstatus visade fortfarande den kompletta och verifierade backupen med 37/37 original. D1-översikten svarade med befintlig `DB` och användartabeller utan att några ekonomirader exporterades.

Ingen manuell bank-/Gmail-hämtning, betalningsavstämning, dokumentbearbetning, ny backupkörning, bankbetalning eller kundsändning anropades som publiceringstest. Befintliga scheman fortsätter enligt tidigare konfiguration. Plattformens lyckade publicering och läsande driftstatus verifierar leveransen, inte en verklig individuell Swedbankrapport eller fullständig bankavstämning.

## Rollback och kvarstående extern blockering

Föregående publicerade version 30 finns kvar som `appgprj_6adf2f7f7e848191b64192161886b528~appgver_0d550318d4fc8191b98a3ebee3b7f9ad`, med källcommit `52aefc7d20b9642a5ff0171048b25c1dd9301f6c`. En kontrollerad kodrollback ska använda samma projekt, D1/R2, original och nycklar samt lämna de nya kolumnerna kvar. Ingen destruktiv databasåterställning får användas automatiskt. Äldre kod saknar V4:s nya spärrar för väntetid/felräknare; eventuell rollback måste därför ta hänsyn till sparade bankspärrar och de befintliga schemana.

Användaren har bekräftat att företagets avtals- och rapportuppgifter saknas ännu. Autentiskt individuellt bankoriginal, exakt MIG/XSD/OCR-regel och behörig rapportkanal är därför fortfarande inte verifierade. [Den exakta blockeringsrapporten](V4-SWEDBANK-CHANNELS.md) gäller även efter version 31.

**EXTERN BLOCKERING – INTE FULLSTÄNDIGT PRODUKTIONSVERIFIERAT.** Publiceringen är klar; målkraven om faktisk betalaridentitet och verkligt bankflöde får inte markeras som uppfyllda på grund av denna deployment.
