# Överlämning till integrationsansvarig

Leverans: [PR 66](https://github.com/sharbel0022/Mgeorge/pull/66), `feature/95-saas-readiness`, från verifierad main `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`.

Vid jämförelsen låg `integration/mgeorge-final-95` på samma bas. Dess `src/server.js` var byteidentisk med den version som de nya regressionerna först kördes mot. Ändringsansvaret för servern hölls till cookieparsern och valideringen av företagsbyte; bankfilens ändring gäller enbart privat nyckelfil. Denna skriftliga överlämning begär integration/review via PR:en. Den betyder inte att integrationsansvarig redan har accepterat ändringen.

## Berörda gemensamma gränser

| Område | Ändring | Integrationskontroll |
| --- | --- | --- |
| `src/server.js` | Två avgränsade hunks: exakt en sessionscookie; positivt säkert heltal i `contextVersion`. | Bevara befintlig sessionstilldelning, sessionHash, rollkontroll, callbacks och databaskontext. Klienten skickar redan aktuell version. |
| `src/bank.js` och `src/private-key-file.js` | Privat fil läses med ägar-/behörighets-/storleks-/identitetskontroll. | Andra bankändringar ska behålla det säkra felkontraktet och nyckelfingeravtrycket. Filkonfiguration måste uppfylla det dokumenterade POSIX-kontraktet. |
| `sites/scripts/lib/recovery-acceptance.mjs` | Kräver oberoende proveniens som fångats före restore. | Alla anrop till acceptansfunktionen måste skicka förväntad identitet och de tre källhasharna. |
| `sites/scripts/recovery-drill.mjs` | Fryser förväntningar före backup/export, kontrollerar 22 negativa fall och rapporterar mätgränsen. | Produktionsbackupmotorn och verkliga data ändras inte. Behåll särskilt spärrarna för leaser och tokenauktoritet. |
| `scripts/lib/saas-security-scope.mjs` med runners/verifierare | Ett gemensamt explicit testmanifest och ett strikt sparat releasekvitto. | Nya testfiler måste existera på samma commit. Kvitton från äldre manifest eller andra merge-checkouts avvisas. |
| CI | Ny fokusgrind samt separat full syntetisk återställning och formatprov. | Main ska köra om kontrollerna efter integration. Aktivera obligatoriska kontroller i repository-reglerna. |
| Migration | Nya kontroller av journal, beständig uppgradering och spärr mot gamla skrivningar. | Ingen ny SQL-migration ingår. En äldre app utan företagsgräns är inget tillåtet rollbackmål mot adopterade data. |

## Beteenden att kommunicera

En klient som byter företag måste skicka aktuell numerisk `contextVersion` från företagskatalogen. Saknat eller ogiltigt värde ger nu 400; en gammal men giltig version ger fortsatt 409. Ett tvetydigt HTTPS-cookiehuvud behandlas som oautentiserat och får inte välja en session att logga ut.

Nyckelfiler måste ligga utanför repositoryt, ägas av tjänstens användare och sakna grupp-/övriga rättigheter och symlinkkomponenter. Windows-filbehörighet verifieras inte av denna läsare; skyddad runtime-PEM är det kvarvarande alternativet på plattformar utan POSIX-ägarinformation.

Isolerad evidensåterställning kräver nu den förhandsfångade proveniensen. Att återanvända enbart ett återställt kvitto som sin egen förväntan är avsiktligt otillåtet.

## Releaseföljd

1. Granska diffen tillsammans med parallella bank-/backendändringar. Lös eventuella överlapp per beteende; kopiera inte en äldre komplett serverfil över nyare arbete.
2. Kör hela ordinarie CI och de två säkerhets-/återställningsjobben på det faktiska sammanfogade källträdet. [Frysta resultat](verification-results.md) är referensbevis, inte ersättning för denna körning.
3. Verifiera att skyddad main verkligen kräver jobben. Spara källa, körning, artefaktursprung och granskningsbeslut.
4. Hantera [riskregister O01–O13](risk-register.md) för det omfång som ska driftsättas. Aktivering av kunder/bankprodukter kräver eget dokumenterat beslut.
5. Följ separat deployment- och återgångsplan. Denna PR publicerar ingen Site, roterar inga riktiga nycklar, migrerar ingen produktion och mergar ingen annan branch.

Full PR-/main-acceptans gäller den faktiska källversionen. Om huvudgren eller backend ändras ska berörda tester och hela slutgrinden köras igen.
