# Befintlig krypterad backup: återupptagning stoppad vid upptagen lease

Snapshot: `768fde9a-27a2-4b85-b85a-278239ec4aea`, dag `2026-11-06`, 430 original. Endast ordinarie MG Fakturakoll `backup_step` och `backup_status` användes. Inga nya snapshots, återställningar eller ekonomiska ändringar begärdes.

## Utfall

**Inte slutförd.** Initial status var 105/430 kopierade, 43 965 839 byte och 0 kontrollästa filer. Efter 20 strikt sekventiella steg hade samma snapshot 205 kopierade filer och 88 180 765 byte, utan fel eller omförsök.

Nästa batch gav `busy:true` i samtliga tio svar, samtidigt som räknaren steg från 206 till 207. Den extra spärrflaggan upptäcktes först när hela batchen inspekterades: batchens kontroll omfattade snapshot-ID, datum, filantal, monotona räknare, tillstånd, fel och attempts men saknade `busy`. Detta var ett kontrollfel i körningen och bevaras i observationsloggen. Inget ytterligare `backup_step` utfördes efter upptäckten.

Slutlig separat `backup_status` **2026-11-06T00:07:05.709Z**:

| Fält | Observerat värde |
| --- | --- |
| Snapshot/dag/filantal | Oförändrade |
| Status | `running` |
| Kopierat | 210 / 430 |
| Kopierade byte | 92 408 833 |
| Kontrolläst | 0 filer / 0 byte |
| Kontrollomfattning | `pending` |
| Fel / attempts | `null` / 0 |
| Senast färdiga snapshot | 2026-11-05: 362 filer / 142 968 213 byte, `manifest_pass` |

De sista fem filerna observerades under en annan aktiv lease; de tillskrivs inte granskarens egna kopieringssteg. Källkoden i `sites/lib/backup-engine.ts` returnerar `busy:true` när leaseförvärvet inte ändrar raden. Det är förenligt med att en annan körning pågår, men kvittot identifierar inte anroparen eller dess orsak. Inga leasevärden, nycklar, original eller kunduppgifter lästes.

## Nästa steg

Driftägaren har informerats om stoppet. Innan ett nytt eget steg behöver den samtidiga körningen upphöra eller dess ägarskap klarläggas. En fortsatt kontroll måste stanna direkt på `busy`, bevara samma snapshot och slutföra även den separata kontrolläsningsfasen. Den här delkörningen ger inget nytt påstående om en fullständig, verifierad 430-filsbackup och ingen poänghöjning.

`backup-2026-11-06-resume-observations.json` bevarar startstatus, alla 30 stegkvitton och slutstatus. Retained-API-siffrorna är separata metadata; de ersätter inte originalens ännu ej avslutade kontrolläsning eller ett återställningsprov.
