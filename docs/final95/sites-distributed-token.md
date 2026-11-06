# Sites: gemensam apptoken i D1 och atomisk epochkontroll

## Verifierat problem

En reproduktion med två verkliga, separata lokala workerd-Workers och samma D1-databas gav två app-tokenutfärdningar med den tidigare processlokala cachen. En delad kontrollrad bekräftade att båda Workers verkligen använde samma databas. Ingen extern nättrafik tilläts. Testets förväntan var en utfärdning; reproduktionen var röd med `2 !== 1`.

## Implementerat

Sites kopplar den delade SQL-koordinatorn till rå `env.DB` och befintlig AES-256-GCM-kryptering. Adapterinstansen låser databascapability, krypteringsnyckel, providerkonfiguration, offentlig certifikatreceipt och den faktiska mTLS-bindingens identitet. Tokenpayload binds kryptografiskt till appfamilj, config-hash, epoch och tokenversion. Inga bolagsspecifika HTTP-klienter, kontoidentiteter, medgivanden, roller eller request-budgetar sparas i appcachen.

Migration `0025_application_tokens.sql` är en exakt kopia av den gemensamma schemadefinitionen. Den tillför två serverägda tabeller med `NOT NULL`, heltalskontroller och konsistensvillkor. Drizzle-journalens nästa index är 23 och dess fullständiga schema ligger i `0023_snapshot.json`, efter befintlig `0022_snapshot.json`. Befintliga kundtabeller och originalrader ändras inte av migreringen. Ingen produktion har migrerats här.

Readiness, status och kontoauktoritet gör endast lagrade läsningar. Den första uttryckligt auktoriserade synkörningen kan registrera appens konfigurationsmetadata innan en lease tas. Detta skapar inget medgivande och gör ingen token-POST. Själva utfärdningen använder den gemensamma koordinatorns lease, osäkerhetsspärr, appgemensamma Retry-After, konfigurationsrotation och certifikatsgräns.

## Finansiell commit

En separat, privat brandad capability binder exakt rå databas, familj, konfiguration, epoch och kontrollrevision. `companyApplicationTokenFence()` accepterar endast en sådan capability och en äkta företagsdatabaswrapper. Den registrerar ett fast `SELECT CASE`-villkor i det privata statementregistret. Inga SQL-strängar, tabellnamn eller kolumner kan skickas genom denna väg och inga tokenrader returneras.

Den vanliga företagsmetoden `prepare()` nekar fortsatt båda globala kontrolltabellerna, även med citerade namn. Syncens befintliga ekonomiska lease-batch placerar den nya guarden före och efter skrivningarna, tillsammans med befintliga företags-, medgivande-, versions- och leasekontroller. En registryrotation mellan sista asynkrona läsningen och själva SQL-exekveringen rullar därför tillbaka skrivningar och kvitton.

## Backup och isolerad återställning

Apptoken och global utfärdarstat ingår inte i kundens `BACKUP_TABLES`. En faktisk krypterad kundbackup verifierar frånvaron. Ny migration exponerade en integrationsregression i Sites evidence-restore:s exakta schemacensus. Den är rättad genom att uttryckligen känna igen de två kontrolltabellerna och sätta den nyskapade, isolerade kontrollraden i `recovery_required=1` innan alla tabeller döps till `evidence_*`. Den återställda token-tabellen är tom. Denna evidensdatabas är fortsatt inkompatibel med den levande applikationens tabellnamn.

## Verifiering

Alla bank-/tokenvärden i dessa körningar är syntetiska. Lokal workerd/D1 innebär en verklig körning av Worker- och SQL-miljön; providerbindingen är syntetisk och utgående nättrafik är spärrad.

| Körning | Resultat och avgränsning |
| --- | --- |
| Ursprunglig två-Worker-reproduktion | Röd: två utfärdningar i stället för en, delad verklig lokal D1 bekräftad, noll extern egress. |
| Nytt adapter-/migration-/fence-/runtime-/D1-fokus | 57/57 PASS, inga skipped/cancelled/TODO. |
| Samlad fokuskörning, elva testfiler | 163/163 PASS, inga skipped/cancelled/TODO. Inkluderar befintlig kontoauktoritet, synk, ingest, företagsisolering och backup. |
| TypeScript | `tsc --noEmit --incremental false`, exit 0. |
| Verklig lokal D1/workerd | Två isolat, kall samtidig start, därefter 1/10/100 förfrågningar med en token; delad 429; okänt issuerutfall i karantän; read-only readiness; ekonomisk rollback efter sen epochrotation. |
| Befintliga medgivanden | Sparat syntetiskt aktivt medgivande plus tom issuerregistry kan starta första behöriga synk; 625 SEK importeras som overifierad transaktion utan betalningsallokering. |
| Negativa gränser | Forged/kopierad/fel-databas-capability, flyttad ciphertext, fel krypteringsnyckel, env-/bindingbyte under läsning, schema-/DB-fel, återkallat medlemskap och restore-karantän. |

Tidigare fel har behållits i råloggarna. De omfattar en förväntan på asynkron avvisning där produkten avvisade SQL redan synkront, typinferens av en avsiktligt icke-enumererbar hemlighet, en saknad importmappning i testloadern och den verkliga evidence-restore-regressionen. Ingen säkerhetsassertion har tagits bort eller sänkts; restoretestet har stärkts med krav på tom global token-tabell och aktiv karantän.

Huvudagentens fullständiga, källbundna releasegrind och exakta-head-CI krävs fortfarande efter integration. Dessa fokuskörningar ersätter inte den grinden.

### Oberoende granskning av sista asynkrona behörighetskontrollen

En efterföljande raceprobe återkallar ett verkligt syntetiskt medlemskap under den sista globala issuerläsningen. Före rättningen returnerade fyra interna läsvägar en projektion: snapshot, synkkonfiguration, kontoauktoritet och synkstatus. Den yttersta HTTP-kontrollen nekade fortfarande svaret. Sites kontrollerar nu företagsgräns/medlemskap även efter koordinatorns await och kontrollerar därefter den pinnade serverkonfigurationen synkront.

En separat probe återkallar medlemskapet under den sista delade lease-läsningen före tokenPOST. Den reproducerade ett enda felaktigt skickat anrop. Den delade TokenClient-/koordinatorrättningen `2200b2a` kör därför den anropsspecifika guarden efter lease-läsningen och före markering av att anropet kan ha skickats; ingen företagsguard lagras i global tokenstat. Samma Sites-probe passerar med rättningen.

Tester skapar en extra syntetisk owner och verifierar att den avsedda medlemmen faktiskt har status `revoked`; annars skulle databasskyddet för bolagets sista owner stoppa själva testmutationen. Den tidigare token-response-regressionen har stärkts på samma sätt. Fyra nya läsracefall och det stärkta tidigare fallet gav först 1/5 PASS; dispatchfallet gav 0/1 PASS. Efter båda rättningarna passerar 96/96 fokuserade tester i sex Sitesfiler, utan skip/cancel/TODO, och TypeScript med `--noEmit --incremental false` ger exit 0. De separata resultaten överlappar och får inte adderas till tidigare 163/163.

## Driftsgränser

D1 samordnar Workers som använder samma databas. Node samordnar processer som delar den centrala lokala SQLite-filen. Om Node och Sites använder samma providerapp samtidigt men separata databaser krävs en utsedd utfärdare eller separata providerappar; implementationen påstår inte samordning över oberoende databaser. Byte eller återställning av en sådan kontrollplansdatabas kräver avstängd provider-egress och det dokumenterade operatörsförfarandet.

Cloudflare måste kunna provisionera en verklig mTLS-binding med uppladdat certifikat och privat nyckel. En textmiljövariabel räcker inte. Offentlig leaf-fingerprint/cert-ID är en operatörsreceipt för den opaque bindingen, inte kryptografisk introspektion av dess nyckel. Hostingmanifest, produktionsnycklar, bankavtal och faktisk bank-/BankID-auktorisering har inte ändrats.
