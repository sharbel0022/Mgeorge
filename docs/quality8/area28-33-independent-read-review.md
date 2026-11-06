# Oberoende läsbedömning: område 28 och 33

Bedömd publicerad version: Site 65, main 41aadcef5fc6f65cc73979997b195c7b4f12eec1. Bedömningen använder oförändrade PLAN.md och sparade observationer till schemaändringen 2026-11-06 01:00:25 UTC. Inga nya driftanrop, produktändringar eller poängändringar utfördes. Root fattar slutligt poängbeslut.

## Område 33: tillräckligt stöd för minst 8

PLAN kräver exakt levererad källkedja, relevanta aktuella bank/Gmail/OCR/backup-observationer och före-/efterjämförelse av ekonomiska skydd. Den kräver inte att alla fyra externa funktioner lyckas i varje observerad körning. Den gemensamma regeln utesluter konfigurationsflaggor, tomma lyckade körningar och syntetiska test som bevis för verklig drift; här finns verkliga, icke-tomma resultat och ett verkligt bankavslag.

- Leverans: main och native Sites-träd är spårbart identiska; Site 65 publicerades 23:48:25 UTC. CI stödjer kodkedjan men testantalet höjer inte bedömningen.
- Bank: verklig revalidering på levererad kod 23:50:44 gav ACCOUNT_USAGE_INVALID, sparat explicit null och live omitted. Anslutningen förblev frånkopplad. Detta verifierar den faktiskt levererade diagnostiken och säkert avstående i aktuell drift; det bevisar inte godkänd anslutning eller lyckad hämtning. 15 och 16 förblir underkända enligt sina uttryckliga kriterier.
- Gmail: plattformens avslutade resultat gäller run 425c5f5d-cba0-832f-8b33-da27b5bbd411, scheduled_for 00:00, completed_at 00:08:33, med sex nya importer. Appens faktiska hämtning 00:04:59 och avslutad entrypoint 00:05:43 stödjer samma tidsfönster. Det separata 01:00-run f48a7c78 var fortfarande in_progress och räknas inte som avslutat.
- OCR: workflow_run 42132076896 på exakt 41aad gav sex behandlade, noll fel, med resultat 23:50:46 efter publicering. Detta är faktisk OCR-drift men inte periodiskt schemabevis.
- Backup: snapshot 768fde9a-27a2-4b85-b85a-278239ec4aea har separat slutstatus 00:49:04 med 430/430 kopierade och kontrollästa original, 185567855 byte, manifest_pass och verified_at 00:48:58. Gäller endast det frysta manifestet, inte senare importer.
- Ekonomiska skydd: två kompletta utvalda betalningsläsningar 00:06:28 jämförs uttryckligen med Site 64 och behåller revision 52, noll fakturabokningar, oförändrade kontrollsteg och spärrat konto/avstämning. Detta är avgränsad före-/efterevidens, inte fullständig revision eller ny ekonomisk läsning efter backupslutförandet.

Att dessutom kräva lyckad aktuell bankhämtning, registrering av ett nytt normalunderlag eller periodisk OCR specifikt för 33 skulle föra in kriterier från 15/16, 6 respektive 28. Inget ytterligare driftbelägg behövs för 33 enligt den nuvarande ordalydelsen. Kvarstående funktionsbrister ska fortfarande synas på sina egna rader. current-33-assessment.json och release-wave3.md är daterade före senare backup-/schemabevis och får inte behandlas som slutlig nulägesbedömning.

## Område 28: samlade bevis räcker fortfarande inte till 8

PLAN säger både att befintliga scheman fungerar och att minst en faktisk körning observeras. Midnattskörningen uppfyller det senare och visar konkret Gmail-progress. Den upphäver inte de separata kända luckorna i befintlig periodisk OCR och backup.

Senaste observerade GitHub-event=schedule är fortfarande 18:21 på äldre bf24a3c. workflow_run på 41aad får inte ersätta detta. Appen visar dessutom cloud_worker_recent=false, ocr_worker_unavailable och external_schedule_unverified. Appens försiktiga flagga motbevisar inte den externt belagda Gmail-körningen; det krävs inte att sätta en flagga grön för att godta extern evidens.

Backupens tidigare schemalagda körning avslutades med 362 kopierade men bara 35 kontrollästa original på grund av 80-anropsgränsen. Att plattformen märkte task completed bevisar inte en färdig backup. Den senare manuella slutföringen bevisar backupförmågan men inte den ändrade schemainstruktionens funktion. Den nya budgeten och dess guards är en rimlig åtgärd, men uppdateringskvittot är enbart konfiguration.

Minsta kvarvarande konkreta belägg:

1. En verklig periodisk OCR-körning (event=schedule) på aktuell levererad/relevant kod, med run-ID, tidsstämplar och faktisk köprogress eller annan meningsfull behandling av väntande jobb, samt förenlig appstatus. Ett manuellt eller CI-utlöst nytt prov fyller inte luckan. Inget nytt krav på lång SLA-mätning införs.
2. En faktisk schemalagd backupkörning med den nya instruktionen som från ofärdig snapshot når complete och separat verifierat samma ID/filantal/bytesumma, eller en observerad automatisk återupptagningskedja till samma slutläge. En körning som enbart konstaterar att dagens manuellt färdigställda backup redan är complete verifierar bara no-op-grenen och räcker inte som prov av den tidigare otillräckliga budgeten.

Redan relevant evidens för överlapp, paus och sena körningar ska behållas; ingen omtestning av allt eller ny bankauktorisering krävs enbart för rad 28. Bankens schemalagda säkra avstående kan vara korrekt schemabeteende även när 15/16 inte når sina funktionskrav.

## Integritet och avgränsning

Alla fyra filer i backupens seal matchade sina SHA-256; observationsloggen innehåller 107 poster. release-wave3.json:s hash för wave3-postpublication-observations.json matchade. Rapporten granskar sparad evidens, inte live-status. Inga V3-filer lästes.
