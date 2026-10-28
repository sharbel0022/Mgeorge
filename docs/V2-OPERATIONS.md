# Mgeorge V2 användning och drift

Öppna översikten för att se bekräftade inbetalningar, kvarstående kundsaldo, leverantörsfakturor och granskningsbehov. Ett preliminärt saldo eller en osäker bankhändelse ska kontrolleras mot originalet innan betalning bekräftas.

## Daglig användning

1. Välj **Översikt** och kontrollera när bank och Gmail senast hämtades. **Kontrollera alla betalningar** driver den befintliga import-, dokument- och avstämningskedjan när anslutningarna är tillgängliga.
2. **Kundfakturor** visar registrerade kundfakturor och deras återstående saldon. **Ej avstämd** betyder att full kontroll av betalning saknas; det är inte ett fastställt påstående om utebliven betalning.
3. **Leverantörsfakturor** visar skulder och förfallodatum. Systemet initierar ingen bankbetalning.
4. **Bank** öppnar alla bankposter. Välj en rad för betalare, OCR/fakturanummer, bankens ursprungliga fält, referenskällor och fakturakoppling. Bankens arkiv-ID och företagets eget Bankgiro är separata fält.
5. **Behöver granskas** samlar undantag. Kontrollera originalet, välj rätt faktura och bekräfta först när uppgifterna stämmer. En samlingspost behöver individuell betalningsspecifikation innan den kan identifieras säkert. En felaktig koppling återtas genom appens historikfunktion.

Ett fakturanummer märkt **Förslag** kommer från ett fakturaunderlag. Det visar en möjlig kandidat och gör inte fakturan betald. Kontrollera alla alternativ om flera fakturor har samma belopp.

## Bank och Gmail

Bankanslutningen använder Enable Banking AIS. Behörig användare behöver giltig företagsåtkomst, bankmedgivande och rätt SEK-konto. Följ [bankguiden](SWEDBANK.md) och [Sites installationsanvisningar](../sites/README.md). Bevara befintliga krypteringsnycklar och använd endast registrerade, roterade servernycklar.

När kontoutdrag eller API bara lämnar en samlingspost behövs en individuell rapport från Swedbank/Bankgirot. Importera avtalad CSV eller camt.053/054 i **Import & underlag**. Kontrollera konto, datum, belopp, valuta och stabila ID:n i förhandsgranskningen. En kontosummering kan inte återskapa saknat OCR.

Gmail använder Google OAuth och befintlig läsbehörighet. Följ [Gmail-guiden](GMAIL.md); för Sites finns [sites/GMAIL.md](../sites/GMAIL.md). Bilder och skannade PDF-filer behöver den anslutna lokala OCR-datorn. Osäkra uppgifter granskas före registrering. Läsbehörighet räcker för fakturahämtning; varje kundutskick har ett separat godkännandeflöde.

## Automatik

Node kör schemalagda jobb när servern är igång och integrationernas intervall är aktiverade. Retry och sparad väntetid behålls vid bankfel. Sites kan använda befintliga schedulerfunktioner, men en publicering startar inte de två pausade molnschemana. Kontrollera giltigt medgivande, period, fullständig hämtning och tillgänglig OCR-dator före aktivering. En öppen webbsida är inte i sig ett bevis på obemannad drift.

## Krypterad backup av Node

Lägg en separat slumpad 32-byte-nyckel som 64 hextecken i skyddad miljövariabel `MG_BACKUP_KEY`. Förvara en återställningskopia av den nyckeln på annan skyddad plats. Bevara också installationens ursprungliga `BANK_DATA_KEY`, `SESSION_SECRET` och övriga runtimekonfiguration separat. Ändra inte bankens krypteringsnyckel när backup aktiveras.

`MG_BACKUP_DIRECTORY` ska vara en skyddad absolut mapp för just denna installation, helst på en separat säkerhetskopierad volym. När mappen anges skapar Node en konsistent krypterad databasbackup vid start och sedan högst en per Stockholmsdag. Varje ny backup dekrypteras till en isolerad temporär databas och integritetskontrolleras. En befintlig dagsbackup verifieras utan överskrivning. Fel visas i autentiserade `/api/settings` under `backup`, med återförsök efter 15 minuter. Ingen nyckel returneras där.

Manuell körning från repots rot, med nyckeln i `.env`:

```powershell
node --env-file=.env scripts/backup.mjs create C:\Skyddad\mgeorge.sqlite D:\MGBackup\engangsbackup.mgbak
node --env-file=.env scripts/backup.mjs verify D:\MGBackup\engangsbackup.mgbak
node --env-file=.env scripts/backup.mjs restore D:\MGBackup\engangsbackup.mgbak D:\MGAterstallning\ny.sqlite
```

Målmapparna för manuell körning måste finnas. Restore kräver ett nytt filnamn och skriver aldrig över en befintlig databas. Stoppa applikationen och samordna driftkonfigurationen innan en återställd kopia tas i bruk. Testa först i isolerad miljö med skyddade nycklar. Fastställ verksamhetens lagrings- och gallringspolicy; koden tar inte automatiskt bort gamla backuper.

Denna backup gäller Node-databasen, inklusive dokument som den databasen lagrar. Sites D1/R2 är en separat installation och kräver en samordnad backup av register, original och runtimekonfiguration genom behörig driftåtkomst. JSON-export ensam är inte en komplett katastrofbackup.

## Återgång och felsökning

Rulla tillbaka programkod med en tidigare sparad Sites-version eller Git-commit. Rätta enskilda ekonomiska kopplingar med appens spårbara återtagsfunktion. Återställ inte hela produktionsregistret för att rätta en enskild faktura.

Vid saknade referenser: öppna bankoriginalet och dess källvägar. Vid felaktig OCR: kontrollera originalnumret och företagets OCR-avtal. Vid flera kandidater: verifiera betalare och underlag. Vid väntande OCR: kontrollera den anslutna datorns status. Vid avbruten synk: kontrollera sparad felstatus och medgivandets giltighet före nytt försök.
