# Startup cancellation: faktiskt första RED-försök

**Avsett RED är verifierat.** Försök1 på exakt `f0e845bb87ee08d15fa96cb75879849493aeb1fd` misslyckades i cancellation-regressionens watchdog efter att den riktiga inre testvärden nått ready och tagit emot cancellation. Det är inte ett import- eller setupfel.

## Identitet och terminalt resultat

- Gren: `fix/startup-cancellation-red-20261106-0643`.
- Källa: `f0e845bb87ee08d15fa96cb75879849493aeb1fd`, förälder `8c744db37816411d8ad8b70c5b94202c74c37e62`.
- Rotträd: `c80381de41b5db7b046ad3c4f596a84fa0c7d716`; Sites-träd: `4feabc128c5f677103232d1cad1e4406083e8f19`.
- Ordinarie Payment push-run: [42176156539, attempt1](https://github.com/sharbel0022/Mgeorge/actions/runs/42176156539/attempts/1). Start 06:42:34 UTC, terminal failure 06:49:59 UTC den 6 november 2026.
- Samtliga tre fulla jobbloggar visar exakt source-head som checkout.

| Jobb | ID | Testresultat | Jobbutfall |
|---|---:|---:|---|
| Node | 127754977736 | 2 322 pass / 2 323 tests, 1 fail |failure 06:45:18|
| Sites |127754977359| 5 237 / 5 237 |success 06:49:58|
| Bridge |127754977854| 47 / 47 |success 06:42:54|
| Totalt | |**7 606 pass / 7 607 tests, 1 fail**|**Expected RED**|

Samtliga översta TAP-sammanfattningar har 0 cancelled, 0 skipped och 0 TODO. Den inre testvärdens avsiktliga testAborted är en separat nivå och bevis för faktisk cancellation.

## Det exakta felet

Enda felet är test 692, `startup resources close a hanging contender and release its SQLite holder on real test cancellation`, vid `test/database-startup-cancellation.test.js:48:1`. Det pågick 10 010,454839 ms och gav:

```text
SYNTHETIC_STARTUP_CANCELLATION_WATCHDOG
ERR_TEST_FAILURE
```

Diagnostiken visar ready=true, events spawned→ready, watchdogFired=true och truncated=false. Den inre TAP-utskriften visar testAborted med `Synthetic ready-barrier cancellation`. Ingen done- eller childClosed-signal finns före watchdog. Därmed har fixture/setup körts och den önskade avbrottsgränsen nåtts.

Det [oförkortade tidsstämplade felblocket](failure-blocks.log) är 2 112 bytes och har SHA-256 `0d4409a8705bd866bd5b1dae919dbbde28c1812146cffde84b50bb02d2c65b3a`. Hela Node-loggen finns i [logs/node-127754977736.log](logs/node-127754977736.log). Den byteidentiska testkällan sparas under [source/database-startup-cancellation.test.js](source/database-startup-cancellation.test.js); SHA-256 `fd40426a5c40481d7516d6840dc26d3d0572fc28c025c9b57e25f3973bad046d`, Git-blob `0d337415be3689f71f217f1d5ea88cf3d688a595`, verifierad mot källans Git-träd.

## Övriga grindar

15 av 16 obligatoriska kommandosteg passerade. Node-teststeget är det enda misslyckade kommandosteget. Ett efterföljande Node-städsteg är skipped; detta räknas inte som ett överhoppat test.

Sites byggdes faktiskt 06:49:40–06:49:56 UTC. Full logg innehåller `2026-11-06T06:49:56.1510746Z   Build complete.`. Check/syntax, mitigation-kontroll och övriga obligatoriska steg framgår i [SUMMARY.json](SUMMARY.json) och [jobs-attempt1.json](jobs-attempt1.json).

Node och bridge rapporterar 0 beroendesårbarheter. Sites rapporterar **8 moderate** och passerar den befintliga auditgränsen high. SaaS är inte tillämpligt på detta fix/* push-event enligt oförändrade workflow-filer.

## Arkivets integritet och omfattning

Tre terminala originaljobbloggar omfattar totalt **3 279 187 bytes**. De hämtades först när respektive jobb var terminalt. BOM, tidsstämplar, radbrytningar och ANSI-sekvenser bevaras. Fulla loggar, hela felblocket, run/job-metadata, testkälla och diagnos är bundna av [file-manifest.json](file-manifest.json) och [SHA256SUMS](SHA256SUMS). Samtliga checkpointfiler återläses byte för byte från GitHub före publicering av checkpointgrenen.

Checkpointen utgår från main237 och lägger endast till `docs/quality8/startup-cancellation-red-f0e845bb-20261106`. Source-head för evidensen är fortsatt f0e845bb; checkpointens produktträd är oförändrat från main237. Ingen PR, produktionsåtgärd, köändring, rerun eller workflow-dispatch ingår. Ingen GREEN-kandidat granskas eller bevakas av detta arkiv.
