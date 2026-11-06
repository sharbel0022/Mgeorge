# SaaS-säkerhet och produktionsacceptans — Agent 5

Uppdrag: [PR 66](https://github.com/sharbel0022/Mgeorge/pull/66), branch `feature/95-saas-readiness`. Utgångspunkt är verifierad `main` `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Detta underlag gäller kodgranskning och syntetisk teknisk acceptans. **Kommersiell lansering och faktisk produktionsåterställning är inte godkända av detta arbete.**

## Vad leveransen ändrar

| Fynd | Tidigare beteende | Rättning och kontroll |
| --- | --- | --- |
| S01: otillräcklig kontroll av privat nyckelfil | En giltig RSA-nyckel kunde läsas genom symboliska länkar, från en delad fil och med obegränsad efterföljande data. | Begränsad läsning från en verifierad fildeskriptor; ägare, POSIX-behörighet, filtyp, sökväg, UTF-8 och filidentitet kontrolleras. 14 nya kontroller. |
| S02: tvetydig sessionscookie | `Object.fromEntries` valde sista `mg_session`; två cookies kunde välja en annan befintlig session och dess utloggning. | HTTPS-session kräver exakt en sessionscookie. 11 HTTP-kontroller använder två verkliga SQLite-företag med syntetiska uppgifter. |
| S03: företagsbyte utan förväntad version | HTTP-anrop kunde utelämna `contextVersion` och kringgå klientens avsedda jämför-och-byt-kontrakt. Medlemskontrollen fanns fortfarande. | Positivt säkert heltal krävs. Ogiltigt format ger 400; en giltig men gammal version ger fortsatt 409. Nio HTTP-fall inkluderar replay och samtidiga val. |
| S04: återställningsacceptans utan full ursprungsbindning | Rader, original och saldon kunde stämma trots ändrad backupidentitet eller ändrat bevarat källunderlag i evidensmappen. | Oberoende förteckning över rader/original före backup samt identitet och tre källhashar före restore. 14 regressioner; full övning har 22 negativa kontroller. Produktionskrypteringen ändras inte. |
| S05: sparade releasekvitton saknade strikt återkontroll | Ett tidigare rapportformat saknade full bindning till testurval, källträd och sparade loggbytes. | Separat verifierare kräver rätt commit/träd/PR-kontext, aktuellt kvitto, exakt testmanifest, SHA-256 och fullständiga resultat. Återställningskvittot kontrolleras mot exakt omfång. |

Rättningarna är avgränsade. Ingen databas- eller produktionsmigration tillkommer. Två ändringar i `src/server.js` berör cookieparser och valideringen av företagsbyte. `src/bank.js` använder den nya lokala filinläsaren. Delad backend ska integreras enligt [överlämningen](integration-handoff.md).

## Underlag per uppdragspunkt

| Uppdrag | Tekniskt underlag | Kvarstående acceptans |
| --- | --- | --- |
| Företag, roller, sessioner | [Företagsgränser](tenant-boundaries.md); Node-partitioner, Sites D1/R2, owner/admin/accountant/viewer, medlemsåterkallelse och gamla request-handtag. | Produktionsingress, användar- och företagsverifiering. Node har fortfarande en enda publik administratörsidentitet. |
| IDOR, CSRF, XSS, SSRF, injection, replay | [Kontrollinventering](security-inventory.md), befintliga fulla testsviter och nya HTTP-regressioner. | Oberoende säkerhetsgranskning av vald driftsättning och godkänt verkligt integrationsomfång. Ingen generell sårbarhetsfrihetsgaranti. |
| Samtidiga företag | Verklig SQL/D1-adapter och beständiga jobbkvitton för 1, 10 och 100 syntetiska företag. Ny barriär mäter faktisk samtidig aktivitet, högst fem jobb. | Kapacitet, kvoter och banklatens i avsedd drift. |
| Kryptering, rotation, hemligheter | [Nycklar och dataskydd](secrets-and-data.md); filbehörighet, AES-GCM, konfigurationsgenerationer, återkallade medgivanden och tokenåterställningsspärr. | Verklig nyckelförvaring, återhämtning och övad rotation. En miljövariabeländring är ingen datanyckelmigrering. |
| OAuth och BankID-gränser | Callback/origin, hashad state/cookie, engångskonsumtion, medlemskap, version, giltighet och separat företags-/kontobehörighet i befintliga banktester. | Registrerade redirect-adresser, leverantörsavtal och auktoriserad bankacceptans. Inga bankanrop görs i denna leverans. |
| Lagring och GDPR | Företagsbunden lagring/export; [dataförteckning och kvarstående krav](secrets-and-data.md). | Godkända roller, avtal, retention, registerutdrag och avsluts-/gallringsprocess. |
| Audit och revisionsspår | Företags-/aktörsbunden audit; tester för atomisk import och audit, rollback och frånvaro av falska lyckade kvitton. | Central åtkomst, bevarandetid, larm och eventuellt separat ändringsskyddad loggförvaring. |
| Backupintegritet | Autentiserad kryptering, exakt originalförteckning, hashkontroll och företagsbindning. | Aktuell verklig kopia, separat förvaring, nyckelåtkomst och övervakning. |
| Isolerad återställning | [Återställningsrapport](backup-recovery.md); full storleksövning, separat formatprov och negativa kontroller. | Tillåtet verkligt dataurval, verklig nedladdning, aktivering och full RPO/RTO. |
| Migration och rollback | SQL-journalens fullständighet och ordning, beständig uppgradering/omstart, bevarade ekonomiska värden och avvisning av äldre obundna skrivningar. | Godkänd rollback per release. Äldre app utan företagsisolering får inte köras mot adopterade företagsdata. |
| Rate limits och resurser | Beständig inloggningsspärr; request-/svarsgränser, deadlines, retry/cooldown, samtidighetsgräns och replaykvitton. | Verklig proxy, globala kvoter, övervakning och belastning i målmiljön. |
| Release- och säkerhetsgrindar | CI, separat kvittoverifierare, [releasegrindar](release-gates.md) och [riskregister](risk-register.md). | Administratörens branch protection och namngivet releasebeslut. |

## Så ska evidensen läsas

[Verifieringsresultaten](verification-results.md) anger huvudcommit, faktiskt GitHub-checkout, jobb och testantal. Ett PR-jobb kör normalt GitHubs merge-commit; den skiljs uttryckligen från branchens huvudcommit och från eventuell senare merge till main. Frysta RED- och GREEN-loggar i [evidence](evidence/) visar att de specifika regressionerna först upptäckte bristerna och därefter passerade.

Alla bank-, Gmail- och kunddata i dessa tester är syntetiska. Fulla sviter kan innehålla samma tester som fokusgrinden; deras antal får inte summeras som oberoende säkerhetsfall. Node 22 och Node 24 är två körmiljöer för samma tester. Grönt CI, godkänd intern säkerhetsacceptans, faktisk deployment och rätt att öppna kommersiell SaaS är skilda beslut.

Exekveringsmiljön i arbetssessionen blev otillgänglig. Efter det har verifieringen gjorts i GitHub Actions med låsta beroenden; inga lokala resultat har tillskrivits den otillgängliga miljön. Publicerade artefakter innehåller syntetiska loggar och sammanställningar, inte kundoriginal eller privata nycklar.

## Läsordning för integration och release

1. [Verifieringsresultat](verification-results.md) och [riskregister](risk-register.md).
2. [Företagsgränser](tenant-boundaries.md), [kontrollinventering](security-inventory.md) och [nycklar/data](secrets-and-data.md).
3. [Backup/restore](backup-recovery.md) och [releasegrindar](release-gates.md).
4. [Integrationsöverlämning](integration-handoff.md), tillsammans med befintliga [kommersiella lanseringskrav](../saas/COMMERCIAL-LAUNCH-REQUIREMENTS.md).

Arbetet ändrar inte det tidigare produktionsbetyget eller hävdar 9,5/10. Aktuella produktionsförhållanden, avtal och juridiska beslut måste styrkas separat för det kundomfång som ska öppnas.
