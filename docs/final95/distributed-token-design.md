# Distribuerad ägare för Open Payments apptoken — genomförbar minimidesign

Status: designunderlag för genomförande, inte ett påstående om redan implementerad samordning. Granskat mot integrerad kod 2026-11-06. Ingen produktionskonfiguration, databas eller provider har ändrats.

## Beslut

Återanvänd befintlig lagring. Node har redan en central `controlDb` i `src/server.js`, med företagskatalog och sessioner; den ska hålla den appgemensamma tokenägaren. Företagens `db`-proxy och separata SQLite-filer ska inte hålla apptoken. Sites ska använda befintlig rå `env.DB` och en snäv serverintern adapter. En ny tjänst, Redis eller Durable Object behövs inte för respektive nuvarande driftsmiljö.

Open Payments dokumenterar en timmes tokenlivslängd och rekommenderar återanvändning med samlade relevanta API-scope och högst en aktiv token per PSU-kontext. Dokumentets två token per timme avser kombinationen privata och företagskonton; det är inte belägg för en hård två-anropsgräns för enbart företag. Vår produktväg är corporate. Appgemensam återanvändning får aldrig dela bolagets HTTP-klient, medlemskapskontroll, konto, consent eller request-budget.

## Befintliga byggstenar och verifierade begränsningar

| Byggsten | Befintlig kod / konsekvens |
| --- | --- |
| Node central databas | `src/server.js: controlDb`, `src/company-runtime.js: createCompanyRuntime`; samma lokala SQLite-fil samordnar flera processer. |
| SQLite låsning | `src/db.js`: WAL, busy_timeout 5000; `src/company-sync-database.js`: D1-formad adapter och korta `BEGIN IMMEDIATE`-batcher. Ingen transaktion får hållas över provider-await. |
| Sites primär databas | `env.DB` utan Sessions API går till D1-primären enligt officiell dokumentation. `batch()` är en sekventiell, atomisk SQL-transaktion. |
| Sites kryptering | `sites/lib/banking/security.ts`: AES-256-GCM med slumpad IV och AAD som binder owner/purpose. Använd servernamespace + appfamilj/konfiguration/epoch, aldrig ett kundägarnamn. |
| Node kryptering | `src/security.js`: AES-256-GCM. Befintligt API saknar separat AAD; kapsla familj, konfiguration, epoch och token i krypterad struktur och kontrollera samtliga efter dekryptering, som befintlig SaaS-codec gör. |
| Befintlig token-cache | Opaque transportidentitet, begränsad lokal cache, appgemensam singleflight; sena 401 och delad 429 rättade i `7fd5af2`. Två oberoende oförändrade regressionsprober passerar 2/2. |
| SQL-isolering | Sites `company-storage.js` nekar okända `company_*`-tabeller. En tabell med det reserverade prefixet kan hållas serverintern; lägg explicit negativ test. Node måste neka tabellen genom företagsproxyn, även när legacyföretaget använder controlDb. |
| Backup | Sites `BACKUP_TABLES` är en exakt kundwhitelist: lägg inte in den appgemensamma token-tabellen. Ett server-/kontrollplansbackupförfarande ska hantera tabellen krypterat och respektera restore-spärren nedan. |

## Minsta schema

En global rad per stabil providerapp/PSU-familj, exempelvis tabell `company_application_tokens`.

| Kolumn | Funktion |
| --- | --- |
| `family_key` (PK) | SHA-256 av miljö, clientId och PSU-kontext corporate. Inget bolags-ID och ingen hemlighet i klartext. |
| `config_hash` | Hash av validerad app-/scope-/credential-generation-konfiguration och stabil verifierad transportreceipt: leaf-fingerprint, cert-ID/binding för Sites, faktisk cert-/CA-identitet för Node. |
| `epoch`, `revision` | Monotona stängsel. SQL-checks för positiva, säkra heltal. |
| `token_ciphertext`, `token_version`, `expires_at` | Krypterat token, separat unik version för exakt 401-invalidering, konservativ livslängd från requeststart och alla credential/cert-gränser. Ingen token i logg eller status. |
| `lease_token`, `lease_until`, `fence` | Slumpad ägarkapabilitet och monoton leasegeneration. SQL-exekveringens klocka gäller vid anspråk/publicering. |
| `uncertain_until` | Konservativ spärr för en token-POST vars utfall kan vara okänt. Skilj från leaseexpiry. |
| `cooldown_until`, `cooldown_blocked`, `last_safe_code`, `updated_at` | Appgemensam provider-429/Retry-After och sanerad driftstatus. Inget rått providersvar. |

Begränsa alla texter, storlekar och numeriska intervall. Tillåt inga requeststyrda familjer eller konfigurationshashar. Ny schemafil och migrationstest behövs för respektive runtime; inga produktionstabeller migreras i denna uppgift.

## Serverinternt protokoll

1. Bind en betrodd koordinator till den befintliga opaque cacheidentiteten. Utöka samma typade `applicationTokenCache`-väg; introducera inte en parallell odeklarerad provideroption. Koordinatorn behåller bara appstat, databas/codec och stabil konfiguration, inte en bolagsspecifik HTTP-klient eller guard.
2. Varje tokenaccess kontrollerar aktuell serverkonfiguration/transport och anropar appkoordinatorn. En lokal cache får inte hoppa över den globala epoch-/config-/cooldown-kontrollen. Bolagets befintliga guard körs före och efter samtliga await.
3. Läs en giltig token ur rätt aktiva epoch och dekryptera den under rätt app-/config-bindning. Kontrollera posten igen efter asynkron dekryptering. Returnera en fryst intern receipt med tokenversion/epoch, värde och utgångstid.
4. Om token saknas: atomisk SQL-CAS reserverar lease/fence och markerar en utfärdningsperiod **innan** någon token-POST får sändas. Bara vinnaren får använda sin egen HTTP-klient och sin egen request-boundary. Övriga väntar kort och bounded på publicering eller får en säker retryable busy-status; de gör ingen extra token-POST.
5. Utfärdaren återkontrollerar företagsbehörighet och transport, hämtar samt validerar providersvaret och krypterar resultatet. Publicering är CAS på familj, config, epoch, lease, fence och fortfarande giltig lease vid SQL-exekveringen. Sen respons från tidigare ägare får aldrig skriva över ett nytt värde.
6. En API-401 invaliderar endast den receipt som faktiskt användes. Invalideringen måste awaitas innan felet lämnar requestvägen; matcha epoch/tokenversion, aldrig enbart tokensträngen. Samma sträng kan ha utfärdats på nytt.
7. En tokenendpoint-429 lagrar Retry-After globalt, inklusive avvisning i authorization-code-aktiveringsvägen. Ogiltigt/överskridande Retry-After behåller den befintliga fail-closed policyn. En annan process, ett annat bolag eller cacheeviction får inte kringgå embargot.
8. Databas-, dekrypterings- eller konfigurationsfel stoppar produktionstrafik. Ingen fallback till separat minnescache eller omedelbar ny token vid fel. Sandboxen kan ha uttryckligt isolerad testcache.

## Krasch, rotation och restore

**Krasch mellan token-POST och SQL-publicering:** nätverket och databasen kan inte uppdateras atomiskt. Leaseexpiry ensam bevisar inte att provider saknar en redan utfärdad token. Förregistrera därför en osäkerhetsperiod motsvarande högsta dokumenterade tokenlivslängd före sändningen. Vid timeout, processkrasch, okänt 5xx-resultat eller ogiltigt svar behåll spärren. En tydligt avvisad 429 får den exakta appgemensamma cooldownen. Detta väljer begränsad tillgänglighet framför okontrollerad parallell utfärdning.

**Rolling credentialrotation:** samma familj måste ha en aktiv konfigurationshash. En gammal process får inte automatiskt skriva tillbaka sin gamla hash efter att en ny process anlänt. Första betrodda bootstrap kan `INSERT ... ON CONFLICT DO NOTHING`; senare mismatch fail-closed. En serverintern operatörsfunktion ska rotera med förväntad gammal hash/epoch, höja epoch och permanent stänga gamla lokalidentiteter. Befintlig `credentialGeneration` är en sträng utan ordning, så gissa inte vilken version som är nyast. Ingen sådan verklig rotation ska utföras här.

**Återställning av kontrollplansbackup:** en gammal databas kan innehålla ett gammalt aktivt config-/tokenvärde. Återställningen ska utföras med provider-egress avstängd och kräva en explicit ny konfigurationsgeneration/ägare eller en dokumenterad karantän tills alla gamla token säkert löpt ut. En vanlig kundbackup ska inte alls innehålla den globala tabellen.

## Genomförandefördelning

| Ägare | Avgränsning |
| --- | --- |
| Bank-agent | Delad SQL-koordinator / typer, integration i token-client och exakt async invalidation/cooldown; Node controlDb-adapter, startup/schema och server/sync-wiring; separata testfiler. Äger befintliga token.js/token-cache.js/provider-filer. |
| Sites-agent | D1-adapter med befintlig AES-GCM-codec, migrering och TS-schema, Sites runtime-wiring, tenant-SQL/backup-negativfall och verklig lokal D1/workerd-verifikation. Ingen samtidig edit av delad token-client. |
| Root | Oberoende design-/kodgranskning, eventuell serverwiring där konflikt uppstår, säkerhetsmanifest, gemensamma grindar och slutlig bedömning. |

Kom överens om exakt koordinatorgränssnitt innan parallella adapteredits. En rimlig minimal form är en betrodd capability med `access(issueCallback)`, `invalidate(receipt)`, `assertIssuerAvailable()` och `recordIssuerFailure(error)`, där `issueCallback` är requestlokal och aldrig sparas efter avslutad flight. Delad token-resultatvalidering måste ske före krypterad publicering.

## Nödvändig verifiering

- Flera oberoende cacheinstanser och separata Nodeprocesser över samma SQLite-fil: 1/10/100 företag ger en app-tokenutfärdning med egna PSU-/företagsheaders och budgetar.
- Två oberoende D1-klienter/Workers mot samma lokala D1: race, SQL-CAS och identiska resultat; inte enbart gemensamt JavaScript-Map.
- Krasch/timeout efter möjlig utfärdning, försenad publicering, utgången lease, köad SQL vars klocka passerar lease, rotation och ett gammalt deployments fortsatta access.
- Sen 401 mot gammal receipt, även samma tokenvärde; 429 följt av ett annat bolag/en annan process; cooldown får inte försvinna vid restart.
- Fel key/AAD/ciphertext, DB-unavailable och saknad schema ger noll provider-egress.
- Tenantproxy kan inte läsa eller skriva globaltabellen, kundbackup/export innehåller inget apptoken.
- Konfiguration och transport kontrolleras efter async läs/dekryptering/utfärdning och före ekonomisk commit. Företagsavslag får inte ge en provideroperation.
- Flyttad/återställd gammal post kan inte återuppliva gammal aktiv credentialgeneration utan uttrycklig serveråtgärd.

## Exakta kvarvarande driftsgränser

Node samordnar endast processer med samma centrala lokala SQLite-fil. Flera servrar med separata filer samordnas inte, och WAL över en godtycklig nätverksdisk är ingen lösning. Sites samordnar Workers som använder samma D1-databas. **Om Node och Sites samtidigt använder samma providerapp men olika databaser måste driften utse en enda tokenutfärdare eller ge miljöerna separata providerappar.** En gemensam extern tokenbroker skulle lösa det men är en annan arkitektur; den ska inte påstås finnas.

Verkligt certifikat, korrekt Cloudflare mTLS-binding, provideravtal och användarens consent/BankID är fortsatt externa produktionsförutsättningar. Databaskoordinatorn, kryptering, migrationer och negativa samtidighetstester är genomförbart kodarbete i denna miljö.

## Primärkällor

- Open Payments token guide: https://docs.openpayments.io/docs/get_access_token
- D1 read replication: https://developers.cloudflare.com/d1/best-practices/read-replication/ (utan Sessions API används primären).
- D1Database batch: https://developers.cloudflare.com/d1/worker-api/d1-database/ (sekventiella atomiska batcher).
- Cloudflare mTLS-binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/ (verkligt uppladdat certifikat/nyckel och binding.fetch; ingen introspektion av leaf-cert från bindingobjektet).
