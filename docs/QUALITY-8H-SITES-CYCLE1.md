# Åttatimmarsarbete – cykel 1B: Sites bankbevis, dokument och navigation

## Leveransomfattning

Utgår från main `a82ffbca211b5651e662c759c761bda2aefbf0f0`. Föregående Node-commit verifierades med GitHub Actions [41088814042](https://github.com/sharbel0022/Mgeorge/actions/runs/41088814042): både Node och Sites lyckades på exakt denna SHA. Arbetsbudgetens slut är fortfarande 2026-10-30 23:31:15 UTC; arbetet fortsätter efter denna delleverans.

Denna kandidat innehåller 21 frysta Sites-filer och syntetisk UI-evidens. Nästa cykels backupmigrering, kontroll-idempotens och registreringens efterkontroll ingår inte. Källmanifestet redovisar exakt innehåll; den avlägsna Git-trädhashen jämförs med den lokalt testade före push.

## Rättat och verifierat

- **Ångrad matchning:** en beständig automatspärr överlever omkörning, omstart, återimport och delposter. Ändring av redan allokerad betalares bankfakta avvisas; ekonomiska kopplingar bevaras.
- **Motstridiga original:** båda ankomstordningarna, äldre och nya samlingsföräldrar, ändrad föräldrarelation, saknat detalj-ID, organisations-/återföringsuppgifter och väntande individrapporter omfattas. Alla föräldrars original och restriktioner följer delposten.
- **Avvisad import:** bankens motstridiga fil/API-original och audit bevaras atomiskt utan en halv ekonomisk import. State-CAS och aktuell synklease gäller även felvägen. Vid full normal state-gräns lagras en liten global bankbevis-spärr med verklig audit-identitet; reservutrymmet är strikt begränsat till 256 byte.
- **Aktuella betalningspåståenden:** historiska allokeringar, belopp, datum och noteringar bevaras, men får inte fortsätta beskrivas som verifierade när relevant original eller dess samlingsförälder är spärrad. Negativa slutsatser om utebliven betalning kräver att hela det relevanta bankunderlaget är konfliktfritt. Utkast, granskning och sändningsgränser kontrollerar aktuell bevisbehörighet även om en äldre snapshot-hash matchar. Inga kundmejl skickades i testerna.
- **Dokumentoriginal:** OCR-slutförande, automatisk och manuell registrering läser om R2-originalet och kontrollerar faktiskt innehåll, storlek och SHA. Originalbyte mellan läsning och skrivning stoppas av ägar-/hash-/storleksvillkor i den atomiska kvittoskrivningen.
- **OCR-lease och historik:** databasklockan avgör om skrivningen fortfarande är tillåten. Först accepterat revisionskvitto styr senare jobbfält; ett senare timeoutbesked får inte förlora redan accepterad historik.
- **Exakta fakturanummer:** skiljetecken och inledande nollor bevaras i versionsmärkt dubblettidentitet. Fakturorna `AB-0594` och `AB0594` slås inte ihop.
- **Mobilnavigation:** native dialog, explicit initialfokus, tangentbordsloop, Escape, bakgrundsklick, fokusretur och stängning vid desktopbredd. Dold desktopmeny nås inte med Tab på mobil. Huvudinnehåll har fokusmål och hopplänk. Sökfält har etiketter och filter anger valt läge. Den svarta/vita designen, fyra startsideskort och huvudåtgärden behålls.

## Exakta slutgrindar

| Kontroll | Resultat |
| --- | --- |
| Node syntax och full svit | 65 filer; **407/407**, 0 fel/hoppade |
| Sites TypeScript | Exit 0 |
| Sites full svit | **531/531**, 0 fel/hoppade |
| Produktionsbygge | Exit 0, Build complete |
| Låsfiler/installationsunderlag | Oförändrade mot föregående färska CI-installation |
| Beroendegranskning | Båda låsfilerna granskade: 0 kända sårbarheter |
| Oberoende bankgranskning | 77 fokuserade tester + 8 oberoende negativa reprofall; inga kvarvarande Critical/Important-fynd i avgränsad patch |
| Oberoende dokument-/navigationsgranskning | Avgränsad granskning klar; regressioner och faktisk lokal mobilkontroll dokumenterade |

Totalt **938 godkända tester**, varav 75 nya Sites-fall sedan föregående leverans. Endast isolerade syntetiska data användes. Lokala loggar har prefix `/tmp/mgeorge-q8-sites-delivery-`; källhashar och testresultat finns i [manifestet](QUALITY-8H-SITES-CYCLE1.json).

## Webbläsarbevis och dess gräns

Lokal Chromium med syntetiskt demoläge kontrollerades i 320, 390, 768, 1024 och 1440 px utan horisontell dokumentoverflow. Vid 390 px kontrollerades de sex huvuddestinationerna, initialt fokus på Stäng, full Tab-loop, Shift+Tab, Escape och fokusretur. Vid övergång till 1440 px stängs mobilmenyn och huvudvyn får fokus. [Observationer](screenshots/quality-8h/ui-verification-cycle1.json) och [syntetisk menybild](screenshots/quality-8h/mobile-menu-cycle1.jpg) är sparade.

Webbläsarobservationen föregår den sista bankbevisrelaterade villkorsrenderingen i dashboard; navigationens komponent/CSS är identiska. De sista bevisetiketterna har renderingsregressioner, men detta påstås inte vara ett nytt fullständigt webbläsarprov av hela slutrevisionen. Fysisk mobil, andra motorer, skärmläsare och webbläsarhistorik återstår.

## Produktion, återgång och öppna fel

Före publicering är verifierad Sites-version **32** med samma projekt, D1/R2, identitet och befintliga anslutningar. Senaste lästa backupstatus: 191/191 original, 63 448 066 byte, slutförd 01:27:38 UTC. Den är en befintlig copy/readback-backup, inte nästa cykels separata slutverifieringspass. Återgång innebär återpublicering av befintlig version 32; ingen återställning eller radering av produktionsdata utförs. Denna del ändrar inget databasschema.

Bankhämtning är ansluten och hade lyckats 14:09:57 UTC. Gmail hade senast lyckats 29 oktober 15:00:48 UTC; det externa timschemat är uttryckligen pausat och förblir pausat. Ny publicering, korrekt version och autentiserade kontroller måste dokumenteras efter faktisk deployment och får inte antas av denna rapport.

Fortsatt kodarbete: kontrollförfrågningars beständiga idempotens, DB-klocka efter låsväntan, backupens originalhashar/slutpass, registrering som felrapporterar senare avstämningsfel, framtida OCR-heartbeat och läsande dokumentförhandsvisning. Externa krav på autentiska individuella Swedbankunderlag, OCR-facit och verksamhetstäckning kvarstår. Ingen poäng höjs till 9,5 genom denna lokala leverans.
