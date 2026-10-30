# MGEORGE – kvalitetscykel2: resultat, bankbevis, backup och åtkomst

## Leveransstatus

Detta är en fortsatt delleverans inom det aktiva åttatimmarsuppdraget, inte en slutrapport. Kandidaten bygger på main `02d1f84a18c1113f9e68641c384e1cef766f9558`. Fyrtio ändrade käll-/test-/migrationsfiler har frysts, granskats oberoende och kontrollerats på nytt efter de fulla grindarna. Manifestet i `QUALITY-8H-CYCLE2.json` knyter varje testat programtillstånd till SHA-256. Den slutliga Git-tree:n jämförs med GitHubs skapade tree före fast-forward; exakt commit och CI registreras vid leverans.

**Fullt resultat:469/469 Node +624/624 Sites =1093 tester,0 fel,0 överhoppade.** Node-syntax69 filer, Sites TypeScript, produktionsbygge och båda beroendegranskningarna passerar; audits rapporterar0 sårbarheter i alla klasser. All testdata är isolerad och syntetisk. Fulla process-/sockettester kördes i tillåten miljö; sandboxfel räknades inte som godkända tester.

## Vad koden ändrar

### Aktuellt Node-betalningsbevis

Den gemensamma beviskontrollen används i avstämning, API, ekonomisk översikt, export och meddelanden. Förlorade eller förändrade original och motstridiga bankfakta stoppar aktuella verifieringspåståenden, även när äldre allokeringar och ett matchande utkast-snapshot finns kvar. Utebliven betalning kan inte nybekräftas med enbart fritext medan bankkonflikter är öppna. Historiska kontrollnoter, pengar och allokeringar bevaras. UI skiljer registrerat belopp från aktuellt verifierat belopp. Den oberoende reviewn hittade en exportväg som först saknade samma härledning; även den har en verklig negativ reproduktion och rättning.

### Kontrollåtgärdens kvitton och leases

Node sparar även accepterade request-ID:n som sammanslagits med en pågående eller nyss avslutad kontroll. Samma ID kan därför inte senare starta en oavsiktlig ny körning. Sites kontrollsteg använder databasens klocka i den faktiska skrivningen och skyddar ägare, token, körning och status. Ett oberoende SQLite-prov väntade över leasegränsen bakom ett skrivlås och fick0 ändrade rader. Resultat från gammal worker kan inte skriva över en efterträdare.

### Dokument, Gmail och OCR

Registrering och kvitto sparas atomiskt. En efterföljande avstämnings-, metadata-, tidsstämpel- eller statusläsningsförlust upphäver inte en redan bekräftad faktura. Resultatet behåller bara bekräftat accepterat antal, visar `status_unknown` och utelämnar totaler eller tider som inte kan fastställas. Fel före accepterad registrering kastas fortfarande. Beständiga efterkontrollkvitton återupptas utan ny OCR eller dubbla fakturor; rensning binds till rätt ägare, dokument, faktura, kvitto och undersökt arbetsyterevision, med högst100 fångade kvitton per pass.

Gmail bevarar samma bekräftade processresultat om körningens slutstämpel eller lockstädning misslyckas efter ett fullständigt svar. Efterträdarens token påverkas inte. Kontrollens Gmail-/dokumentsteg visar delvis/okänd status och kan fortsätta befintlig avstämningsåterhämtning.

Node OCR-klienten och de faktiska CLI-ingångarna bevarar accepterat antal även om ett senare lease-, hämtnings- eller slutförandeanrop misslyckas. Osäker aktuell registrering räknas inte. Körningen hämtar inga fler jobb efter okänd status; CLI lämnar `needs_attention` och icke-noll-exit. Inga scheman eller nya återförsöksintervall har införts.

Dokumentförhandsvisning läser befintligt underlag. En gammal preview-POST utan uttrycklig bekräftelse/avvisning utför ingen ny tolkning. Ursprunglig maskintolkning hålls åtskild från användarens redigering. Begränsad, ägaravgränsad statistik sammanfattar granskningsorsaker utan dokumentnamn, innehåll eller personuppgifter. Denna nya statistik är ännu inte läst i produktion vid rapportens skapande.

### Säkerhetskopiering och återställning

Node kontrollerar dokumentfingeravtryck, bevarad import-BLOB och API-rådata mot de redan sparade hashvärdena vid skapa, verifiera och återställa. Hash saknad eller felaktig stoppar operationen; inga nya bevis tillverkas från osäkra äldre original. Återställning verifierar samma avkrypterade byte som senare skrivs och kräver ett nytt tomt mål.

Sites gör en separat, återupptagbar manifestkontroll av alla krypterade original efter kopiering, högst5 filer per steg. Förlorad, förändrad eller felägarbunden tidigare kopia stoppar färdigmarkering. Övergivet/misslyckat verifieringspass börjar om från0; vanliga begränsade steg behåller framsteg. Additiv migration0014 lagrar verifieringscursor, verifierade byte och starttid. Äldre kompletta backuper behåller ursprunglig tid och märks `copy_readback`; nya pass märks `manifest_pass`. Detta är en verifieringsperiod, inte en atomisk D1/R2-tidpunkt. Nuvarande kapacitetsgränser5000 rader/tabell och12MB snapshot är fortfarande öppna driftbegränsningar.

### MCP-åtkomstgräns

Den faktiska MCP-routen avvisar främmande/opaque/tom/multipel Origin med403 och annat än JSON med415 före bodyläsning. Autentiserade server-/OAuth-anrop utan Origin och legitima samma-origin JSON-anrop fortsätter genom befintlig identitetskontroll. Den tidigare syntetiska reproduktionen kunde skapa ett lokalt utkast och audit från browser-simple `text/plain`; nu ger samma anrop inga skrivningar. Granskningen gäller appgränsen, inte ett påstående om utnyttjad produktionscookie- eller gatewaypolicy. Inga mejl skickas av testerna.

## Oberoende granskning

Node-bankbevis, API/export och oförändrat-snapshot-gränser kontrollerades av en annan agent. Backupgranskning omfattade både Node26 fall och Sites22 fall, inklusive faktisk återställning av syntetisk snapshot till separat SQLite. Kontrollgranskningen omfattade request-replay, efterträdare och en verklig databaslåsning. Dokumentgranskningen band sitt slutomdöme till alla14 berörda hashvärden och körde181 Sites-,34 Node-,18 extra fault/race- och7 verkliga klient/CLI-fall. MCP-granskningen körde de24 verkliga routefallen och kontrollerade dispatcher/identitetsgränsen. Dessa riktade kontroller ingår inte som ett extra påslag på fullsvitens1093 tester.

## Produktion och kvarstående risk

Föregående programcommit är verifierad på main med Actions41092098871 och publicerad Sites33. Publiceringsrapporten innehåller samma projekt, source-commit, deployment och bevarade identitets-, DB/R2- och schemauppgifter. Inloggad mobilmeny och skrivfria vybyten fungerar; URL-historiken är ett separat pågående arbete.

Senaste lästa backup före Sites33:191/191 filer,63 448 066 byte, verifierad2026-10-30T01:27:38.129Z, tidigare `copy_readback`-omfattning. Den nya verifieringsfasen har inte körts mot produktionsbackupen och ingen destruktiv återställning har gjorts.

Gmail-hämtningen är fortsatt stale med pausat externt timschema. Moln-OCR Actions41092027444 lyckades16:40 men rapporterade processed0/failed0; färsk worker-kontakt bevisar alltså inte att granskningskön på183 dokument har behandlats. Faktisk cron-täckning och granskningsorsaker undersöks vidare utan schemaändring.

**Nytt separat P1-fynd:** Sites sparade API-original saknar ännu en levererad mottagningshash/projektionskontroll. Ändrad eller förlorad rådata kan lämna gamla projektionsfält betrodda. En separat kandidat stoppar detta och utökar backupens API-bevisomfattning; den är under oberoende review och ingår inte i denna leverans. Berörda områden är öppna i scorecard. Autentiska Swedbank-individrapporter och representativ godkänd dokumentkorpus saknas fortfarande. Inga9,5-poäng delas ut på grundval av syntetiska tester.

## Reproducerbara slutgrindar

Från kandidatens rot: `npm run check`, `npm test`, `npm audit --json`. Från `sites/`: `npm run check`, `npm test`, `npm audit --json`, `npm run build`. Befintliga låsfiler installerades i isolerad checkout före grindarna. Inga tillfälliga webbläsarsidor eller riktiga data ingår i den40-filsleveransen. Nästa steg är normal fast-forward till main, båda Actions-jobben, samma befintliga Sites-projekt och avgränsad produktionsdiagnostik.
