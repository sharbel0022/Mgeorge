# Verifierad progress

## Fas 1 — inventering och baslinje, 2026-10-28

- Läste hela uppdragsfilen och hämtade senaste `main` samt PR #9/#11. Ren arbetskopia; separat branch skapad från `a024216`.
- GitHub bekräftar att PR #11 är mergad och PR #9 är öppet utkast. PR #11 innehåller redan bankfakta/förslagsseparation och moln-OCR; kompletterande riskgranskning pågår.
- Baslinje: **251/251 Node-tester**, **326/326 Sites-tester**, inga fel. Endast tillfälliga syntetiska databaser och mockade externa svar användes.
- Tre parallella granskningar: Node-bankbevis/atomik, Sites-bankimport/avstämning samt jobb/backup/PR-historik. Viktiga fel ska reproduceras före kodändring.
- Ingen produktionsåtkomst eller ändring har utförts. Befintliga anslutningar, scheman, nycklar, databaser, original och backuper lämnas i driftmiljön.

## Kvar att verifiera

Faser 2–5 enligt PLAN.md. Företagets verkliga rapportavtal, individuell Swedbankfil/MIG och OCR-längdregel är externa förutsättningar; tidigare rapporter ersätter inte aktuell verifiering.

## Fas 2 — bankbevis och atomik

- Reproducerade Node-fel före fix: fel/mixat kontonummer kunde relabelleras vid filimport; återföringsmarkörer ignorerades; automatisk bevisanalys föregick skrivlåset. Parserkontroller och en gemensam transaktion för analys/allokering/fynd/revision är införda.
- Reproducerade Sites-fel före fix: återföring `1`, tvetydiga XML-fält, felaktiga datumsuffix, tvetydig/skadad CSV, trunkering av bankens betalarnamn och tecken/riktning i detaljbelopp. De riktade regressionerna passerar efter fix.
- Exakta bankfilbytes och bevarad API-JSON får separata SHA-256-fält i Node. Additiva migreringar bevarar register och original. Historiska hashvärden beräknas vid uppgraderingen och bevisar inte originalets tidigare historik.
- Två verkliga syntetiska Node-processer importerar och avstämmer samma fil: en transaktion, en allokering och en automatisk revisionshändelse även efter omstart/återimport.
- Oberoende slutgranskning hittade ytterligare två blockerande bevisluckor: Sites generiska import litade på klientrader med bifogat dokument; Node accepterade negativ API-magnitud och saknad API-hash. Dessa åtgärdas innan fasen avslutas.

## Fas 3 — återhämtning och backup

- Reproducerade processlokala Node-lås och förlorad schemaväntetid efter omstart. Beständig lease, tokenkontroll inne i skrivtransaktion, tre begränsade automatiska försök, väntetid och beständigt synligt larm är införda. Bankens/Gmails befintliga intervall behålls.
- Reproducerade Sites-backup som kunde skriva över en komplett snapshot efter en fördröjd läsning. Fix: villkorad låsning, färsk checkpoint under låset, separat objektväg per snapshot-lease och kontroll av utgånget/utbytt lås. **10/10 backupintegrationstester** passerar; oberoende kodgranskning fann inget blockerande fel.
- Exakt Gmail `Retry-After` och beständig väntetid förstärks innan slutkontroll.

## Fas 4 — lokal UI-verifiering

- Sites-devserver på `127.0.0.1:5173` och endast minnesbaserat demoläge. Sex separata huvudfält på desktop; OCR visas uttryckligen som saknad även i mobilkorten. Tekniska uppgifter är utfällbara.
- Webbläsartest: individuell syntetisk camt.054 kopplades till rätt demosamlingspost via konto/datum/referens/total. `Syntetisk betalare AB` och `000018` visas från filen; saknad faktura ligger kvar för granskning. Inga verkliga ekonomidata används i testet.
- Desktop 1440 px och mobil 390 px kontrollerade; dokumentets scrollbredd överskrider inte viewporten, och mobilens detaljdialog ryms. Bilder finns i `docs/screenshots/safety/`.

## Avvikelse vid lokal förhandsvisning

Ett felriktat `npm run dev` startade kort den lokala Node-servern med befintlig `.env` innan processen stoppades. Startup öppnar den lokala databasen (additiva hashkolumner fanns efteråt) och kontrollerar dagens backup. Skrivskyddad uppföljning visade senaste ekonomiska revisionshändelse från 10:07 UTC och backupens ändringstid 20:33 UTC, före denna start. Servern stoppades före 60-sekundersintervallet för bank/Gmail; ingen sådan hämtning startades. Produktions-Sites, anslutningar, scheman och nycklar ändrades inte. Händelsen redovisas för spårbarhet; den lokala databasfilen påstås inte vara byteoförändrad.

## Skrivskyddad driftstatus

MG-pluginens rena statusanrop bekräftade bankanslutning med befintligt sex-timmarsintervall, en komplett molnbackup med 37/37 original samt ansluten Gmail och konfigurerad moln-OCR. Ingen synkronisering, backupkörning, avstämning eller ändring anropades. Dessa svar verifierar befintlig driftstatus, inte den nya branchens produktionsbeteende eller tillgång till individuella Swedbankrapporter. Riktiga dokumentuppgifter sparas inte som testdata eller i Git.

## Fas 2–3 — slutligt verifierade

- Samtliga reproducerade bank-, hash-, konto- och proveniensluckor är rättade. Node kräver återtolkade, hashkontrollerade bankfakta och aktivt ägt valt SEK-IBAN före automatisk filavstämning. Alias/maskering/saknat kontobevis/utgånget medgivande stoppar automatiken; historiska kontoidentiteter bevaras.
- Sites generiska import bygger fakta ur serverläst original. Äldre bank_file-rader behöver versionsmärkt återverifiering och färsk manuell original-/kontokontroll; motstridiga äldre rader bevaras och spärras. Ingen extra disponibel betalning skapas vid återimport.
- Gmail respekterar beständig leverantörsväntetid även efter omstart och vid manuella försök. Additiv Sites-migration 0011 är endast förberedd i koden.
- Sites Gmail skyddar även fördröjda token/checkpoint/originalskrivningar samt OAuth/frånkoppling med D1-transaktionsfencing. Förlorat svar efter lyckad registrering får inte radera originalet. Nya regressioner passerar.

## Fas 4–5 — slutkontroller

- **291/291 Node-tester**, **357/357 Sites-tester**, inga fel/hoppade tester. **59 JavaScript-filer** syntaxkontrollerade; TypeScript passerar.
- Båda `npm audit` rapporterar **0 kända sårbarheter**. Oberoende granskning gav ytterligare regressioner för originalproveniens, saknad hash, tecken/riktning, kontoalias och förlorad lease; alla åtgärdade.
- Produktionsbygget avslutades med **Build complete**. Det färdiga bygget startades därefter med `wrangler dev --local` och lokala D1/R2-bindningar; ingen publicering skedde.
- Sites webbläsartest: individuell specifikation → rätt demosamlingspost → känt syntetiskt namn/OCR, utan påhittad fakturakoppling. Samma original visar `Redan importerad` och kan inte bekräftas igen.
- Sites kontrollerades vid 320/390/768/1024/1440 px utan horisontell dokumentoverflow. Mobilens detaljdialog ryms. Klasskrock mot bankanslutningens färgade kortfot rättades med separat betalningsklass; färdigt bygge verifierade neutral bakgrund/flexlayout.
- Node UI kontrollerades vid 1440 och 390 px i separat syntetisk preview. Sex bankfält, explicit okänd betalare, bank-OCR, rätt delbetalningsstatus och utfällbara bankdetaljer fungerar. Ingen horisontell dokumentoverflow observerades.
- [Slutrapport med acceptans A–J och exakta externa förutsättningar](docs/BANK-EVIDENCE-SAFETY-DELIVERY.md). Verklig individuell Swedbankfil/rapportkanal och företagets OCR-avtal kan inte verifieras lokalt och kvarstår som dokumenterade externa begränsningar. Ingen merge, produktionstillämpning eller aktivering ingår.

Återstår i leveransfasen: spara sista bilderna, avsluta ägda lokala previewprocesser och öppna granskbar PR mot main. Ingen ytterligare produktionsåtgärd behövs eller är tillåten i detta uppdrag.
