# Plan: verifierbara bankbetalningar

Utgångspunkt 2026-10-28: senaste hämtade `origin/main` = `a024216`. Arbetsbranch `codex/bank-evidence-production-safety`. PR #11 är mergad; PR #9 är ett öppet utkast. Ingen publicering, produktionsmigration, schemaändring, betalning, kundutskick eller merge ingår.

## Faser

1. Inventera befintliga skydd och reproducera fel med syntetiska data. Kör båda befintliga testsviterna och granska PR #9/#11.
2. Täpp till belagda luckor i bankimport, källspårning och atomisk avstämning. Bevara original, SHA-256, OCR, fakturanummer, bankreferenser och betalare separat.
3. Kontrollera beständiga jobblås, begränsade återförsök, väntetider, återstart och larm för bank, Gmail, dokument och backup. Implementera saknade skydd utan att aktivera jobb.
4. Verifiera svartvitt responsivt UI i desktop och mobil med en isolerad syntetisk arbetsyta. Spara skärmbilder och testa faktauppgifter separat från förslag.
5. Kör slutlig Node/Sites/TypeScript/build/säkerhets- och integrationskontroll, oberoende kodgranskning och regressioner. Leverera PR och en evidensbaserad slutrapport med exakta externa hinder.

## Risker och skydd

- Fel betalare/OCR: inga identiteter skapas från belopp eller fakturaförslag; saknad bankidentitet visas som `Betalare okänd`.
- Fel konto/valuta/datum/återföring: verifiera bankkällan före import och före automatisk allokering. Belopp räknas i heltalsören.
- Dubbla eller samtidiga jobb: beständiga lås, atomiska transaktioner och återläsning under lås; omkörning får aldrig skapa ytterligare betalning.
- Skadliga eller ofullständiga original: avvisa felaktig XML och ofullständiga grupper; bevara original och hash.
- Produktion och hemligheter: använd inte företagets `.env`, databas eller bilagor för tester. Ändra inte anslutningar, scheman, hemligheter, befintliga backuper eller revisionslogg.
- Bankåtkomst: AIS-medgivande bevisar inte rätt till individuella rapporter. Kräv företagets bekräftade rapportavtal och behöriga kanal; inget åtkomstskydd kringgås.

## Testmatris

| Område | Verifiering |
| --- | --- |
| Betalaridentitet och referenser | Okänd betalare, samma belopp/flera kunder, inledande nollor, fel OCR, motstridiga referenser och separat fakturaförslag |
| Individuell specifikation | camt.053/.054 och CSV, rätt/fel konto, datum, bankreferens, valuta, total och komplett grupp |
| Avstämning | Delbetalning, överbetalning, flera fakturor, kundrelation, fakturasaldo, återföring och samtidiga transaktioner |
| Idempotens | Samma original flera gånger, parallella importer/jobblås, avbrott och omstart |
| Felåterhämtning | Bank nere, timeout, saknat dokument, skadad XML, begränsade försök, beständig väntetid och synligt fel |
| Backup | Autentiserad kryptering, hashkontroll, fel nyckel, ändrat/saknat original och återställning till separat syntetisk databas |
| UI | Desktop och mobil, ingen horisontell scroll, betalare/faktura/OCR/belopp/datum/status och utfällbar källspårning |
| Leverans | Node + Sites, syntax, TypeScript, build, beroendesäkerhet, kritisk granskning och granskbar PR |

## Acceptans A–J

A/B: inga påhittade betalare eller OCR från förslag. C: autentisk individuell specifikation kan importeras och bindas till rätt samlingspost (syntetisk integration lokalt; verklig fil externt). D: endast entydiga bankbevis kan automatmatchas. E: ingen dubbelregistrering vid omkörning/samtidighet. F: alla kritiska tester passerar utan kända regressioner. G: tydliga huvuduppgifter i responsivt UI. H: säker återhämtning och synliga larm. I: befintlig data/original/integrationer bevaras. J: slutrapport med verifierat resultat och externa begränsningar.

Produktionsverifiering och verkligt Swedbankformat markeras aldrig som godkända enbart utifrån lokala tester. Allt lokalt verifierbart färdigställs före slutrapport om extern blockering.
