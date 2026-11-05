# Driftändringar: underlag för granskning

Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Dessa ändringar är ännu inte produktionsbevis innan slutrapporten anger publicerad version och faktiska efterkontroller.

## Reproducerade fel och åtgärder

1. **Gmail kunde rapportera bakgrundsflödet redo efter enbart en manuell hämtning.** Två nya beteendetester misslyckades med `true !== false` före fix. API:t skiljer nu `fetch_ready` från `background_ready` och anger säkra sammanfattade orsaker. En konfigurationsflagga, manuell hämtning eller OCR-heartbeat bevisar inte det externa schemat. Ett ytterligare regressionstest visade att en ansluten lokal OCR-reserv måste räknas även när molnet saknar kontakt; det är rättat.
2. **Bankens returadress var låst till den tidigare domänen.** Tre beteendetester misslyckades före fix. `ENABLE_BANKING_REDIRECT_URL` kan nu anges i skyddad serverkonfiguration; endast en exakt HTTPS-returadress till `/api/bank/callback` godtas. Begärans origin måste stämma, och den färska provider-applikationen måste ha samma exakta adress registrerad innan autentisering startas. Saknad inställning bevarar äldre installationers adress; fel origin visas och stoppas. Ingen providerregistrering, nyckelrotation eller produktionsvariabel har gjorts i denna ändring.
3. **En befintlig anslutning i återauktorisering saknade en separat kontroll av det kvarvarande medgivandet.** Ny uttrycklig ägaråtgärd läser endast bankens färska sessionsstatus för de redan sparade valda kontona. Samma ägare, lås, applikationsgeneration, bankidentitet, kontocache, urval, medgivande och giltighet måste bestå fram till transaktionen. Företagskopplade anslutningar får inte falla tillbaka till den äldre vägen. Utgångna/återkallade medgivanden, annat konto/bank/PSU, spärrar och förlorade lås stoppas. Giltigheten kan endast förkortas. Ekonomiska register, kontoval och automatikschema ändras inte. Funktionen finns som knapp, POST-route och autentiserat MCP-verktyg.
4. **Moln-OCR hade inget observerat nytt körningsförsök på flera timmar.** Den beständiga kön får även en start efter lyckad `Payment control checks` för exakt aktuell `main`-commit från samma repository. Pull requests, forks, annan branch, äldre SHA, misslyckade och ofullständiga körningar avvisas både före jobbstart och av en körbar kontroll före credential-steget. Tidigare manuella/periodiska triggers, aktiveringsflagga, hemlighet, concurrency och högst sex OCR-jobb per körning bevaras.

## Lokala kontroller hittills

- Node 24.22.1, Linux. Root syntaxkontroll: 172 JavaScript-filer godkända.
- Sites typ-/beroendekontroll godkänd med en egen fysisk kopia av oförändrade verifierade beroenden. Första försöket stoppades korrekt av beroendevakten eftersom `node_modules` var en symlänk; vakten kringgicks inte.
- Gmail-suiten: 76/76 efter första fix. Bank-suiten: 133/133 efter returadressfix. Därefter 225/225 kombinerade bank/Gmail-regressioner och 24/24 senaste fokustester, inklusive ytterligare samtidighetsfäktningar och lokal OCR-reserv. Antalen överlappar och ska inte summeras.
- OCR-trigger/klient: 54/54. Säkerhetsfallen omfattar fel event, fork, fel branch, saknat repository, ändrat SHA och misslyckade/ofullständiga kontroller.
- Full integrerad verifiering och oberoende granskning tillkommer efter sammanslagning av arbetsspåren.

### Oberoende bankgranskning och korrigering

Granskningen av `9c4a8b0f09e567c02bbf0a0747f74239e56a0df1` hittade tre konkreta bankgränsfall och en separat OCR-triggerlucka. För bankdelen reproducerade 12 av 14 nya beteendeprov fel före korrigeringen; två befintliga spärrfall var redan säkra. Efter korrigeringen passerar samtliga **37 riktade bankprov**, inklusive ett ytterligare prov på adoption omedelbart före commit. Sites typ-/beroendekontroll passerar också.

- Foundation-kontexten avvisar ett faktiskt företagsadopterat äldre konto redan innan bankens synk-scope finns. Databasens befintliga auktoriseringsadapter håller dessutom den atomära spärren mot samtidig adoption; åtkomst till företagstabeller har inte öppnats för bankservicen.
- Revalideringen använder nu en strikt läsgrind. En ny okänd konto-spärr, väntetid eller stoppad försöksräknare avvisas före reservationen, i reservationens jämförelse och vid den sista läsgränsen. Vanliga transaktionshämtningars befintliga regler ändras inte. Ändringar under ett redan påbörjat provideranrop kan inte återställa driftstatus.
- Ett beständigt ägarbundet revisionskvitto avgör om sluttransaktionen redan lyckades när svaret försvinner. Kontrollerat återförsök återger samma kontrolltid utan nytt bankanrop. Ändrad kontokontext godtar inte gammalt kvitto. Ett oläsbart kvitto lämnar utfallet okänt utan en påhittad failed-händelse. Ett förlorat lås efter commit medför inga extra skrivningar.

Återgranskningen bekräftade dessa rättningar med 43/43 prov, men ett separat kombinationsfall upptäckte ett för kategoriskt felmeddelande när commitsvaret försvann, leasen ersattes och kvittot inte gick att läsa. Två nya negativa utfallsprov föll före följdrättningen. Den vägen ger nu `BANK_CONSENT_OUTCOME_UNKNOWN`, HTTP 503 och `status_unknown: true`, med uppmaning att läsa aktuell status. Den påstår varken att kontrollen lyckades eller att ingenting sparades. Samtliga **38 riktade bankprov** passerar efter följdrättningen; antalen överlappar tidigare körningar.

Proven använder verklig servicekod, kryptering och SQLite med syntetiska identiteter; bankens HTTP-gräns är ersatt. Dessa resultat bevisar inte ett verkligt återställt produktionsmedgivande. Full integrerad verifiering och slutlig oberoende återgranskning följer.

## Faktisk drift under arbetet

Det befintliga Gmail-schemat återaktiverades 2026-11-05 16:46 UTC med oförändrad prompt och timkadens. Plattformen redovisar därefter en faktisk körning för 17:00 UTC, start 16:55:47.378927 och slutförd 16:58:59.099439. Resultatet anger sex nya bilagor, 15 dokument i OCR-kön och inga säkra nya matchningar eller mejlutskick. Appens eget kvitto visar senaste lyckade hämtning 16:56:59.219 och slutfört automatikanrop 16:57:23.901. Detta är separat bevis från schemaplattform och applikation; appens `external_schedule_verified` förblir korrekt falsk eftersom appen själv inte läser schemaplattformen.

Vid samma kontroll var moln-OCR:s senaste kontakt fortfarande 10:45:29.762 UTC. Denna lucka är inte löst enbart av att ett nytt workflow skrivits. Produktionsverifiering av den nya triggern och verklig köprogress krävs före slutbedömning.

Dagens befintliga backup slutfördes och kontrollästes separat till 362/362 original. Se recovery-spårets rapport för exakt omfattning, snapshotbegränsning och isolerad återställningsövning. Nya Gmail-bilagor efter den frysta backupen omfattas inte av den tidigare snapshoten.

## Begränsningar och externa källor

Bankens aktuella återauktoriseringsstatus är ännu inte återställd. Ett framtida datum är inte ett aktuellt bankmedgivande. Ny bankanslutning kräver korrekt providerregistrerad returadress och eventuell kontoinnehavaridentifiering; inget sådant har simulerats i produktion. En verifierad äldre kontosession bevisar inte Bankgiro-rapportåtkomst eller saknad betalaridentitet.

GitHub anger att schemakörningar kan försenas och i hög belastning falla bort. Detta är en generell begränsning, inte en bevisad orsak till just detta uppehåll: [Troubleshooting workflows](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows). Det privilegierade `workflow_run`-flödet kräver särskild avgränsning; därför kontrolleras ursprung, event, branch och exakt SHA och inga PR-artefakter används: [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
