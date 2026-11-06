# Releasegrindar, migration och återställning

Granskning: **2026-11-06**. Baslinje: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Kandidat och aktuella körningar: [PR 66](https://github.com/sharbel0022/Mgeorge/pull/66).

**Kommersiell aktivering kräver fortfarande separat beslut.** Denna leverans ger reproducerbara interna kontroller. Avtal, BankID-/bankauktorisation, driftåterställning och verklig kundlansering bedöms enligt [COMMERCIAL-LAUNCH-GATES](../saas/COMMERCIAL-LAUNCH-GATES.md) och [COMMERCIAL-LAUNCH-REQUIREMENTS](../saas/COMMERCIAL-LAUNCH-REQUIREMENTS.md). Kandidatens faktiska CI-resultat ska läsas på dess exakta commit; detta dokument tilldelar inga nya produktionspoäng.

## Maskinella krav

| Kontroll | Vad som krävs |
| --- | --- |
| Ordinarie kvalitet | Alla befintliga jobb i [payment-control-ci.yml](../../.github/workflows/payment-control-ci.yml), inklusive Node 22/24, Sites, bridge, browser, audit och bygge, för kandidatens aktuella källa. |
| Säkerhetsacceptans | Den uttryckliga Node-/Sites-listan i [saas-security-scope.mjs](../../scripts/lib/saas-security-scope.mjs). Saknade filer får inte hoppas över. |
| Bevisets identitet | Version 2-kvitto, exakt checkout-commit och Git-träd, ren källa före/efter körningen, förväntad scope-hash och SHA256 för varje rå TAP-logg. |
| Komplett körning | Exit 0, ingen signal, positiva testantal, samma antal godkända, exakt en totalsummering och noll fail/cancel/skip/TODO. Inget saknat eller extra suite-/filurval. |
| Aktualitet | Start högst 24 timmar före verifiering; ordnade ISO-tider och högst 5 minuters framtida klockavvikelse. |
| Samtidiga företag | Faktiska överlappande providerstubbanrop i scenarier med 1/10/100 företag: uppmätta toppar 1/5/5 även vid replay. Kvitton och audit förblir företagsbundna. |
| Full syntetisk återställning | Separat Node 24-jobb: 430 nyskapade objekt, 185567855 byte, 27 namngivna beständiga tabeller, exakt ekonomicensus, originalens hashkontroller och 22 unika negativa kontroller. |
| Bevarade gränser | Företag/proveniens måste stämma; andra ägare, återupplivade leaser, medlemskap och användbara applikationstoken får inte följa med återställningen. |
| Kommersiella påståenden | `productionAcceptance=NOT_VERIFIED` och `commercialLaunch=NOT_APPROVED` även när alla interna kontroller är gröna. |

[Verifieraren](../../scripts/verify-saas-release-evidence.mjs) används som ett obligatoriskt steg i [säkerhetsflödet](../../.github/workflows/saas-security-acceptance.yml). Flödet körs för PR till main och efter main-push; tidigare `feature/saas-*`-flöden bevaras. Full återställning körs i ett separat jobb för att undvika att dess minnesbehov överlappar säkerhetssviten på samma runner.

GitHub testar normalt PR:ns merge-checkout. Därför sparas `sourceCommit`/`sourceTree` för den faktiska checkouten, och PR-head, base, event, run-ID och försök separat. Ett grönt merge-kvitto får inte beskrivas som en körning av en annan head-commit. Efter merge krävs nya main-kvitton.

### Bevisens tillitsgräns

Hashar upptäcker ändrade eller sammanblandade loggar och kvitton. De utgör **inte en signerad oberoende attestering**. En person med rätt att ändra kod eller artefakter kan beräkna nya hashvärden. Releaseansvarig måste även kontrollera granskad källa, betrodd GitHub-körning, fullständiga jobb, artefaktens ursprung och aktuell commit.

Kontrollerna använder syntetiska data, en tillåten uppsättning miljövariabler och [nätverksvakten](../../scripts/saas-test-isolation.mjs). `NODE_OPTIONS` och operatörens bank-/molnhemligheter ärvs inte av barnprocesserna. Vakten stoppar oavsiktlig extern nätverkstrafik från betrodda tester; den är ingen sandbox mot illvillig testkod. Artefakterna innehåller loggar och syntetiska aggregat, aldrig återställningsnyckeln, backupbunten eller originalen.

### Krav på GitHub-administratör

Vid kontroll 2026-11-06 returnerade [main-metadata](https://api.github.com/repos/sharbel0022/Mgeorge/branches/main) `protected:false` och [repository-/föräldraregler](https://api.github.com/repos/sharbel0022/Mgeorge/rulesets?includes_parents=true) en tom lista. En röd workflow är därför ännu inte verifierad som en tekniskt tvingande spärr för merge.

Administratören behöver aktivera branch protection eller motsvarande ruleset, kräva PR-granskning och samtliga relevanta kvalitets-/säkerhets-/återställningskontroller, begränsa bypass samt verifiera att felande och saknade kontroller faktiskt blockerar merge. Spara läsbart konfigurationsbevis och ett säkert avvisningsprov. Denna leverans ändrar inte administrationsinställningar.

## Migration och rollback

[Det nya migrationstestet](../../sites/tests/saas-migration-rollback.test.mjs) jämför journalen med samtliga SQL-filer och kör hela kedjan med SQLite-integritet och foreign-key-kontroll. Ett separat filbaserat prov börjar före företagsmigration 0019, bevarar ekonomipayload, originalmetadata/hashar och audit, utför verifierad adoption och öppnar databasen på nytt. SQL-skrivningar från den gamla ägarmodellen avvisas efter adoption vid varje återöppning. En separat bevarad checkpoint visar att den gamla SQL-formen fortfarande fungerar på den gamla databasen.

Det kompletterar [Node:s historiska migrationsreplay](../../test/quality-regressions-migration-replay.test.js), [Sites bevarandetest](../../sites/tests/company-storage.test.mjs) och [befintlig migrationsordning](../../sites/tests/seven-agent-migration-order.test.mjs). Det ändrar inga scheman eller finansiella rader i produktion.

**En äldre applikation utan företagskontroll är inte ett tillåtet rollbackmål för en adopterad företagsdatabas.** SQL-triggerproven styrker skrivspärrar; läsisoleringen kräver också den aktuella applikationsgränsen. En generell automatisk nedmigrering är inte verifierad.

Integrationsansvarig ska före driftsättning registrera exakt migrationskedja, aktuell/applikationskompatibel återgångsversion, oberoende snapshot/nyckel, stopp av arbetare och hur återupptagande granskas. Återställning måste behålla karantän för leaser, tokens och auktorisation; lagrad historik ger inte förnyad rätt till bank- eller företagsdata.

## Vad 430-provet faktiskt mäter

[Recovery-drill](../../sites/scripts/recovery-drill.mjs) skapar 430 syntetiska objekt med samma sammanlagda byteantal som den refererade storleksklassen. Innehållet är genererade platshållarbyte, inte den verkliga historiska PDF-/XML-populationen. De 27 tabellerna har representativa syntetiska ekonomirader. Ett separat [formatprov](../../sites/tests/recovery-format-originals.test.mjs) återställer giltiga syntetiska PDF-, PNG-, CSV-, XML- och XLSX-original och läser dem med riktiga parsers före/efter; [observerat resultat](backup-recovery.md). Verkliga kundoriginal kräver fortfarande separat behörig acceptans.

Provets RTO-gräns är 60000 ms från lokalt tillgänglig exporterad krypterad bunt till färdig SQLite-/original-/proveniensacceptans. Operatörens svarstid, molnhämtning, regionalt bortfall, nyckelåtervinning och produktionsaktivering ingår inte. Rapporten behåller dessa avgränsningar och faktisk start/sluttid.

**RPO 900000 ms är ett 15-minutersscenario**, med fryst syntetisk snapshot och senare incidenttid. Det visar att en skrivning efter snapshot inte smygs in i återställningen. Det styrker ingen faktisk 15-minutersbackup eller garanti från ett dagligt backupschema. Driftens RPO måste mätas från verkligt färdigställda, oberoende tillgängliga backups och accepterad dataförlust.

## Reproducerbara kommandon

Kör i en ren checkout med workflowens exakta Node-version och låsta installationer. `SAAS_EVIDENCE_HEAD_SHA`/`SAAS_EVIDENCE_BASE_SHA` sätts av workflowen i CI; vanliga lokala körningar har ingen GitHub-kontext.

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/saas-release-evidence.test.js

NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 sites/tests/saas-migration-rollback.test.mjs sites/tests/company-sync-scale.test.mjs

node scripts/run-saas-security-acceptance.mjs /tmp/mg-saas-security
node scripts/verify-saas-release-evidence.mjs security /tmp/mg-saas-security "$(git rev-parse HEAD)"

node scripts/run-saas-recovery-acceptance.mjs /tmp/mg-saas-recovery
node scripts/verify-saas-release-evidence.mjs recovery /tmp/mg-saas-recovery "$(git rev-parse HEAD)"
```

Det fulla återställningskommandot i barnprocessen är `NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --experimental-strip-types sites/scripts/recovery-drill.mjs 430 185567855`. Ingen produktionskälla eller destination kan anges.

## Handoff: engineering, drift och juridik

Engineering/integrationsansvarig granskar PR-källan, aktuell CI, båda applikationernas kontrakt, migrationsordning och artefakter. HTTP-företagsbyte ska skicka aktuell positiv heltalsversion; den gemensamma klienten gör redan detta. Node:s befintliga publika inloggning för en administratör ger inte stöd för att exponera tjänsten för flera självständiga kunder; se lanseringskraven.

Driftansvarig äger branch enforcement, verifierat produktionsingress, incidentövning, hemlighetsrotation, oberoende backup-/nyckeltillgång, faktisk återställning, RPO/RTO, alarmsvar och schemakvitton. Korrekt konfiguration ska skiljas från en observerad lyckad körning.

Affär/juridik/privacy äger fortsatt L01–L10 och leverantörs-/företags-/kontospecifik T01. BankID-identitet, rätt att företräda bolaget och rätt till valda bankkonton är separata granskningsfrågor enligt projektets befintliga grindar. GDPR-roller, DPA, underbiträden, överföringar, retention/radering och incidentansvar behöver privata beslutsunderlag. Inga sådana godkännanden skapas av den här testkoden.

T04-beslutet ska binda exakt main-/Sites-version, miljö, kundomfattning, flagga, granskare, giltighet och stopp-/återgångsplan. Okänt, utgånget eller partiellt underlag förblir blockerat.
