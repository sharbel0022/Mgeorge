# MG Fakturakoll — verifierat läge 2026-11-06 07:19:36 UTC

**Målet är inte nått: 28 av 33 områden är minst 8.** Områden 6, 10, 15, 16 och 28 är kvar på 6,5. Summa 257,5/330, medel 7,8030. Kriterier och betyg är oförändrade. Den maskinläsbara fullständiga bedömningen finns i [current-33-assessment.json](current-33-assessment.json).

## Vad som faktiskt slutförts

[PR 60](https://github.com/sharbel0022/Mgeorge/pull/60) är normalt mergad till `cde9178c0f8e8e386329ed8feaa4201e87b5a78f`. Den befintliga femsekunders SQLite-väntetiden installeras före WAL-initiering. Den ursprungliga samtidighetsregressionen behåller sina testkroppar och får begränsad stderr-/exitdiagnostik. Ett verkligt låsprov kontrollerar väntetid, rollback, återöppning, integritet och bevarade ekonomiska/originaldata.

Den första kandidatens gröna testning räckte inte när oberoende granskning fann otillräcklig städning vid avbrott. Ett separat verkligt avbrottsprov frystes före rättningen. Det första ordinarie RED-försöket nådde barnets ready-barriär och faktisk Node-test cancellation, och föll sedan på den yttre säkerhetsgränsen. Efter rättningen används exakt samma regression. Inre städning måste ha avslutats innan yttre reservstädning; reservstädning kan aldrig skapa ett godkänt resultat. [Bevarat RED](https://github.com/sharbel0022/Mgeorge/tree/44c5289383f23d2cc8e9f4d00f1ba2dc1297bb44/docs/quality8/startup-cancellation-red-f0e845bb-20261106) och [oberoende återgranskning](https://github.com/sharbel0022/Mgeorge/tree/955fcb98333c36e54f7e3e580f7fd70a5ae21292/docs/quality8/startup-independent-rereview-20261106).

| Verifiering | Node | Sites | Bridge | Totalt |
| --- | ---: | ---: | ---: | ---: |
| Slutlig PR-head 520e227 |2323/2323|5237/5237|47/47|7607/7607|
| Mergad main cde9178 |2323/2323|5237/5237|47/47|7607/7607|

Båda var första ordinarie försöket. Varje svit har0 fail/cancelled/skipped/TODO; alla 16 obligatoriska steg och faktiskt Sites-bygge passerade. Separat SaaS-acceptans325 + 929 överlappar huvudsviterna och adderas inte till 7 607. Node 22.23.4 användes. På main passerade avbrottsprovet på 92,895 ms, låsprovet på 5166,122 ms, tvåprocessprovet på 220,087 ms och crash-/rollbackprovet på 167,529 ms. [Full PR-evidens](https://github.com/sharbel0022/Mgeorge/tree/2bf147fd2688313128e64028ebc4300472100794/docs/quality8/pr60-final-ci-520e2271-20261106) och [full main-evidens](https://github.com/sharbel0022/Mgeorge/tree/abe08e383a1838c545fba13a4cf367998900ad89/docs/quality8/startup-main-ci-20261106).

Auditutfallet är inte noll överallt: Node och bridge rapporterar 0; Sites rapporterar 8 moderate och passerar oförändrad high-gräns. Den separata minimatch-byteverifieringen passerade.

## Publicering — version 66 är fortfarande i drift

Native-källan `d30b1e2518e3765b15fba28cbd306addf142da38` har exakt Sites-trädet `4feabc128c5f677103232d1cad1e4406083e8f19`, samma som granskad och testad main. Version 67 var sparad från den källan. Uppladdning av det redan lokalbyggda paketet gick inte att genomföra när exekveringsmiljön blev otillgänglig. Den dokumenterade source-only-vägen användes därför för ett ordinarie fjärrbyggt publiceringsförsök.

Försöket startade07:08:32UTC och **misslyckades07:08:41UTC** med:
> A dependency uses a private or unsupported source. Replace it with a dependency available from a supported public registry, update the lockfile, and publish again.

En egen läsning av package.json/lock på exakt main visar905 paketposter och898 resolved-källor.897 är registry.npmjs.org. Den enda övriga är integritetspinnade SheetJS 0.20.3 på dess CDN. Detta är den tydligaste kandidaten till avvisningen, men serverns generiska fel namnger inte paketet. Inget beroende har ersatts eller nedgraderats.

Version 67 är **inte publicerad**. Version 66 återlästes som lyckad med MCP och envrevision 10; sajten är active, samma publikdelning och tre befintliga scheman. Det gamla paketets SHA256 är `0edf980d1d397decd171164d4d867463486c0e968acd0282a620d28609842e00`,18607635byte, men det laddades inte upp och är inte bevis för att fjärrbyggaren använde dessa byte. Ny bankrevalidering utfördes inte efter det misslyckade publiceringsförsöket.

## Faktisk dokumentprogress

Efter godkänd huvudgrens-CI startade [ordinarie OCR-run 42178783601](https://github.com/sharbel0022/Mgeorge/actions/runs/42178783601), event`workflow_run`,07:07:21–07:09:12. Den använde exakt main cde, passerade båda main-kontrollerna och rapporterade **processed 6, failed 0**. Full originallogg finns i [ocr-workflow-run-42178783601.log](ocr-workflow-run-42178783601.log). Detta var inte en manuell dispatch eller en ny periodisk schemakörning.

Väntkön gick 64→58 och needs_review 385→391. Registreringsraderna är fortfarande 2. De sex resultaten ska inte likställas med sex verifierade OCR-leaser, eftersom runnerns total även kan omfatta server-PDF. Appens senaste molnaktivitet är07:09:03 och senaste accepterade completion07:09:08.

Det tidigare en gång normalt återköade ägda underlaget lästes igen07:13:47. Det är fortfarande waiting_ocr, attempts 0, utan lease eller invoice. Hela registreringstabellen kunde läsas utan trunkering: två rader, inget kvitto för målet. Jobbsidans extraktionsvärden är däremot trunkerade; här görs bara en metadatautsaga. Ingen ny återköning eller prioritetshöjning gjordes. Därför är område 6 fortfarande6,5 trots verklig köprogress. [Kapacitetsdiagnos och köbegränsningar](https://github.com/sharbel0022/Mgeorge/tree/d5ae148f4847e87b30e2e084494e3f44765afc27/docs/quality8/ocr-capacity-diagnosis-20261106).

## Gmail och backup

Det nominella07:00-tillfället rapporterar no_update. Metadata anger start06:55:02.233321 och avslut06:55:03.035504UTC; tiderna bevaras utan normalisering. Latest_result hör till02:00-körningen och får inte användas som07-kvitto. Den observerade prompten innehåller engångskravet på kvitto, men en separat exekveringssnapshot saknas. Faktiska verktygsanrop, otillgänglighet och spärrorsak för07 är inte belagda.

Första observationen skedde efter registrerat avslut, så ingen färsk faktisk förebaslinje kan återskapas. Senare appstatus visar samma Gmail-invokering04:05:48 och lyckade hämtning04:06:01. Den samtidiga OCR-progressen hör till sin separat verifierade körning och tillskrivs inte Gmail. [07-observationens fulla evidens](https://github.com/sharbel0022/Mgeorge/tree/1ec960d9de4f896f7f481bfdc0e0fc9cc47337fa/docs/quality8/gmail-schedule-0700-20261106).

Den tidigare backupen verifierade430/430 original och 185 567 855 byte i sitt frysta manifest. Senare importer ingår inte. Den ändrade automatiska anropsbudgeten är inte provad från en ofärdig snapshot till ett separat bekräftat fullständigt slutläge. Nästa befintliga dagskörning är 2026-11-07 kl. 01:15 UTC,02:15 Europe/Stockholm. Inga scheman eller framtida bevis har fabricerats.

## Ekonomiska invariants

Två befintliga betalningsunderlag lästes fullständigt07:03:27 före publiceringsförsöket och07:12:46 efter misslyckandet och den ordinarie OCR-körningen. Båda har revision 52, complete=true, snapshotCurrent=true, outputLimited=false och ett befintligt betalningsunderlag vardera. Hela svaret är identiskt när endast checkedAt tas bort. Inga andra fält filtrerades bort ur jämförelsen. [Sanerat kvitto](financial-invariants.json).

## Fem återstående krav

| Område | Betyg | Vad som fortfarande behövs |
| --- | ---: | --- |
|6 Minimal manuell hantering|6,5|Ett godtagbart normalunderlag genom hela kedjan och verkligt registreringskvitto.|
|10 Bild-OCR|6,5|Ett nytt fryst oberoende förstaprov som når minst 98 % precision och 85 % recall utan kritiskt falskt grönt.|
|15 Swedbank|6,5|Faktiskt bankgodkänd aktuell anslutning och verifierad läsning av rätt valda konto.|
|16 Automatisk bankhämtning|6,5|Ny lyckad schemalagd hämtning med giltigt medgivande.|
|28 Schemaläggning|6,5|Verifierad Gmail-schemakörning samt automatisk fullständig backup från ofärdigt läge.|

Den opublicerade OCR-utvecklingskandidaten c5 nådde 69/100 obligatoriska fält och 91/130 All13, utan falska positiva i den kända rundan. Recallkravet 85 % nås inte. Detta är känd utvecklingsdata, inget nytt blint godkännande. V3 är fortfarande förseglad. Analysmetadata räddades till [separat checkpoint](https://github.com/sharbel0022/Mgeorge/tree/d5e9451ceff439ff7ae60799de58e8ff00971eb8/docs/quality8/ocr-analysis-recovery-20261106); full originaljournal, råresultat och hela lokala kandidatkedjan har inte återställts externt.

## Fortsättning när arbetsmiljön åter är tillgänglig

1. Återfå den befintliga miljön och kontrollera originalpaketets hash samt pushed native-HEAD. Publicera det verifierade byggpaketet genom ordinarie nativeflöde; anta inte att ett gammalt arkiv fortfarande finns eller är oförändrat.
2. Efter verkligt lyckad publicering: utför högst en vanlig bankrevalidering, läs den nya säkra felprojektionen och jämför ekonomiska invariants. Nytt BankID-behov kan inte fastställas före faktisk diagnos.
3. Återfå exakt OCR-råjournal och originalkällor. Slutför generella parserförbättringar och oberoende granskning innan någon ny hållout körs. Den redan förbrukade kända optiska bindningen får inte döljas genom en omkörning.
4. Följ befintliga normala scheman och verklig köprogress. Betyg höjs först när de oförändrade kriterierna faktiskt uppfylls.

Detta dokument är en separat evidenscheckpoint på main cde, inte ytterligare produktkod eller ett nytt publiceringsförsök.

## Samtliga 33 områden

| Nr | Område | Betyg |
| --- | --- | ---: |
| 1 | Design | 8 |
| 2 | Startsida | 8 |
| 3 | Navigation | 8 |
| 4 | Mobil | 8 |
| 5 | Sök/filter | 8 |
| 6 | Minimal manuell hantering | 6,5 |
| 7 | Kundfakturor | 8 |
| 8 | Leverantörsfakturor | 8 |
| 9 | PDF | 8 |
| 10 | Bild-OCR | 6,5 |
| 11 | Gmail | 8 |
| 12 | Automatisk registrering | 8 |
| 13 | Dubbletter | 8 |
| 14 | Dokumentgranskning | 8 |
| 15 | Swedbank | 6,5 |
| 16 | Automatisk bankhämtning | 6,5 |
| 17 | Bankgiro-import | 8 |
| 18 | Verklig betalare | 8 |
| 19 | Verklig OCR/referens | 8 |
| 20 | Automatisk matchning | 8 |
| 21 | Delbetalning | 8 |
| 22 | Överbetalning | 8 |
| 23 | Flera fakturor per betalning | 8 |
| 24 | Historik | 8 |
| 25 | Betalstatus | 8 |
| 26 | Kontrollera alla betalningar | 8 |
| 27 | Mejlförslag | 8 |
| 28 | Schemaläggning | 6,5 |
| 29 | Backup | 8 |
| 30 | Säkerhet | 8,5 |
| 31 | Katastrofåterställning | 8 |
| 32 | Kod/tester | 8,5 |
| 33 | Verklig produktionsverifiering | 8 |
