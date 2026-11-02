# GitHubrensning och sanningsenlig bankväntetid

Användarens nya uppdrag kräver aktuell branch-/arkivkontroll, åtgärdsspecifikt godkännande före destruktiva GitHubåtgärder och bankverifiering utan onödiga API-anrop. Basmain b44b092, Sites52/runtime9. Isolerad befintlig arbetskatalog används med detached HEAD; ingen ny utvecklingsbranch behövs.

## Bekräftade fakta

Alla fem fjärrbranchhuvuden är oförändrade och bevarade i privat komplett Gitbundle;11 refs/träd, mirrorrestore och strict fsck passerar även vid omkontroll. Main-CI41459045392 passerar847Node/1426Sites. PR9/10 är fortfarande öppna drafts. Tidigare konkret radering avvisades av automatisk godkännandekontroll; ingen ny radering eller indirekt kringväg får ske utan konkret godkännande.

Ägarbundna sparade original passerar. Ny revision42 efter befintlig schemalagd bankhämtning är inte en egen utvecklingsmutation. Faktura0599 saknas fortfarande med komplett registerkontroll. Bankens sista account_details429 hade ingen bevarad supplierdeadline. Sync nextAttemptAt gäller en annan beräknad plan/cooldown och får inte framställas som konto-GET-behörighet.

## Reproducerad intern rättning

Kontoläsarens catch tappar retryAfter/retryBlocked. Provideradaptern använder också60sekunders fallback utan proveniens; detta får inte kallas bankens uttryckliga väntetid.

Tillför en skrivfri, betrodd retrydiagnostik enligt den befintliga WeakMap-principen för schemadiagnostik. Endast faktisk429-parsning får skapa metadata. Ett stödjat explicit Retry-After ger en kontrollerbar väntetid med serverkontrolltid och korrekt proveniens. Saknad/ogiltig header ger okänd supplierdeadline; överstor väntetid ger manuell blockering och får aldrig trunkeras till en tidigare påstådd tillåten tid. Råheader, felmeddelanden, konton, UIDs eller getterevalueringar får inte läcka. Befintliga sync-fallbacks och cooldownbeteenden ändras inte.

Returnera detta till den ägarbundna kontoläsaren och visa sanningsenlig svensk nästa åtgärd i befintlig verifieringspanel. Ingen automatisk retry, schemalagd kontoåtgärd, permanent aliasbehörighet eller ny databas införs. Den senaste verkliga429-deadlinen förblir okänd; förbättringen kan inte återskapa en gammal header.

## Leverans

RED/GREEN, oberoende granskning, full Node/Sites/syntax/TS/audit/bygge, mainutanforce och exakt CI. Sitesändring publiceras i samma projekt med samma D1/R2/auth/runtime/scheman. Efterkontroll får använda ägda sparade original och status; inget nytt konto-GET görs för att demonstrera felrättningen.

Skapa docs/FINAL-BRANCH-CLEANUP.md och docs/FINAL-GITHUB-AND-BANK-VERIFICATION.md. Redovisa exakta brancher/godkännandestatus, aktuell väntetidsgräns och bankens saknade alias-/insättningsbevis utan känsliga originaluppgifter i Git.
