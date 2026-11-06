# Open Payments: faktisk mTLS-transport för Sites

## Levererad kod och avgränsning

Sites kan nu komponera produktionsprovidern med en faktisk Cloudflare-bindnings
`fetch`-metod. Den tidigare ovillkorliga sandboxspärren i runtime och läsningen av
lagrad kontobehörighet ersätts med samma certifikat- och bindningskontroll.
Vanlig global `fetch` är ingen reservväg för produktion.

Detta aktiverar ingen riktig bank. Företagsmedlemskap, registreringens verifierade
företags-/redirectbehörighet, aktuellt medgivande, kontoval, generation, kvoter,
lease, revisionsnummer och ekonomiska SQL-spärrar krävs fortfarande. Betalnings-
och andra produkt-API:er ligger utanför transportens tillåtna rutter.

Bindningen är opak. Workers exponerar dess `fetch`, men inte certifikatets ID eller
fingeravtryck. Det publika certifikatet nedan är därför en **operatörskontrollerad
driftsreceipt**, inte kryptografiskt bevis för vilket certifikat en godtycklig
bindning använder. Produktionsaktivering kräver att operatören jämför receipt
med det verkligt uppladdade certifikatet och den aktuella bindningen.

## Serverkonfiguration

`SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG` är strikt JSON med följande fält:

| Fält | Krav |
| --- | --- |
| `version` | Exakt `1`. |
| `credentialGeneration` | Exakt samma generation som `SAAS_OPENPAYMENTS_CONFIG`. |
| `binding` | Namnet på en riktig mTLS-bindning, exempelvis `OPENPAYMENTS_MTLS`. Bindningens objekt måste ha en anropbar `fetch`-metod. |
| `certificateId` | Det verkliga uppladdade Cloudflare-certifikatets UUID; jämförs av operatören mot plattformens tilldelning. |
| `certificatePem` | Endast det publika klientcertifikatet som PEM, ett certifikat, högst 32 KiB. |
| `certificateSha256` | 64 gemena hextecken: SHA-256-fingeravtryck av certifikatets DER-bytes, samma värde som Node `X509Certificate.fingerprint256` utan kolon. |

Okända fält avvisas. Privata nycklar, filvägar, alternativa värdar och flaggor som
`verified: true` ersätter inte en certifikatbindning. Saknad mTLS-konfiguration
håller produktion avstängd; felaktig konfiguration eller bindning ger
`INVALID_CLIENT_CERTIFICATE` och utgånget certifikat ger
`CLIENT_CERTIFICATE_EXPIRED`. Konfiguration och felmeddelanden exponerar ingen
privat nyckel, rå banktext eller certifikatsubjekt.

## Säkerhetsgränser

- X.509-bytes parsas med `node:crypto.X509Certificate`. Fingeravtryck och faktiska
  giltighetstider verifieras vid konstruktion, före/efter anrop och under läsning
  av varje strömmad del.
- Rå provider-/mTLS-konfiguration, aktiveringsflagga, bindningsobjekt och dess
  `fetch`-funktion låses för anropet. Rotation gör den gamla transporten ogiltig.
  Företagskörningen behåller dessutom den ursprungliga transportkontrollen genom
  hela synkjobbet, även när nya runtimeobjekt skapas.
- Endast produktionsvärdarna för auth och API tillåts. Metoder, read-only-
  bankrutter, consent-rutter och HTTP-headernamn begränsas. Omdirigeringar följs
  aldrig; extra fetchalternativ kan inte byta nätverksdestination.
- Den befintliga HTTP-klienten behåller högst 20 sekunders deadline, högst
  2 MiB JSON, korrekta 401/403/429-fel och Retry-After, requestbudget och avsaknad
  av implicita återförsök. Ett osäkert skrivsvar blir inte en bekräftad consent.
- Abort, rotation och svarsfel avbryter även det ursprungliga svarsinnehållet.
  Anroparen väntar inte på en sen bindningsrespons eller en hängande cancel.
- Kontosnapshotens och synkkontextens sista giltighetstid begränsas också av
  certifikatet. Den ekonomiska SQL-spärren kan därför inte använda en längre
  medgivandetid som ersättning för ett utgånget certifikat.

## Verifiering på isolerade syntetiska data

Första RED på oförändrad integrerad bas `2982b6c` gav **0/3**: runtime hade
`serviceEnabled=false`, discovery avvisades och lagrad produktionskontobehörighet
avvisades trots en korrekt syntetisk bindningsfixtur. Detta reproducerade det
faktiska saknade integrationssteget.

Slutlig fokuskörning omfattar **90/90** tester, noll fail/cancel/skip/TODO:
`openpayments-workers-runtime`, `openpayments-workers-transport`,
`openpayments-account-state`, `openpayments-company-sync`, `openpayments-ingest`
och `saas-bank-runtime`. De 43 nya testerna ingår i dessa 90 och adderas inte
en gång till. TypeScriptkontrollen passerade.

Den integrerade fixturen använder verkliga server-/företags-/SQLite-/krypterings-
moduler och en syntetisk extern fetchbindning. Den går genom consent, callback,
kontoval, beständig budget/lease, två idempotenta synkar och statusläsning.
625 SEK och referens `0000599` bevaras; betalningen blir inte automatiskt verifierad
och inga allokeringar skapas. Cross-company, återkallat medlemskap, felaktig
registrering, certifikatsrotation och byte under SQL-läsning avvisas.

En första bredare fokuskörning hade tre fel i de nya testfixturerna: exakt
callbackreplay är avsiktligt idempotent och två SQL-injektionspunkter missade
företagsdatabasens `WITH`-fråga. Testerna kontrollerar nu oförändrad revision/
payload och noll nya provideranrop vid exakt replay, avvisning av ändrad callback
samt att båda injektionerna faktiskt sker. Äldre assertions ändrades inte.

Ett separat prov i verklig lokal **workerd**, med `nodejs_compat` och
kompatibilitetsdatum `2026-05-15`, verifierade X.509-parsning, bindningsanrop,
strömmat svar och rotationsspärr. Extern nätverkstrafik var spärrad och antalet
utgående nätverksanrop var noll. Detta är ett runtimekompatibilitetsprov med en
syntetisk bindning, inte ett verkligt TLS-handshake mot Open Payments.

Rå RED-/GREEN-loggar, workerdkvitto och exakta filhashar lämnas till release
managerns frysta slutkvitto. Slutlig gemensam CI och produktionsbygge krävs efter
integrationen. Inget kvalitetsbetyg höjs för denna isolerade kodleverans.

## Exakta kvarstående aktiveringssteg

1. Godkänn den integrerade kandidatens ordinarie release-gates och oberoende
   granskning. Behåll nuvarande produktion tills de är uppfyllda.
2. Säkerställ att hostingplattformen kan provisionera en **verklig Cloudflare
   mTLS-bindning**. Det befintliga Sites-manifestet beskriver DB/R2/MCP, inte en
   sådan certifikatbindning. En textmiljövariabel med samma namn räcker inte.
3. En behörig operatör laddar upp leverantörsgodkänt klientcertifikat och privat
   nyckel genom plattformens säkra certifikathantering. Inga privata nycklar ska
   ligga i mTLS-JSON, repository, loggar eller webbläsare.
4. Jämför plattformens certifikat-ID, publik leaf-PEM och DER-fingeravtryck med
   receipt. Verifiera leverantörens client credentials, generation och de
   verifierade registreringarna för varje företag. Applicera detta genom en
   kontrollerad miljö-/bindningsändring, aldrig genom ett klientanrop.
5. Vid rotation ändras certifikatbindning, receipt och credentialGeneration i
   samma kontrollerade driftsättning. Gamla inflight-anrop ska avvisas; gamla
   resursgenerationer får inte återaktiveras genom statusåterställning.
6. Verklig användarinitierad BankID/SCA och ett aktuellt företagsmedgivande krävs
   där banken begär det. Avslag eller avbrutet godkännande är inte aktiv consent.
7. Först efter giltig auktorisering och uttryckligt godkännande görs en begränsad
   verklig read-only-kontroll. Dokumentera riktig mTLS-acceptans, kontots
   företagsidentitet, vald behörighet, pagination och säkra felkoder. Bankgiro
   kräver dessutom sin egen giltiga källa och täckningsverifiering.

Ingen bindning, hemlighet, hostingkonfiguration, publicering, verklig bank,
produktionsdata eller betalning ändrades i detta arbete.

## Primära kontrakt

- [Cloudflare mTLS bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/):
  uppladdat certifikat/nyckel, certifikat-ID och `env.BINDING.fetch`.
- [Cloudflare Node crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/):
  `node:crypto` under Node-kompatibilitet.
- [Cloudflare Node HTTPS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/):
  Node HTTPS-alternativ är ingen ersättning för den verkliga mTLS-bindningen.
