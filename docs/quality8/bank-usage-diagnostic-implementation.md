# Avgränsad usage-diagnostik för befintlig bankrevalidering

## Resultat och avgränsning

Diagnosrapporten är separat fryst i `b020d020ad7ab8d4ca7417959d01ceb1613a5709`, på publicerad main `819adee2f3848b474167eb6b15f82584caeb39af`. Den visar att `ACCOUNT_USAGE_INVALID` inte kan orsakas av enbart ett utelämnat usage-fält. Vilken faktisk sida eller kategori som orsakade det observerade produktionsavslaget är fortfarande okänt.

Denna ändring gör nästa ordinarie, behöriga revalideringsavslag mer precist utan att ändra vad som godkänns. Felkod, status och reason förblir `BANK_ACCOUNT_SCOPE_INVALID`, **409**, `ACCOUNT_USAGE_INVALID`. Det befintliga HTTP MCP-lagret transporterar samma verktygsfel med HTTP 200 och `isError: true`.

Det nya fältet `usageDiagnostic` innehåller endast version, antal valda konton och sex fasta räknare för respektive `saved` och `live`:

| Räknare | Betydelse i det validerade urvalet |
| --- | --- |
| `omitted` | Fältet saknas eller är `undefined`; den befintliga policyn tillåter detta. |
| `orga` | Exakt sträng `ORGA`; den befintliga policyn tillåter detta. |
| `priv` | Exakt sträng `PRIV`; fortsatt avslag. |
| `explicitNull` | Explicit `null`; fortsatt avslag. |
| `otherString` | Annan sträng, även tom, lägre skiftläge eller extra blanksteg; fortsatt avslag. |
| `wrongType` | Annan värdetyp; fortsatt avslag. |

Inga usage-strängar, konto-ID:n, banknamn, identitetshashar eller kontouppgifter följer med. Det är en ögonblicksbild av det sparade urvalet vid försöket. Den visar inte kontots juridiska ägare och utgör inget nytt medgivande.

## Varför endast denna felväg

`validateLegacyEnableSelection` används också av bland annat kontoval. Där kan urvalet komma från klientens nya önskemål. Därför räcker inte ett äkta policyfel för att publicera den nya detaljen.

Policyn fortsätter först att kontrollera hela sparade och aktuella UID-inventariet, giltighet, unikhet, live-mängdernas överensstämmelse och att alla redan valda resurser finns på båda sidor. Den projekterar sedan exakt samma urval till den oförändrade strikta valideraren. Endast dess ursprungliga usage-avslag kan få en privat, frusen kopia av räknarna. Accessorer och ärvda usage-egenskaper ger ingen diagnostisk kopia. Okända värden typklassificeras utan konvertering eller serialisering.

Tjänsten binder sedan detaljen till **just det fel som den aktuella revalideringens eget valideringsanrop kastade**. Först efter den redan befintliga lyckade skrivningen av `bank.consent.revalidation.failed` får felet sin serviceprivata märkning. Den skrivningen har redan ägar-, företagsadoptions- och leasekontroller. Misslyckad skrivning eller ett konkurrerande behörighetsbyte lämnar det befintliga avslaget utan kategoridetalj. Inga extra databasanrop eller bankanrop införs. Auditposten fortsätter att innehålla endast den befintliga kanoniska felkoden, inte räknarna.

Serializeraren kräver både denna privata märkning och exakt kod, status 409 och privat reason. Vanligt kontoval, strikt callback, synk och detaljhämtning får inte den nya payloaden. En förfalskad offentlig egenskap eller ens ett äkta policyfel som kastas av providergränsen kan inte ersätta revalideringens egen indatabindning.

## Testbevis

Alla tester använder syntetiska data och det isolerade nätverksskyddet. Serviceproven använder den verkliga tjänsten, SQL, kryptering, HTTP MCP-route och RPC; endast identitets- och bankgränserna ersätts. Inga riktiga bank-, credential- eller produktionsanrop gjordes.

| Fryst population | Före implementation | Efter implementation |
| --- | ---: | ---: |
| Ny ren policymatris | 19/34 pass, 15 fail | 34/34 pass |
| Valda service-/HTTP MCP-fall | 20/25 pass, 5 fail | 25/25 pass |
| Bredare fokuserad policy + Node/Sites-adaptrar | Inte påstådd ny före-körning | 153/153 pass |
| Bredare revalidering, kontoval och MCP | Inte påstådd ny före-körning | 56/56 pass |
| Befintlig före/efter-matris | 54 beslut | 54 identiska beslut: 7 tillåtna, 47 avslag |
| Separat usage-matris, båda sidor och adaptrar | 62 beslut | 62 identiska beslut: 15 tillåtna, 47 avslag |

**209 fokuserade regressionstester passerar utan fail, skip eller cancel.** De 59 red/green-fallen ingår i dessa 209 och ska inte adderas igen. Jämförelsematriserna är separat beslutskontroll, inte ytterligare oberoende driftevidens. `validateEnableConsent` och `businessAccountData` är byteidentiska före och efter.

Den första förberedande servicekörningen hade tre felaktiga nya testantaganden om samtidig ägar-, adoptions- och leaseändring. Den befintliga läsguarden stoppar dessa före usage-valideringen. Innan någon produktkod ändrades rättades förväntningarna till faktiskt observerad baslinje: generiskt 500 för testets ägarbyte, `COMPANY_ACCESS_DENIED`/403 för adoption och det befintliga leasefelet/409. Inget produktbeteende ändrades för dessa fall. Den därefter frysta matrisen ovan hade endast fem fel, samtliga därför att den nya payloaden saknades. De två testfilerna är byteoförändrade mellan denna frysta RED och GREEN.

Negativa kontroller omfattar främmande och dubbla UID:n i hela inventariet, tomt/främmande urval, 100/101-kontogränsen, tidigare bank-/PSU-/utgångs-/scopeavslag, förfalskade getteregenskaper, prototypkopior, frusen metadata, inputmutation och ovala konton. Verkliga servicefall provar dessutom obehörig anropare, klientinmatade räknare/ägare, cooldown, konkurrerande adoption/lease, misslyckad audit och sparat konto A med nytt begärt konto B. Den vanliga revalideringen gör fortfarande **exakt ett mockat `getSession`**. Under usage-avslagen bevaras anslutningsraden och dess urval/krypterade data, och inga workspace-, synk- eller ekonomiska ändringar skapas.

Typkontrollen och `git diff --check` passerar. Exakta tider, testnamn, kommandon och fil-/logghashar finns i [maskinkvittot](bank-usage-diagnostic-implementation.json). Den fokuserade regressionen tog cirka 3,98 sekunder för policy/adaptrar och 19,74 sekunder för service; inga tidsspärrar har lagts i testerna.

### Oberoende läsreview

En separat agent granskade de tre frysta produktfilhasharna och gav **READY**, utan kvarvarande konkret säkerhets- eller predikatfynd. Agentens egen 16 × 16-matris hade 256 kombinationer med samma 4 tillåtna och 252 avslagna beslut före/efter, inklusive kod/status/meddelande/reason. Alla strikta callbackavslag saknade selected-diagnostik. Extra BigInt-, Symbol-, funktions- och kastande reflektionsfall gav ingen råvärdesläcka. Agenten körde även samma service-/HTTP MCP-fokus: 25/25 pass, inga skips. Dessa överlappande prov ska inte summeras som nya unika regressionstester.

## Återkörning och fortsättning

Kör med Node 24 direkt och `NODE_ENV=test`. Policymatrisen och servicefokus körs med `--import ./scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1`. Fullständiga kommandon och hashbundet kvitto finns i JSON-filen. `scripts/quality8/review-bank-usage-diagnostic-parity.mjs BEFORE AFTER NEW_OUTPUT_JSON` jämför syntetiska beslut utan bank- eller databasåtkomst; den vägrar skriva över ett befintligt resultat.

Root ansvarar för oberoende slutreview, integration, full CI och eventuell publicering. Efter sådan publicering kan nästa **ordinarie behöriga** revalidering skilja exempelvis sparat `null` från aktuellt `PRIV` eller en annan okänd representation. Ingen extra revalidering, policyändring, ny auktorisering eller automatisk förnyelse följer av denna leverans.

Bankanslutningen är inte bevisat återställd. Det återstår att observera den verkliga kategorin och därefter avgöra om korrekt providerdata, ett integrationsfel eller ägarens nya samtycke behöver hanteras. Om diagnosens ägar-/lease-/auditvillkor inte kan styrkas uteblir detaljen; det är inte bevis för att usage-fältet saknas.
