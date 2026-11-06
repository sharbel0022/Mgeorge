# Oberoende policygranskning av 638c7736

Granskad commit: `638c77365dbf8f4c73db6b23816a37f577da5689`. Egen arkiverad snapshot. Ingen produktkod har ändrats och inga produktions- eller bankanrop har gjorts. Den tidigare förlorade reviewen ingår inte i denna rapport.

## Beslut: ett Important-fynd

### P1 — Motsägande primäridentifierare kan ge `observed/orga`

**Källa:** `sites/lib/bank-consent-policy.js`, `primaryIdentifiers` och `observeAccountUsageDetails`, raderna 147–184. Den aktuella filen har verifierats mot `git show` för exakt commit ovan.

`primaryIdentifiers` kan returnera flera olika värden för samma primära identifierarschema. Observatören jämför sedan varje sparad/aktuell resurs endast mot det färska detaljsvaret. Den kontrollerar inte konflikter inom en resurs eller mellan sparad och aktuell resurs när färska identifierare saknas.

Ett äkta planerat, valt null-konto med identiska sparade, aktuella och färska primärhashar får därför `observed/orga` i följande tre rent JSON-baserade fall:

1. Färskt `account_id` anger `iban: A` och samtidigt `other: {scheme_name: 'IBAN', identification: B}`, där A och B skiljer sig. De tidigare resurserna saknar jämförbar IBAN. Den riktiga `getAccountDetails`-adaptern accepterar också detta svar.
2. Sparad resurs anger BBAN A, aktuell sessionsresurs anger BBAN B, och färskt `account_id` saknas.
3. Sparad resurs innehåller två olika primära IBAN-värden och färskt `account_id` saknas.

Alla tre ger faktiskt `{status: 'observed', category: 'orga'}`; motproven kräver `{status: 'unavailable', reason: 'DETAILS_ACCOUNT_CONFLICT'}`. Fallet med två motstridiga färska IBAN har dessutom reproducerats genom den oförändrade riktiga adaptern, ett mockat HTTP-JSON-svar och den riktiga policyobservatören.

Designen kräver att ingen uttrycklig primäridentifierarkonflikt finns innan uppgiften räknas. Felet kan därför göra diagnosen missvisande trots att primärhasharna stämmer. Reproduktionen gäller diagnostiken, inte en bevisad kringgång av auth, 409 eller anslutningsaktivering. Föräldrareviewern genomför separat ordinarie service-reproduktion.

**Rättningsriktning:** upptäck olika värden för samma primära schema inom varje resurs och mellan samtliga tre resurser. Avvisa konflikt även om den färska resursen saknar `account_id`; behåll legitimt frånvarande identifierare som frånvaro och behåll primärhashkravet. Använd inga alias, gissningar eller normaliseringar för att reparera en konflikt. Lägg till dessa fall i policy- och tjänsteregressionen.

## Egna körningar

| Körning | Tester | Pass | Fail | Cancel/skip | Exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `policy-identity-conflicts.test.mjs` | 5 | 2 | 3 | 0/0 | 1 |
| `adapter-primary-conflict.test.mjs` | 2 | 1 | 1 | 0/0 | 1 |

Den första körningen använde Nodes standardreporter (`spec`); loggens `.tap`-ändelse ändrar inte dess format. Den andra körningen använde uttryckligen TAP. Alla sju fall är egna motprov; de fyra röda assertionerna är inte räknade som godkända. Två policykontroller bekräftar att verkligt saknade identifierare accepteras med exakt hash samt att en direkt jämförbar färsk BBAN-konflikt avvisas. Adapterkontrollen bekräftar att två identiska primära IBAN-värden är observerbara.

Exakta kommandon, Node-version, tider och SHA256 för källor, prov och loggar finns i `policy-review-evidence.json`. Inga transportavbrott inträffade under dessa körningar.

## Granskad omfattning och begränsning

Designdokumentet, hela nya policyimplementationen och typerna, legacy-valideringen, den frysta policysviten samt relevanta delar av detaljadaptern och tjänstens observationsanrop är lästa. Den privata WeakMap-bindningen, rekontrollen av fryst input, begränsningen av valda null-konton, primärhashkraven och avvisningen av vanliga egenskapsgetters ger inget annat verifierat blockerande policyfynd i denna granskning. Ingen särskild ny Proxy- eller gettertestsvit har körts här, och denna delrapport gör inget eget påstående om tjänstesviter, tsc eller produktionsbeteende.
