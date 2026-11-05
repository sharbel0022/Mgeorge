# Oberoende review av sluten bankdiagnos

## Slutsats

**READY inom avgränsningen på `5534a60c70c91554b598405504c4c85908e6a98f`, mot föräldern `2f184f342c45361e1344f468e00d55e912dcf96b`.** Inga Critical, Important eller Minor identifierades. Granskningen omfattar de fem ändrade filerna, egen före-/efterjämförelse av policy, felserialisering samt den verkliga HTTP-MCP-routen med lokala syntetiska beroenden.

Ingen verklig banktrafik, produktionsskrivning eller ändring av bankpolicy gjordes av granskaren. Testfixturen använder minnes-SQLite och verkliga service-/lagrings-/MCP-moduler; autentisering och bankens HTTP-gräns ersätts av befintliga testadaptrar. Global fetch kastar om den skulle anropas.

## Oförändrade beslut och avvisningar

Diffen delar upp redan befintliga avvisningsvillkor för att ge fasta reason-koder. Kontroll av kontomängd, business-usage, identitetsdata, vald kontodelmängd och giltighet är kvar. Ägarskap, behörighet, cooldown, lås och CAS ändras inte i produktionsdiffen.

Den egna differentiella matrisen körde **54 fall** genom både den oförändrade föräldern och kandidaten: **7 tillåtna och 47 avvisade**, med **0 skillnader** i beslut, accepterat resultat, felkod, status eller säkert felmeddelande. Fallen omfattar både strikt medgivande och legacy-val, giltiga konton, tomma/felaktiga/dubbla inventeringar, avvikande ID-mängder, privat usage, ogiltig eller ändrad identitet, frånvarande identitet, återkallad/utgången session, fel land/PSU samt tomma/felaktiga/dubbla/saknade val och ett indraget konto som inte valts.

Detta är en avgränsad syntetisk matris. Diffens oförändrade logiska villkor och de befintliga behörighets-/cooldown-/leasekontrollerna är kompletterande evidens.

## Privat felproveniens och sluten serialisering

De **11 fasta reason-koderna** provades direkt. De skapas av policyfabriken och binds till felobjektet i en privat WeakMap. Den publika reason-egenskapen är skrivskyddad och kan inte konfigureras om. En kopierad eller prototypärvd publikt korrekt reason får ingen privat proveniens.

**Nio obetrodda reason-former** provades, inklusive okänd sträng, objekt med kastande konvertering, array, boxed string, symbol, null och primitiva värden. De gav fortsatt BANK_ACCOUNT_SCOPE_INVALID/409 med säkert meddelande och ingen privat reflektion. Den befintliga serialiserarregressionen verifierar dessutom att ett publikt falskt reason-värde, även ett tillåtet kodord, inte får följa med; getters på reason används inte.

För ett scope-fel använder servicegränsen det fasta policyfelmeddelandet. Kontonamn, banknamn, konto-ID, identitetshashar och tillförd privat feltext förekommer inte i de kontrollerade svaren eller revalideringsauditens detalj.

## Verklig HTTP-MCP-kedja

Sex nya oberoende tester i `sites/tests/banking-security.test.mjs` kör den faktiska `app/mcp/route.ts` vidare till faktisk `bankRpc` och faktisk bankservice:

1. Tomt sparat kontoval: SAVED_SELECTION_EMPTY, ingen provider-GET.
2. Sparat val som inte är en array: SAVED_SELECTION_INVALID, ingen provider-GET.
3. Felaktig färsk account usage: ACCOUNT_USAGE_INVALID efter exakt en lokal getSession.
4. Privat tillförd ConsentError-text och ett obetrott reason-getter förblir sanerade.
5. Klientstyrda reason-/owner-argument avvisas före bankåtkomst.
6. Oautentiserad anropare får ingen bankdiagnos och ingen bankåtkomst.

Reason överlever både `structuredContent` och JSON-texten i MCP-resultatet. Underliggande servicefel är fortsatt **BANK_ACCOUNT_SCOPE_INVALID/409**. MCP behåller sin befintliga JSON-RPC-transport med **HTTP 200 och isError=true** för ett verktygsfel; reviewn påstår därför inte att den yttre MCP-responsen är HTTP 409. Privat no-store-header består.

Anslutningen och ekonomiskt workspace förändras inte i dessa negativa fall. Inga sync-runs skapas. Den förväntade revalideringsauditen är sanerad.

## Körningar

| Kontroll på fryst kod | Resultat |
| --- | ---: |
| Hela bank-consent-policy.test.mjs | 67/67, 0 skips, 179,837 ms |
| Riktat service-/MCP-fokus: 6 befintliga diagnostikfall + cooldown + förlorat lease + 6 egna routefall | 14/14, 0 skips, 5 297,489 ms |
| Separat före-/eftermatris | 54 fall, 0 skillnader |
| Separat privat reason-proveniens | 11 fasta koder + 9 obetrodda former godkända |

Totalt kördes 81 Node-tester i de två angivna fokuskörningarna. Differensmatrisens 54 fall redovisas separat. Den tidigare avbrutna bank-securitykörningen med 210 då gröna fall räknas inte som ett komplett godkänt resultat. Full integrationspipeline är rootens separata gate.

Direkt runtime var `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`, Node v24.22.1, med `--import ./scripts/saas-test-isolation.mjs` och NODE_ENV=test.

Det sparade `scripts/quality8/review-bank-scope-parity.mjs` tar en föräldra-checkout och en kandidat-checkout som två argument och skriver endast jämförelseresultatet. De sex nya routetesterna kan väljas med `--test-name-pattern='independent scope review'`; hela det använda servicefokuset väljs med `--test-name-pattern='scope diagnostic|independent scope review|consent revalidation obeys|losing the bank lease during consent'`.

## Gräns för godkännandet

Reviewn styrker den avgränsade diagnosändringen och dess transport genom den verkliga lokala routekedjan. Den säger ingenting om att ett verkligt bankmedgivande har återställts, att banken är ansluten eller att nya konton blivit godkända. Ingen bredare behörighet eller ny produktionsåtgärd följer av detta besked.
