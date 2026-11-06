# Hemligheter, nyckelrotation och datahantering

Detta är en inventering av kodens kontrakt och vad drift måste verifiera. Inga verkliga hemligheter har hämtats, bytts, skrivits till logg eller lagts i PR:en. Exemplen och kryptonycklarna i testerna genereras enbart för syntetiska prov.

## Nycklar och åtkomstmaterial

| Material | Kodens användning | Kontroll och driftskrav |
| --- | --- | --- |
| Node `BANK_DATA_KEY` / `ENCRYPTION_KEY` | AES-256-GCM för privata integrationsobjekt; 64 hextecken. Motstridiga alias avvisas. | Skyddad serverkonfiguration. Byte av variabeln migrerar inte gammal ciphertext. [Kod](../../src/security.js). |
| Sites `BANK_DATA_ENCRYPTION_KEY` | Ägar-/ändamålsbundna krypteringskuvert för bankdata. | Skyddad plattformshemlighet. Tester avvisar fel ägare/ändamål och manipulerad nonce/ciphertext. [Tester](../../sites/tests/banking-security.test.mjs). |
| Node `MG_BACKUP_KEY` | Separat kryptering och verifiering av backup. | Förvara återhämtningsbar kopia oberoende av applikationsvärden. [Kod](../../src/backup.js). |
| Sites `BACKUP_ENCRYPTION_KEY` | Autentiserad backup av snapshot, manifest och original. | Bevara rätt nyckelgeneration för alla kvarvarande kopior. [Backupmotor](../../sites/lib/backup-engine.ts). |
| Enable Banking-signering | RSA-nyckel i skyddad runtime-PEM eller verifierad lokal fil; konfigurationsfingeravtryck binder samtyckesgenerationen. | Exakt applikation/miljö/redirect/rotation kontrolleras separat. [Ny filläsare](../../src/private-key-file.js), [bankkonfiguration](../../src/bank.js). |
| Open Payments-klient och mTLS | Serverstyrda credentials, certifikat och tokenkoordinator. Produktionsanrop får inte falla tillbaka till vanlig oskyddad transport. | Faktisk leverantörsregistrering, certifikatkedja, utgång och återkallelse kräver driftacceptans. [Transporttester](../../test/openpayments-runtime-transport.test.js). |
| Browser- och flödestoken | Slumpade token; hashade sessions-/statekopplingar; HttpOnly/SameSite och Secure för HTTPS. | Återkallad/utgången session eller medlemskap får inte återfå auktoritet genom en gammal callback eller restore. [Sessionstester](../../test/security-session-ambiguity.test.js). |

Node använder äldre generella krypteringsobjekt och separata företagsdatabaser, medan Sites nya bankkuvert binder ägare och ändamål. Dessa format ska inte beskrivas som identiska. Företagsgräns och medlemskap kontrolleras dessutom vid åtkomsten; innehav av krypterad data är inte auktorisation.

### Nytt kontrakt för lokal privat nyckelfil

Filvägen måste vara absolut, normaliserad och kanonisk, utanför repositoryt och utan symboliska länkar i komponenterna. Filen ska vara en vanlig fil som ägs av tjänstens OS-användare; grupp och andra får inga rättigheter. `0600` eller striktare läsbart läge är avsett. Maxstorleken är 128 KiB och innehållet måste vara giltig UTF-8. Ändrad identitet eller metadata under läsningen avvisas.

Läsaren använder verifierad fildeskriptor, `O_NOFOLLOW` där plattformen ger flaggan, storleksgräns och jämförelse före/efter läsningen. Den returnerar inte OS-fel, filnamn eller nyckelinnehåll till användaren. [Regressionssviten](../../test/security-private-key-file.test.js) verifierar också att originalfilen lämnas oförändrad och att ersättningsnyckeln ändrar samtyckesfingeravtrycket.

Föräldrakatalogerna ska redan vara betrodda. Funktionen är ingen allmän ACL-granskare, atomisk katalogvandring eller garanti mot en angripare med samma OS-identitet. Den inventerar inte andra hårda länkar. På en plattform utan POSIX-`getuid`, exempelvis Windows, avvisas filalternativet; skyddad runtime-PEM finns kvar. Körningarna i denna PR verifierar Linux/Node 22 och 24, inte Windows-ACL.

### Rotation är flera skilda operationer

Signeringsnyckel-/klientcertifikatrotation ändrar den externa integrationsidentiteten. Befintliga konfigurationsgenerationer, lås, samtycken och medlemsversioner måste hindra gamla anrop från att återaktivera behörighet. Regressionerna testar dessa gränser med syntetiskt material; inga riktiga certifikat eller bankmedgivanden roteras.

Datanyckelrotation kräver däremot en kontrollerad migrering eller omkryptering av lagrade värden. Backupnyckelrotation måste också behålla läsbarheten hos tidigare generationer. Denna leverans tillför inget generellt nyckelregister eller en destruktiv massomkryptering. En enkel miljövariabeländring ska därför inte användas som rotationsprocedur.

Före verklig rotation ska drift inventera berörda företag/generationer, verifiera förbackup och nyckelåterhämtning, stoppa berörda skrivare, prova läsning/migrering i isolering och dokumentera återgång. Gamla credentials ska återkallas enligt leverantörens process när övergången är verifierad. Nyckelmaterial får inte kopieras till ärenden, GitHub eller supportloggar.

## Dataförteckning och GDPR-arbete

| Dataklass | Lagring och åtkomst i koden | Separat beslut |
| --- | --- | --- |
| Företag, medlemskap, roller och val | Node kontrollkatalog/företagspartitioner; Sites beständig företagskatalog och `storageOwner`. | Verifierad juridisk identitet, företrädare och medlemslivscykel. |
| Fakturor, transaktioner, allokeringar och original | Företagsbunden databas; Node original i SQLite, Sites original i ägarbundet R2-namnutrymme. | Faktisk lagringsregion, volym/diskkryptering, åtkomst, retention och laglig återlämning/gallring. |
| Bank-/Gmail-medgivanden och privata token | Serverlagring med kryptering och behörighetskontroller. | Leverantörsroller, scopes, återkallelse, kundens instruktioner och avtal. |
| Audit, jobbkvitton och felsökning | Företags-/aktörsbundna händelser och skyddade felprojektioner. | Bevarandetid, åtkomst, extern loggförvaring och incidentprocess. |
| Backuper och återställningsunderlag | Autentiserad kryptering och företagsbunden export; isolerad restore till särskilt evidensschema. | Kopior/nycklar i oberoende förvaring, retention, regioner och radering efter godkänd tidsplan. |

Lagring av original i SQLite eller R2 betyder inte att all sådan data har applikationskryptering med den banknyckel som beskrivs ovan. Värdens disk-/objektkryptering, region, underleverantörer och administrativa åtkomst måste verifieras i den faktiska miljön.

Node `/api/export` och Sites exportväg omfattas av företagskontext och audit. Export av ekonomiska uppgifter är inte i sig en komplett funktion för alla registrerades rättigheter. En företagsomfattande avslutsprocess behöver dessutom hantera original, medgivanden, supportdata, loggar, kopior och tillämpligt bevarande. Inget verkligt material har raderats för att simulera sådan efterlevnad.

[IMY:s vägledning om personuppgiftsbiträdesavtal](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/) beskriver avtalskrav kring instruktioner, säkerhet, underbiträden och avslut. Den aktuella affärens rollfördelning och avtal måste bedömas separat. Se repositoryts [kommersiella krav](../saas/COMMERCIAL-LAUNCH-REQUIREMENTS.md) och riskerna O07–O09/O13.

## Audit och återställningsauktoritet

Bankimport och finansiell audit ska lyckas tillsammans. Befintliga tester avvisar import när audit-/commitsteget fallerar, bevarar lyckat beständigt kvitto när svaret försvinner och hindrar ett sent svar från att skriva efter förlorad lease. Företag, aktör, operation och version är relevanta revisionsfält; token och råa providerfel ska inte kopieras till användarens status.

Isolerad restore tömmer särskilt angivna tillfälliga auktorisationsrader, spärrar applikationstokenutfärdaren och invaliderar arbetarleaser. Den bevarar fortfarande historik och vissa krypterade bank-/Gmail-medgivanden som evidens. Rapporten får därför inte säga att samtliga hemligheter eller all historisk auktorisationsdata är raderad. Ett evidensschema är inte en aktiverad produktionstjänst.

Appens audit ger ett revisionsspår under appens åtkomstmodell. Denna PR etablerar ingen oberoende WORM-förvaring eller garanti mot en privilegierad databasadministratör. Drift måste besluta vilka ytterligare skydd den avtalade revisionen kräver.
