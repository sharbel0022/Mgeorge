# Slutlig Bankgirogranskning — 2026-11-06

## Omfattning och slutsats

Denna avgränsade granskning avser den sammanförda koden på `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`, träd `18a33d270f062416e62102ac2ea270be0892adbb`. Root har separat verifierat att dess remote-integration `ec467` hade samma träd. Granskningen omfattade Open Payments-kontrakt, CAMT/SFTP-vägen, scope, kontoidentitet, original, samlingsinsättningar, flera betalare, delbetalningar, pagination och återspelning. Inga produktionsdata eller verkliga leverantörer ändrades eller anropades av denna delagent.

**Bankgiro är fortfarande `DISABLED` / `SOURCE_NOT_CONFIGURED` i den aktuella driftinventeringen.** Den befintliga implementeringen kan bevara och granska auktoriserade underlag. Syntetiska original och transporttester bevisar inte att det aktuella företaget har Bankgiroprodukt, rapportavtal eller korrekt ansluten källa.

Ett konkret tekniskt hinder hittades: Node hade en native mTLS-transport men ordinarie runtime och scheduler kopplade aldrig in den. Sites släppte endast igenom sandbox i sin ordinarie komposition. Node-gapet åtgärdas separat i `3cffb30f18212b21992b29c56f7a18969e5dc9c6`; app-tokenåterbruk i `79ea47e9db430ea30e704c8df8850b4783f5dc93`. Sites-kopplingen ägs av den parallella Sites-leveransen. Dessa kodändringar ändrar ingen driftkonfiguration och aktiverar ingen verklig bankkälla.

## Officiella kontrakt och vad de innebär

| Källa | Verifierat kontrakt och konsekvens |
| --- | --- |
| [Open Payments — Access Tokens](https://docs.openpayments.io/docs/get_access_token) | Applikationstoken använder `client_credentials`, har högst en timmes giltighet och kombinerar API-scope med PSU-context. `accountinformation bankgiroinformation corporate` ger rätt slags token för företags-AIS med Bankgiroberikning. Leverantören rekommenderar samlade scopes och en aktiv token per PSU-context. Token är inte kundmedgivande. |
| [Open Payments — Get Started](https://docs.openpayments.io/docs/getstarted) | Produktionsgodkännande, organisationsbundet klientcertifikat för samtliga produktionsanrop, produktbehörighet och whitelistad redirect krävs. Kodens `verified`-fält får endast fyllas från verkliga behörighetsunderlag. |
| [Open Payments — AIS](https://docs.openpayments.io/api/account-information-service-ais) | Konton begränsas av beviljat medgivande. Företagskontext kräver korrekt `PSU-Corporate-ID`; `PSU-ID` avser den verkliga användaren. Sidkedjan följer `transactions._links.next`. ISO-fallback kräver ISO-onboardade konton och dokumenterade förutsättningar; vanlig AIS innebär inte komplett Bankgirotäckning. |
| [Open Payments — Schemas](https://docs.openpayments.io/api/~schemas) och [ändringen juni 2025](https://docs.openpayments.io/docs/changelog/2025-06) | Dokumentnummer har egna typ-/datumfält. Referensarrayer kan innehålla kreditnotor. `aggregateTransactionId`, `aggregateTransactionListId`, `aggregateId` och belopp måste tolkas tillsammans. Genererat `transactionListId` får inte behandlas som universellt unik bankidentitet. Schemafält kontrollerades genom officiellt indexerade utdrag när den stora schemasidan timeoutade. |
| [Open Payments — Bankgiro Lookup](https://docs.openpayments.io/api/bankgiro-lookup) | Uppslag av betalningsmottagare och gironummer inför betalning är ett separat API. Det bevisar inte vem som gjorde en historisk inbetalning och används inte som sådan evidens. |
| [Swedbank — MIG](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) | Den aktuella indexsidan anger CAMT054C/MIG 2.0 och Envelope-dokumentation. Hämtning av länkade MIG-/Envelope-original gav åter HTTP 403 i denna körning. Generiskt stöd för `camt.054.001.02` eller `.08` är därför inte en kundspecifik Swedbank-certifiering. |
| [Swedbank — anslutning företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html) | Riktig filanslutning kräver ett faktiskt avtal, kanal och säkerhetsarrangemang. SFTP-server, katalog, behörighet och rapportprofil måste komma från en auktoriserad bank-/leverantörskanal. |

Projektets `bankgiro_reports:read` är en intern intagskapabilitet. Den är inte ett påhittat Open Payments OAuth-scope. `https-v1` och `/v1/authorization`, `/v1/reports`, `/v1/reports/{id}/content` är **projektets eget bryggkontrakt**, inte dokumenterade Swedbank-endpoints.

## Acceptansmatris

Matrisen anger granskad kod och befintliga regressioner. Huvudleveransens fullständiga kvitton binder exakta testantal till den slutligt integrerade commiten; denna dokumentgranskning påstår inte att alla dessa filer kördes på nytt här.

| Krav | Implementering och konkret evidens | Praktisk gräns |
| --- | --- | --- |
| Originalreferens och nollor | `bankgiro-openpayments.js`, `bankgiro-openpayments-capture.js`; `openpayments-bankgiro.test.mjs`, `openpayments-document-numbers.test.mjs`, `openpayments-raw-receipt.test.mjs`. `0599` bevaras som text och blandas inte med `599`. | Ett dokumentnummer, generisk referens och bankstyrkt OCR är olika fält. |
| Flera betalare och samlingsinsättning | Aggregat kräver konsekvent parent-identitet, SEK, datum, childsumma och uppgivet aggregateAmount. `bankgiro-readiness-joined.test.mjs`, `openpayments-bankgiro.test.mjs`. | 125 + 500 SEK från två uppgiftsangivna betalare får beskriva en deposition på625 SEK utan att skapa två ekonomiska insättningar. |
| Delbetalning | Normaliserade betalningsrader kan representera delbelopp; fakturarelation och ekonomisk allokering granskas separat. `bankgiro-readiness-joined.test.mjs`, `bankgiro-links.test.mjs`, `openpayments-ingest.test.mjs`. | Osäker delbetalning får inte automatiskt registrera en faktura som betald. |
| Payer-identitet | Endast uttryckliga källuppgifter används. Frånvarande payer ger kvarstående granskningsorsak. | Samma belopp/dag räcker inte för att låna betalare från en annan rad. |
| Pagination | Provider validerar tillåten origin/konto/path, datum som inte utvidgar ursprungsintervallet, upprepade cursors, sid-/rad-/tidsgränser. Capture kontrollerar exakt förväntad sidkedja. `openpayments-provider.test.mjs`, `openpayments-capture.test.mjs`. | Ett fel på en senare sida får inte beskrivas som komplett hämtning. |
| Idempotens | Exakt scoped identitet och originalhash krävs. Ändrade bytes under samma rapport-ID blockeras; tidigare och senare original bevaras. `openpayments-ingest.test.mjs`, Node `openpayments-bankgiro-ingest.test.js`. | En generationsförnyelse får inte byta namn på samma bankleverans för att undvika konfliktspår. |
| Tenant/scope | Auktoriseringskvitto binder owner, companyId, sourceId, scopeId, generation, bankgiro, profil, konto och IBAN. Färskhet högst fem minuter och faktisk expiry kontrolleras. `bankgiro-authority.test.mjs`, `company-bankgiro.test.mjs`, `openpayments-capture.test.mjs`. | Hashar eller återspelade historiska kvitton skapar inte ny behörighet. |
| Koppling till banktransaktion | Underordnad rapportinformation får behålla parent-/entryrelation och revisionsspår; proveniens skiljer mottaget underlag från säker fakturarelation. `bankgiro-link-details.test.mjs`, `bankgiro-retained-preview.test.mjs`. | Tidigare manuellt länkad historik innebär inte bankautenticitet. |
| SFTP till produkt | `bankgiro-sftp-e2e.test.mjs` använder verklig lokal SSH/SFTP, originalbyte, brygga, faktisk adapter, kö, parser, preview och UI. | Den testade HTTPS-adaptern får sin nätverksgräns ersatt lokalt. Testet certifierar inte ett verkligt HTTPS-proxycertifikat eller Swedbankprofil. |
| Drift och återstart | Bryggans tester täcker host-key-pinning, läsbehörighet, bounds, privata original, ändrade filer, avbrott, lås och processkill/återstart. | Verklig bankkatalog måste ha verifierade leverans-/immutabilitetsregler; SFTPv3 kan inte bevisa frånvaro av alla fientliga metadata-lika pathbyten. |

Granskningen fann inget ytterligare reproducerbart fel i belopps-, original-, pagination- eller företagsisoleringen utöver de separata transport-/tokenluckorna. Detta är ett avgränsat granskningsresultat, inte en generell garanti eller ett produktionsgodkännande.

## Faktura0599 /625SEK — aktuell evidens

Root har i samma övergripande session kontrollerat sparat XLSX-original skrivfritt: radintegritet verifierad, betalare finns, generisk referens `0599` finns. Det är inte ett formellt OCR-fält. En separat AIS-post på625SEK saknar betalare och referens. Det finns ännu ingen styrkt gemensam samlingsinsättning som binder dessa underlag och faktura0599 är inte registrerad. Workspace-revision52 var oförändrad i kontrollen.

De uppgifterna får inte sammanfogas till ett verifierat fakturabetalningsbevis. De isolerade testerna använder syntetiska kopior/fixtures med0599 och625SEK; inga verkliga kundoriginal har lagts till i repositoryt av denna delagent.

## Exakta aktiveringskrav

### Open Payments Bankgiroberikning

1. Verkligt produktionskonto/app med godkänd AIS- och Bankgiroprodukt, rätt företag och actual kontotäckning.
2. Giltigt organisationscertifikat och matchande privat nyckel. Node använder den nya explicita filkonfigurationen; Workers kräver faktiskt mTLS-binding enligt den separata Sites-guiden. Vanlig `fetch` och en deklarerad `kind: "mtls"` bevisar ingen certifikatöverföring.
3. Säker `SAAS_OPENPAYMENTS_CONFIG` med rätt app, generation, kombinerade scopes och whitelistade callback-URL:er. Bolagsregistreringen ska styrka company/actor/corporateId/PSU/bank-ID och tillåten requestpolicy.
4. Verkligt, användarinitierat SCA/BankID-förfarande, giltigt medgivande och uttryckligen valda rätt företagskonton. Inget påhittat godkännande eller gammal revoked-session får återaktiveras lokalt.
5. Separat faktiskt underlag för Bankgirobehörigheten: source/scope/generation/evidenceId, korrekt Bankgiro och konto/IBAN, giltig tidsperiod samt `bankgiro_reports:read`, `accountinformation`, `bankgiroinformation`, `corporate`.
6. Profilen `openpayments-bankgiro-v1`. Native captures använder `.opbg.json`; HTTPS-registreringen tillåter exakt `allowedFormats: ["json"]`. Generisk eller blandad JSON är stängd. Kontobindning och exakt originalsidkedja ska valideras.
7. Efter särskilt godkänd read-only-acceptans: hämta ett avgränsat intervall, kontrollera konto och berikning, verifiera original mot bankunderlag och upprepa idempotent. Visa oberoende status för AIS, Bankgirotäckning och fakturarelation. Registrera inga osäkra fakturor automatiskt.

### CAMT054C/SFTP-fallback

1. Faktiskt bank-/leverantörsavtal, kundspecifik CAMT/MIG/XSD/Envelope-profil och representativt auktoriserat acceptansunderlag.
2. Verifierad server/port, separat read-only-användare, rätt företagskatalog och oberoende verifierad SSH-host-key SHA256. Nycklar/lösenord lagras privat; ingen trust-on-first-use.
3. Dedikerad POSIX-process och privat beständig spool med ägarbehörighet, lokala fil-/SQLite-lås, originalhashar och återställningsplan. Bryggan lyssnar endast på loopback HTTP; en godkänd lokal HTTPS-proxy terminerar extern TLS.
4. `BANKGIRO_BRIDGE_CONFIG` och verkligt auktoriseringskvitto ska binda samma company/owner/source/scope/Bankgiro/generation/profil som applikationens `BANKGIRO_SOURCE_CONFIG` version1 med monoton revision. Riktig TLS-origin/path och credential-bindning kommer från serverkonfiguration.
5. Format som parsern faktiskt stöder: `csv`, `xml`, `xlsx`, beroende på godkänd profil. Bryggans möjlighet att bevara `txt`/`dat` innebär inte att applikationen kan tolka dem.
6. Färskt auktoriseringskvitto först efter helt lyckad SFTP-scan; säkert intervall och kapacitetsgränser. Fel, stale receipt eller okänd profil ska fortsätta blockera intaget.
7. Isolerad acceptans av representativa original, samlingsinsättningar, sen leverans, återspelning, ändrat original och återstart innan en riktig produktionskälla aktiveras. Inga fjärrfiler flyttas, kvitteras eller raderas av bryggan.

Produktionens `SOURCE_NOT_CONFIGURED` ska bestå tills dessa krav styrkts. Installationsbar kod och syntetiska tester är teknisk beredskap, inte bevis för uppfyllt bankavtal eller fungerande driftsschema.
