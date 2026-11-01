# Kontrollerade kontoalias och betalningens faktiska fältkällor

Datum: 2026-11-01. Kompletteringsbas: `88b8584f7895419bbf68685a72f35c33d26b580e`, föregående programkod `a8453a1`, Sites 46. [Full kravmatris](PAYMENT-VERIFICATION-ACCEPTANCE.md), [hela kedjan](END-TO-END-PAYMENT-VERIFICATION.md) och [arkitektur](PAYMENT-VERIFICATION-ARCHITECTURE.md).

## Varför denna komplettering behövdes

En ny kontroll mot det ursprungliga uppdragets 16 avsnitt identifierade två interna kravområden som kunde förbättras utan mer bankdata: uttryckliga provider-alias vid Nodes manuella originalrelation samt korrekt proveniens för faktiskt visade betalningsfält. De behandlas som fortsatt arbete inom samma mål. Föregående granskning/publicering var framsteg, inte ett godkännande av hela produktionskedjan.

## Node: faktiskt banklevererat alias

`src/bankgiro-links.js` kontrollerar rapportkontot mot den aktuella ägarens valda och entydiga SEK-kontoresurs. Explicit IBAN/BBAN/CPAN i `all_account_ids` eller en tillåten typ i `account_id.other` kan styrka aliaset. Liknande siffror, borttagna nollor, en annan ägares konto eller ett ovalt konto räcker inte.

Kontrollen återupprepas vid kandidat, bekräftelse och presentation. Bekräftelse ligger under befintligt `BEGIN IMMEDIATE`. Ett borttaget/tvetydigt alias, utgånget medgivande eller ändrat kontoval gör en äldre relation stale; den kan fortfarande återtas. `reported_account` bevarar rårapportkontot och `account_relation` anger bankresurs, scheme och exakt provider-fält.

Parserns ursprungliga `exact_match:false`, rapporthash, råfält, bankhändelse, fakturor, allokeringar och saldon ändras inte. Den manuella relationen blir inte bankverifierad insättningsidentitet och ger ingen ekonomisk import eller automatisk allokeringsrätt. Det verkliga 625-fallet saknar fortfarande det nödvändiga aliaset i sin aktiva kontoresurs.

Rött/grönt: nio nya riktade aliasregressioner reproducerade avslag före rättning; den utökade riktade kedjan passerade. Både positiva provider-typer och negativa fall för saknat/tvetydigt/borttaget alias, fel ägare, fel valuta, avvalt konto, fel UID/status och bibehållna inledande nollor är testade. Oberoende review körde dessutom sex negativa kontofall utan fel.

## Node: rapportfält, fakturaförslag och råsektion

Före rättningen kunde AIS-förslag för `0600` märkas som förslag på samma rad som en manuellt länkad rapportreferens `0599`. Förslagsmarkeringar filtreras nu mot den faktiskt visade rapportreferensen. Det är en läsande visningsregel; inga nya fakturaförslag, motpartsrelationer eller allokeringar skapas.

Bekräftade fakturanummer och bokningar visas fortsatt. Vid avvikande referens syns en separat notis. `project().payments` bevarar de omtolkade rapportfältens `payer_evidence`, `reference_evidence`, `account_evidence` och cellproveniens samt rapportdatum/Bankgiro. Därmed är den utfällbara rapportsektionen inte längre `[{}]`; AIS-rådata ligger kvar i en separat sektion.

Fryst UI-baslinje på 88b8584: **7/12 → 12/12**. Fem nya UI-regressioner gick från rött till grönt. Oberoende granskning verifierade HTML-escaping med syntetiska `script`/HTML-/citattecken i rådata samt oförändrade indata och ekonomiska poster.

## Sites: en källa per faktiskt visat fält

Den gemensamma rena `bankPaymentFieldSources` används av bankpresentationen, betalningskontrollen och dashboardens utfällbara råsektioner. Den väljer individuellt kopplat rapportfält, faktiskt använt detaljfält eller transaktionsoriginal enligt samma prioritet som det visade värdet. Betalarnamn och referens kan ha olika källor.

Identifierarvärde, typ/scheme, utfärdare, ursprungligt råvärde och fältsökväg hämtas från just den valda betalarens evidens. En detalj-COID/SE kan därför inte beskrivas med AIS-radens tomma identifierartyp. Referensens råfält använder `candidate.rawValue`; normaliserad huvudreferens och hela ursprungliga banktexten hålls isär. Detaljreferenser ärver inte AIS-postens OCR-delar eller oanvänd detaljmetadata.

Samma tidigare ägar-/storleks-/hash-/kuvert-/återspelningskontroll av använda detaljoriginal gäller fortfarande. Avsaknad eller avvikelse ger blockerad/granskningsstatus. Originalen och domänens avstämnings-/allokeringsregler ändras inte.

## Sites: samma referenskälla även för fakturaoriginalet

Oberoende review reproducerade referens `0599` från rapporten tillsammans med faktura/original `0800` från en oanvänd detaljreferens. `bankPaymentInvoiceAssessment` och panelens ämnesval följer nu den faktiskt valda referenskällan. I regressionerna återläser GET det ägda originalet för `0599` och uttryckligen inte originalet för `0800`.

En befintlig bokning mot `0800` skrivs inte om. Den visas som faktisk bokad faktura med referenskonflikt, medan referensens `0599` hålls som separat förslag/kontroll. Betald status, saldo, allokering och historik bevaras; manuell originalrelation ger fortsatt ingen automatisk fakturaallokering.

Sites har **15 nya regressioner** i denna komplettering: sju fältkällor, två exakta råreferenser och sex faktura-/dashboard-/GET-fall. Samtliga reproducerades före respektive rättning och passerade efteråt. Oberoende slutreview körde de sex uppslagsfallen och verifierade både rätt originalread och bevarad tidigare bokning.

## Slutlig lokal verifiering och jämförbara mätningar

- **645/645 Node och 1126/1126 Sites = 1771 tester**, inga fel eller överhoppningar. Det är 35 fler fullsvitstester än föregående leverans.
- Syntaxkontroll av 92 filer, TypeScript och produktionsbygge godkända.
- Rotens audit och Sites produktionsaudit: 0 fynd. Full Sites-audit: 16 moderate utvecklingsfynd, 0 high/critical; obligatorisk high-grind passerar.
- Package-/lockfiler och CI-skript oförändrade. Befintliga lokala installationer återanvändes där miljö/inputs gäller; exakt CI på levererad kod körde nya rena installationer och båda jobben passerade.
- Oberoende granskningar utan kvarstående konkreta Critical/Important/P2-fynd inom ändringarnas omfattning.

Samma befintliga 15-fallskorpus kördes på basrevision 88b8584 och slutkandidaten: **10/10 korrekta manuella relationer, 0 falska relationer/allokeringar/ekonomiska dubblettfall och 15/15 oförändrade saldon** före och efter. Namn och exakta referenser visas fortsatt 8/8. [Före](measurements/payment-evidence-sources-linking-before.json) / [efter](measurements/payment-evidence-sources-linking-after.json) bevarar samma korpus-/facit-/runnerhashar och olika källhashar. Bearbetningstid: 8,6197 → 8,3860 ms per filförsök, 16 försök; engångsobservation utan produktions-SLA eller statistisk hastighetsförbättring. Korpusen testar Sites-domänen, inte Nodes nya aliasgräns eller produktionsidentitet; dessa har egna gränsregressioner ovan.

Mätningen kördes före commit på bas-HEAD med ändrad slutkod. Dess källhash `657992c59e0a4a18d74db797133d21ce1085d7111fe97edf76adc28d1f6ccc59` räknades om på den committade koden `cda00d9` och stämmer exakt; artefakternas ursprungliga metadata har inte skrivits om. Tidigare konto- och Node-matchningsmätningar bevaras som evidens för oförändrade relevanta kodvägar; inga nya förbättringar av produktionsprecision tillskrivs dem.

## UI och driftgräns

[Desktop](screenshots/payment-evidence-sources/desktop.png), [mobil](screenshots/payment-evidence-sources/mobile.png) och [protokoll](screenshots/payment-evidence-sources/verification.json) visar faktisk komponent/CSS med syntetisk normalisering och detaljtolkning. Vid 1440/390 px: elva steg, korrekt COID/SE/identifierare/fältsökväg och ingen dokumentoverflow. Fullsidig CDP-skärmbild gav timeout; avgränsade skärmbilder i samma flik lyckades. Tillfällig previewfil är borttagen och den ägda servern stoppad.

## Verifierad main- och Sites-leverans

Main-kod: `cda00d9c976ea83dfb9984fac21a8a727c9715bc`. [Actions 41354521234](https://github.com/sharbel0022/Mgeorge/actions/runs/41354521234) är success på exakt SHA, både Node och Sites inklusive rena installationer. **Sites 47 succeeded** i samma projekt `appgprj_6adf2f7f7e848191b64192161886b528` och på [befintlig produktionsadress](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site). Source `9c89b4778f179e908bd407f83277bdb4af14374d`, identiskt GitHub-/Sites-träd `8e7d5eb47dcdb5e0e70ef51e0631aed3cf945a62`, deployment `appgdep_6ae7b5fb2fa8819190e7cd172a6d8f0a`, miljörevision 9. [Fullt leveranskvitto](PAYMENT-EVIDENCE-SOURCES-PUBLICATION.json) skiljer lokalt komprimerat arkivhash från Sites normaliserade tarhash.

Läsande GET och faktisk autentiserad dialog visar elva kontrollsteg. Intakt AIS-original passerar; kontoalias/rapportidentitet blockerar fortsatt. Ett ägt intakt fakturaoriginal finns som granskningsförslag utan registrerad 0599. Hela tillståndet och ekonomiska projektionen är oförändrade: **revision 40 → 40, fem fakturor och noll allokeringar**. Verifieringen är `preview`, `changed:false`, `automaticEligible:false`. Produktionsdialogens faktiska bredd är 1920 px utan dokumentoverflow; 390 px-evidensen ovan gäller syntetisk komponent.

Åtkomstpolicy, publik webbplats med autentiserad privat arbetsyta, auth-klient, befintliga schemaobjekt/lägen, miljörevision 9/variabelmetadata, DB-bindning/tabellista och oförändrad R2-/DB-deklaration är kontrollerade före/efter. Inga schema-, hemlighets- eller databasmigreringar. Backup 191/191 har godkänt manifestpass men 113 äldre API-poster saknar kvitto; ingen full katastrofåterställning påstås. Föregående sparade Sites 46 är kodåtergången.

Ingen verklig fakturaregistrering, originalrelation, allokering, bank-/Gmail-synk, betalning eller kundmejl utfördes. Alla berörda poäng behålls. **Exakt fortsättningspunkt:** bankstyrkt mottagarkontoalias/Bankgirorelation och uttryckligt rapport-/AIS-samband, därefter ordinarie original-/dubblett-/motpartsgranskning och registrering av 0599, separat kund-/tredjepartsattest samt nytt skrivfritt förslag före separat administratörsgodkänd faktisk allokering. Hela målet förblir ej slutgodkänt.
