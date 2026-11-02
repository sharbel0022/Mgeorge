# Agent 1 — fakturanummer och betalningsreferens

## Leverans

- Branch: `feature/mgeorge-invoice-reference-policy`.
- Bas vid implementation: `73662187cddf9a5c504dea9bd8a1288bd929bc51`.
- Frisläppt C1-kontraktsbas: `b65273500c214a4e16b880e3840dac90d8bd7401`.
- Senaste samordnade main före publicering: `12c9868606a0a45b31b722ddee8f897541687e64`
  (nya dokument och sex syntetiska 0599-acceptansfall; inga nya runtimeändringar).
- Exakt leverans-SHA, PR och efterföljande Node22-CI-kvitto finns i denna branchs
  PR-beskrivning. En ändrad PR-head kräver ny kontroll.
- Ingen merge eller Sites-publicering utförs av Agent 1.

Fullständigt, versionssatt kontrakt och beslut för integrationsgranskning:
[`invoice-reference-policy.md`](invoice-reference-policy.md).

## Implementerat

En gemensam, ren `InvoiceReferencePolicy` skiljer företagets avsedda referens
från registrerad deklaration och bankens faktiska referens/OCR. M.Georges egna
kundfakturor använder hela fakturanumret som text; `0001` och `0599` behåller
nollorna. Ingen global motsvarande regel införs för andra företag eller
leverantörsfakturor. Policyn kan konfigureras via befintliga settingsgränser.

Node och Sites stoppar ofullständiga, liknande, ändrade eller motstridiga
referenser, även efter en manuell korrigering eller en tidigare grön tolkning.
Dubblettcensus bevarar anspråk från stängda och konfliktspärrade fakturor.
Originalobservationer följer nya manuella fil-/textimporter och Gmailregistrering;
redigerade formulärfält kan inte ersätta dem. Ny allokering kontrolleras i de
befintliga ekonomiska skrivgränserna.

Befintliga fakturor, råreferenser, bankoriginal, allokeringar och saldon skrivs
inte om. Aktuella verifieringspåståenden hålls däremot tillbaka när policyn är
blockerad. Gamla bokförda belopp förblir synliga. Kundutkast med en blockerad
policy begränsas till neutral bekräftelse; inga meddelanden skickas av arbetet.

## Delade ändringar och beroenden

- Canonical JS och TypeScriptdeklaration under `sites/lib/`; Node återexporterar
  samma policy. Inga nya paket, låsfiländringar, tabeller eller migrationer.
- Node: `db`, `invoice-review`, `reconciliation`, `customer-messages`, en rad
  settingsförmedling i `server`.
- Sites: `domain`, `reconciliation` och motorn, `imports`, `document-processing`,
  betalnings-/MCP-projektioner och kundutkast. Två små formulärrättningar bevarar
  originalobservationen vid omtolkning och rensar gammal osparad observation om
  en ny fil inte går att läsa.
- Nya frivilliga fält och exakta exports beskrivs i kontraktet. C4/C6 måste läsa
  `referencePolicy.status`, inte behandla `REVIEW` eller en referensträff som
  bankverifiering. Bankens referensparser och providerfält byter inte betydelse.
- Två C1-beslut föreslås uttryckligen för integration: standardaktivering för
  exakt det auktoriserade företagsnamnet, och separata avsedda/deklarerade värden
  vid en blockerad konflikt. Andra agenter ska inte gissa dessa kontraktsval.

## Testbevis

Gemensamma återanvändbara fall finns i
`test/helpers/invoice-reference-policy-cases.mjs`, med körning i båda runtimerna.
De kompletteras av syntetiska integrationstester genom verkliga SQLite-/domän- och
HTTP-gränser, läsande MCP, import/registrering och krypterad backup/restore.

Oberoende granskning reproducerade och stängde bland annat manuell
referensöverskrivning, förlorad originalobservation i ordinarie uppladdningsflöde,
ägarskapskonflikt för explicit konfigurerad referens, fel riktning i MCP-sökning
och ett aktuellt verifieringspåstående för en historiskt betald konfliktfaktura.
Alla dessa ändringar har RED/GREEN-bevis. Generiska äldre fixtures behåller sina
assertions och bankvärden men namnger nu ett uttryckligt syntetiskt annat företag.

Exakta slutliga kommandon, totalsiffror och utfall anges i PR-kvittot efter hela
Node-/Sites-grindarna. Överlappande riktade körningar summeras inte som unika
fall. Avbrutna första miljöbaslinjer räknas inte som godkända. Root audit har
0 fynd; Sites high-grind passerar med befintliga 16 moderate utvecklingsfynd och
repoets oförändrade, bytekontrollerade minimatchåtgärd.

## Kända gränser och fortsättning

Gamla Sitesfakturor saknar ibland en sparad tolkning av originalets referens.
Den informationen uppfinns inte och historiken migreras inte. Sparade explicita
konflikter blockerar fortsatt; separat kontrollerad omgranskning behövs för
sådant som bara kan läsas ur det gamla originalet. Nya webbläsar-/OCR-snapshots
är granskningsobservationer enligt befintlig manuell modell, inte bevis för
bankfakta eller automatisk korrekt tolkning.

Kandidatsökning i dokument är fortfarande ett uttryckligt granskningsförslag.
C4 äger vidare kandidatintegration; C6 äger den övergripande översiktsupplevelsen.
En befintlig policyfakturas original-ID kan inte bytas bakom en sparad snapshot.
Inga verkliga bank-/Gmailanrop behövs för de syntetiska regressionsgrindarna.

Integrationsansvarig granskar C1-valen, det frysta PR-huvudet, gemensamma
filkonflikter och aktuell CI före eventuell merge. Agent 1 får inte merga eller
publicera produktionen. Branch och testspecifikation är fortsättningspunkten.
