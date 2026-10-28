# Mgeorge V4 – plan och verifieringsgräns

Bas: hämtad `origin/main` `f549293`, Sites 30 och mergad PR #12. Arbetsbranch: `codex/mgeorge-v4-bank-verification`. Uppdragets datum: 2026-10-28.

1. **Inventering och baslinje — klar.** V2/V3, PR #12, Sites 30, src/sites/tests/migreringar/CI granskade. Baslinje 291 Node + 357 Sites. Se V4-rapporterna i docs/.
2. **Bankkanaler — utredda; verklig rapportåtkomst externt blockerad.** Officiella källor, avtal, autentisering, kostnader och exakta förutsättningar i [kanalrapporten](docs/V4-SWEDBANK-CHANNELS.md). AIS antas aldrig innehålla Bankgirodetaljer. Ingen låtsasadapter eller portalautomation byggs.
3. **Bankbevis — implementerat och lokalt verifierat.** Gemensam strikt XML-läsare i befintliga importmotorer; namespace/profil, tvetydigheter, antal/total, riktning och stabil bankidentitet. Rapporterade identiteter är filens påståenden; verklig MIG/XSD och avsändare kräver bankens original/specifikation.
4. **Återhämtning — implementerat och lokalt verifierat.** Fencade bankmutationer, beständiga bank/Gmail-försök och Retry-After, backupavbrott, giltigt detaljmedgivande och beständiga efterkontrollvarningar. Behåll befintliga scheman/köer.
5. **UI och revisionshistorik — implementerat och lokalt verifierat.** Sex separata bankfält, mobilkort, öppna underlag, specifik betalningshistorik med sidindelning och rättelser. Fel/stopp får konkret åtgärd. Granska integritet, tangentbord och skärmbredder 320–1440.
6. **Slutkontroll — godkänd lokalt.** Full Node/Sites, syntax, TypeScript, produktionsbygge, beroendegranskning, kryptering/återställning i separat syntetisk miljö, webbläsarflöde och oberoende kodgranskning. Alla regressionsfynd åtgärdas och berörda kontroller körs om.
7. **Leverans — färdig för granskning i [PR #13](https://github.com/sharbel0022/Mgeorge/pull/13).** Små commits, granskbar PR, inventering, scenariomatris, säkerhet/rollback, testresultat och skärmbilder. Ingen merge/publicering eller produktionsmigration utan uttryckligt godkännande.

## Oföränderliga krav

- Inget kundnamn, OCR, fakturanummer eller bank-ID skapas genom beloppsgissning.
- Bankbetalare, fakturakund, fakturaförslag och manuell verifiering hålls åtskilda.
- Samma motorer, original, SHA-256, konton, medgivanden, D1/R2, backuper och revisionshändelser bevaras. Additiva migreringar tillämpas inte i produktion här.
- Tester använder syntetiska tillfälliga databaser och kontrollerade providersvar. Starta aldrig Node med företagets .env för test/preview.
- Inga bankbetalningar, kundutskick, dubbla scheman eller automatisk destruktiv databasrollback.
- Verklig företagsrapport, avtalad MIG/kanal och produktionsflöde får inte räknas som godkända av syntetiska tester. Målet får inte markeras helt uppnått medan dessa acceptanskriterier är blockerade.

## Beslutsstatus

**EXTERN BLOCKERING – INTE FULLSTÄNDIGT PRODUKTIONSVERIFIERAT.** Tekniskt oberoende arbete fortsätter till granskbar leverans. Krav 12–13 behöver autentiskt godkänt bankunderlag, bekräftad företagskanal samt senare uttryckligt publiceringsgodkännande.
