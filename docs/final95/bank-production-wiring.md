# Open Payments: verklig transportkoppling och aktiveringsgränser

Datum: 2026-11-06. Bas: `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`.

## Leverans och faktiska resultat

Den ordinarie Node-kompositionen skickade tidigare aldrig in den redan befintliga native mTLS-transporten. Produktion förblev därför stängd även om operatören hade riktiga certifikat. `3cffb30f18212b21992b29c56f7a18969e5dc9c6` kopplar nu en uttryckligt konfigurerad och validerad servertransport till onboarding, callback, kontoval, schemalagd synk och läsning av synkstatus.

Det avslutande syntetiska flödet visade också fyra klientcredentialstoken för samma app och PSU-context. `79ea47e9db430ea30e704c8df8850b4783f5dc93` återanvänder enbart app-tokenens kortlivade tillstånd. `3bcb841eee815db4f138fc46c6f8503a5bc12396` gör det typade API:t konsekvent: `OpenPaymentsOptions.applicationTokenCache: {identity}` används hela vägen.

Den oberoende granskningen ledde till två kompletteringar. `00ef9ef` bevarar den precisa orsaken `CLIENT_CERTIFICATE_EXPIRED` även efter att cacheidentiteten pensionerats. `7fd5af2764ef3387341758601eea2ff45a5d0a18` binder en API-401 till exakt använd tokenreceipt och delar tokenendpointens429/Retry-After över appen.

**Ingen produktionskonfiguration, faktisk provideroperation, BankID-inloggning eller kunddata har ändrats.** Driftinventeringen säger fortfarande `connected=false` och Bankgiro `SOURCE_NOT_CONFIGURED`. Testerna skapar egna kortlivade lokala certifikat och kontaktar enbart loopback. Syntetiskt providerläge `PRODUCTION` betyder här att produktionskodens transport-/originregler testas lokalt; det är inte en bankverifiering.

## Vad som skyddas

Node laddar certifikat och nyckel endast från betrodd serverkonfiguration. Saknad konfiguration behåller produktion avstängd. Felaktig version, generation, fil, nyckel, fingerprint, CA eller filbehörighet nekas före providertrafik. Inga certifikat, nycklar, råa fel eller privata sökvägar visas i publika fel.

Transporten behåller två fasta HTTPS-origins: `auth.openbankingplatform.com` och `api.openbankingplatform.com`. Tillåtna operationer är tokenutbyte, bankmetadata, medgivande/SCA och konto-/transaktionsläsning. Betalningsendpoints, främmande origin, Host-override, redirects och otillåtna paths stoppas. Servercertifikatet kontrolleras alltid med `rejectUnauthorized: true`, minst TLS1.2. En optional CA ändrar vilken betrodd CA som används; den stänger aldrig av verifiering.

Rå konfiguration och faktiskt inläst certifikat-/nyckelmaterial kontrolleras igen vid känsliga gränser. Ändring under pågående tokenrespons får inte exponera resultat eller fortsätta till nästa anrop. Lagrad synkstatus kontrollerar aktuell transport utan providertrafik, behåller historiskt senaste lyckade körning och blockerar aktuell automatisk synk när certifikatet inte längre kan verifieras.

## Node-konfiguration

Detta är en serverkonfiguration för POSIX/Linux, inte ett nytt webbfält eller en instruktion att ändra en faktisk driftsmiljö. `SAAS_BANK_ENABLED` måste uttryckligen vara `true` och `SAAS_OPENPAYMENTS_CONFIG.environment` måste vara `PRODUCTION` innan filerna ens laddas.

`SAAS_OPENPAYMENTS_MTLS_CONFIG` innehåller strikt JSON:

| Fält | Krav |
| --- | --- |
| `version` | Exakt talet1. |
| `credentialGeneration` | Exakt samma icke-tomma sträng som den verkliga providerkonfigurationen. |
| `certificateFile` | Absolut, kanonisk sökväg till certifikat-PEM; leaf först, eventuell certifikatkedja enligt leverantörens instruktion. |
| `privateKeyFile` | Absolut, kanonisk sökväg till matchande PEM-nyckel som native Node kan läsa. Den här vägen tar inte en passphrase eller ett PFX-objekt. |
| `certificateSha256` | Leaf-certifikatets X.509 SHA256-fingerprint,64 gemena hextecken utan kolon. Beräkna från den verkliga certifikatfilen och jämför via betrodd driftskanal. |
| `caFile` | Valfritt. Absolut sökväg till explicit godkänt server-CA-bundle. Utelämna för Nodes ordinarie betrodda rötter. |
| `caSha256` | Obligatoriskt tillsammans med `caFile`; SHA256 av CA-filens exakta UTF8-bytes,64 gemena hextecken. Utelämna båda CA-fälten tillsammans. |

Övriga JSON-fält, exempelvis `verified` eller `rejectUnauthorized`, avvisas. Konfigurationssträngen är högst20KB. Varje PEM-fil är1–128KiB; optional CA-bundle innehåller1–20 certifikat med CA-egenskap och giltiga tidsgränser.

Filer måste vara vanliga, stabila filer utan symlink i någon pathkomponent. Grupp-/världsskrivbara filer avvisas. Den privata nyckeln måste ägas av processens användare med mode0600 eller striktare och utan grupp-/världsrättigheter. Windows mode-bitar godtas inte som bevis för en säker ACL. Ett secret-mount som exponerar symlinks behöver en separat godkänd privat filprojektion; lätta inte på kontrollen för att få en viss mount att fungera.

Ingen riktig exempelkonfiguration eller verkligt certifikat läggs i repositoryt. De certifikat som skapas av `test/helpers/openpayments-local-tls.mjs` är enbart temporära testcertifikat och får inte användas för deployment.

## App-tokenens livslängd och företagsisolering

[Open Payments tokenkontrakt](https://docs.openpayments.io/docs/get_access_token) använder `client_credentials`, upp till en timmes giltighet och ett kombinerat API-/PSU-scope. För företagsflödet ska appens relevanta API-scopes samlas med `corporate`; Bankgiroberikning kräver även `bankgiroinformation`. Leverantörens rekommendation är en aktiv app-token per PSU-context, inte en ny token för varje företag eller HTTP-request. Authorization-code-token vid SCA-aktivering är separat och ersätter aldrig app-tokenen.

Cachen delas därför mellan företag som använder exakt samma verifierade app-/credential-/scope-/transportidentitet. Nyckeln hashar faktisk miljö, clientId, även den icke-enumerabla clientSecret, generation, credentials expiry, API-version, scopes, features och redirect-konfiguration. Den innehåller ingen rå token. Opaque cacheIdentity skapas av servertransporten och binds till verkligt certifikat-/konfigurationsmaterial. Nyckel eller cache exponeras inte för webbanvändaren.

Varje provider behåller en egen HTTP-klient, egen requestbudget och egna företags-, medlemskaps- och medgivandekontroller. En väntande anropare kontrolleras igen efter delad singleflight. Fel företagsmedgivande och återkallat medlemskap stoppas före ett bankdataanrop även när en giltig app-token redan finns.

Cachen är begränsad till128 app-/konfigurationsposter per aktuell transportidentitet. Token används bara fram till sin provider-/credential-expiry, med30 sekunders förnyelsemarginal. Rotation återkallar den gamla identiteten permanent, inklusive väntande tokenpromises.401 från API invaliderar token utan att automatiskt upprepa anropet. Eviktion och en sen respons kan inte återpublicera en återkallad token.

En försenad401 gäller den exakta token som användes; den får inte kasta en ny issuance med samma opaka sträng eller avbryta en senare refresh. Tokenendpointens429 lagras som ett gemensamt embargo även för authorization-code-aktivering. Senare företag får återstående väntetid utan nytt tokenanrop. Ett längre embargo överlever idlepruning och får inte evikteras för att frigöra plats; explicit overflow förblir blockerad. En redan giltig app-token kan fortfarande användas för AIS medan ny tokenutgivning väntar.

**Driftsgräns:** tillståndet är process-/Worker-isolate-lokalt och skrivs inte i kunddatabaser eller vanliga cache-/loggtjänster.1,10 och100 företag i samma verifierade transportinstans använder en token. Flera oberoende processer/isolates eller kallstarter kan skapa varsin token. Deployment måste därför verifiera leverantörens globala tokenpolicy och välja en auktoriserad issuer-komposition om en global singleton krävs. Dessa tester påstår inte global deduplicering över separata maskiner eller Cloudflare-isolates.

## Faktiska verifieringar

| Revision / körning | Resultat | Typ av bevis |
| --- | --- | --- |
| Före transportwiring, bas2982 med nya regressioner |2/14 PASS;12 FAIL | RED: ordinarie produktionsruntime kunde inte använda native mTLS. |
| `3cffb30…`, fokuserade8 Node-bankfiler |125/125 PASS;0 fail/cancel/skip/TODO | Native lokalTLS samt consent, scheduler, normalisering och Bankgiro-intag. |
| Före app-token-cache |17/19 PASS;2 FAIL | RED: samtidiga runtimes och onboarding/sync begärde4 app-token i stället för1. |
| Rotationstest under cacheutveckling |21/22 PASS;1 FAIL | RED: återställd konfiguration återanvände en pensionerad cacheidentitet. |
| Promisegränstest under cacheutveckling |16/17 PASS;1 FAIL | RED: återkallelse efter parsning kunde lämna ut ett föråldrat promisesvar. |
| `79ea47e…`,8 Node-bankfiler + samtliga Open Payments-Sitesfiler |424/424 PASS;0 fail/cancel/skip/TODO | Exakt postcommit-körning,22,51s. |
| `79ea47e…`, rotens `npm run check` |274 JavaScriptfiler PASS | Ordinarie syntaxgrind. |
| Före API-konsistensfix |22/23 PASS;1 FAIL | RED: typad applicationTokenCache ignorerades av shared runtime, två tokenhämtningar. |
| `3bcb841…`, samma fokuserade urval med ny API-regression |425/425 PASS;0 fail/cancel/skip/TODO | Exakt postcommit-körning,18,85s. |
| Före upprepad expiryfix |23/24 PASS;1 FAIL | RED: den andra certifikatvalideringen tappade den precisa expiryorsaken. |
| Oberoende401-/429-prober, före rättning |17/19 PASS;2 FAIL | RED: sen401 gav3 tokenutgivningar i stället för2; nästa företag kringgick120s Retry-After. |
| `7fd5af2…`, samma fokuserade bankurval med samtliga nya regressioner |435/435 PASS;0 fail/cancel/skip/TODO | Exakt postcommit-körning,19,78s. |

Det slutliga lokala TLS-flödet omfattar medgivande, SCA-callback, kontoval, schemalagd transaktionshämtning och statusläsning. Servern observerade16 HTTP-anrop genom verklig native TLS; samtliga presenterade det genererade klientcertifikatet och accepterades av serverns CA-kontroll. Av dessa var1 `client_credentials` och1 separat `authorization_code`. Verkliga provideranrop:0. Den syntetiska625SEK-transaktionen importerades med referens0599, utan ekonomiska allokeringar.

En extra Sites-typkörning i det isolerade worktree avbröts av projektets korrekta minimatch-grind eftersom worktree återanvände installerade beroenden via en skrivskyddad `node_modules`-symlink. Ingen kontroll kringgicks eller dependency ändrades. Root kör den ordinarie verifierade installationens typ-/bygggrind efter integration. Detta dokument tillskriver inte sig en ny full Node-/Sites-/CI-körning.

Fullständiga komprimerade loggar, SHA256 och källfilshashar finns i [evidensmanifestet](evidence/bank-wiring/verification.json). Felslagen första fullflödesfixture, som saknade bankmetadata-/kontodetaljroute, är också bevarad och rättades i testets providerfixture; produktkodens assertions försvagades inte.

## Exakta externa gates

1. Open Payments måste ha beviljat faktisk produktionsåtkomst och rätt API-produkter. Organisationens certifikat, privat nyckel, appcredential och redirect-whitelist måste vara verkliga och giltiga. [Officiell produktionsonboarding](https://docs.openpayments.io/docs/getstarted).
2. Företagsregistreringen ska styrka rätt juridisk person, verklig PSU, bankidentitet, behörighetsunderlag och requestpolicy. En app-token eller ett certifikat skapar inte bankkundens medgivande. [AIS-kontokontraktet](https://docs.openpayments.io/api/account-information-service-ais).
3. Ny autentisering sker användarinitierat med riktig SCA/BankID när banken kräver det. Ingen lokal statusåterställning får göra ett avslaget eller återkallat medgivande aktivt.
4. Node-operatören verifierar privat filprojektion, fingerprints, giltighetstid, rotation och verklig TLS-utväg innan tjänsten slås på. Ändra generation och faktiskt credential-/certifikatmaterial enligt godkänd driftsrutin; gamla operationer ska avbrytas.
5. Workers använder separat faktisk mTLS-binding, med uppladdat certifikat/nyckel och matchande certificateId. Publik metadata kan inte introspektera vad Cloudflare faktiskt bundit. Vanlig Workers `node:https` ignorerar cert/key/CA-optioner och kan inte ersätta bindningen. [mTLS-binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/) och [Workers node:https](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/).
6. Bankgiro kräver dessutom separat auktoriserad källtäckning, konto/IBAN/Bankgirorelation, korrekt capture-/CAMTprofil och originalacceptans. Se den separata Bankgirogranskningen. Ingen generell AIS-hämtning intygar full Bankgirotäckning.
7. Först efter uttryckligt godkänd verklig read-only-acceptans kan ett avgränsat konto/intervall hämtas och jämföras med bankunderlag. Registrera separat bevis för transport, medgivande, kontorättighet, rapporttäckning och idempotent hämtning. Faktisk schemaläggning och global tokenfrekvens måste följas upp i deployment.

Denna leverans tar bort tekniska luckor som gick att lösa utan externa certifikat. Den gör inget påstående om att bankstatusen har ändrats eller att9,5/10 därmed har uppnåtts.
