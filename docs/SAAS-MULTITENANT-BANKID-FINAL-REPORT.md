# SaaS, flerföretagsstöd och BankID — slutrapport med underkänd verklig bankanslutning

**VERKLIG BANKANSLUTNING GODKÄND: NEJ.** Den befintliga legacyanslutningen är `reauth_required` efter det schemalagda felet `BANK_ACCOUNT_SCOPE_INVALID`; ny verklig Open Payments-anslutning är inte verifierad. **Kommersiell lansering: NOT_APPROVED.** Datum2026-11-05. Kodintegration och en lyckad webbpublicering innebär inte fungerande aktuell bankhämtning. [Aktuellt incidentkvitto](saas/evidence/2026-11-05/bank-incident.json).

PR36–42 är normalt mergade. Ursprunglig runtime-release `672c152242add9427c8526af8dd92431c526c8c2` har grön main-CI och publicerades som Sites61. Före-/efterkontrollen kl. 13:13 är historiskt giltig; den senare banken är underkänd. En separat granskad kompatibilitetsrättning i PR43 har nya fulla lokala grindar: **1 899 Node + 3 756 Sites + 47 bridge = 5 702**, samtliga godkända. [Nya grindar](saas/evidence/2026-11-05/bank-compat-gates.json).

PR43-head `ab941744c3ee38be7ecd4c3121b8e7496082b9ab`, lokal `47811cbbc91df25eb715af2953c79f92e8da38a1`, repositoryträd `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1`, Sites-underträd `a17a42a1c9a4976717003defc40aeb54b9624bfa`. PR43 är normalt mergad som runtime-release `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`, med grön huvud- och säkerhets-CI. Separat main-CI42055222273 är success med nya5 702 pass. Sites62 är publicerad med lyckad deployment och läsande efterkontroll15:37–15:38. Bankanslutningen förblir underkänd; [slutkvittot](saas/evidence/2026-11-05/bank-compat-release.json) skiljer kodpublicering från operativ bankåterställning. Den publicerade applikationens URL är [mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site](https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site). Ingen reauthstatus återställs eller ny providerförfrågan görs för att få ett grönt slutresultat.

## 1. Leveransbedömning

Den integrerade koden har konkreta flöden för verifierad företagskontext, företagsbundet Open Payments-medgivande, bevarade bankoriginal, Bankgiro-underlag, budgeterad synkning och en onboardingvy som läser verkligt lagrat tillstånd. Riktiga Node- och Sites-moduler har provats med syntetiska företag, krypterade resurshandtag, databastransaktioner och providertransporter. Synkningen använder befintlig schemaläggning och behåller tenant-, medgivande-, versions-, lease- och kvotkontroller.

Det kommersiella bankflödet är fortsatt avstängt som standard. Underlaget visar inte en genomförd BankID-resa för en verklig kund, godkänd produktionsanslutning till Open Payments, heltäckande Bankgirodata eller rätt att aktivera tjänsten kommersiellt. Verklig produktionsacceptans för det nya bankflödet är **NOT_VERIFIED** och kommersiell lansering **NOT_APPROVED** tills separata faktiska krav är uppfyllda. Den befintliga produktionsanslutningen ska inte räknas som bevis för den nya företagsanslutningen.

Den ursprungliga säkerhetsreleasens historiskt verifierade kandidat är `95d9a4184275dcbec830ab9558973beba35c8c06`, träd `41b5cda03ae26c619e69eeb3feb65959acc5d281`: **1 899 Node + 3 704 Sites + 47 bridge = 5 650 godkända tester**, med noll fel, skips, avbrutna eller TODO. Separat riktad acceptans omfattar 1 064 överlappande fall och adderas inte en gång till. Källor: [lokala slutgrindar](saas/evidence/2026-11-05/local-gates.json) och [acceptans](saas/evidence/2026-11-05/security-acceptance.json).

**Historiskt verifierat Sites61-cutoverutfall kl. 13:13, före det senare bankfelet:** Sites61 publicerades med lyckad native deployment; liveschemat har 40 förväntade tabeller, arbetsytan behåller samma ägare/revision/uppdateringstid och de maskerade bank-/Gmail-/Bankgiro-/backupstatusarna är identiska före/efter. De fem uttryckligen kontrollerade företags-/medgivande-/synktabellerna hade 0 rader; inga ekonomiska handlingar eller externa schemaaktiveringar utfördes för att demonstrera funktionen. [Före](saas/evidence/2026-11-05/production-before.json) · [Efter](saas/evidence/2026-11-05/production-after.json).

### Slutstatus i nio kontrollpunkter

JA avser den uttryckliga omfattningen i respektive rad. En syntetisk verifiering utgör inget faktiskt bank- eller kommersiellt godkännande.

| Kontrollpunkt | Status vid detta kvitto | Exakt omfattning |
| --- | --- | --- |
| Alla fem fortsättnings-PR:er mergade | **JA** | PR39,41,42,38,37 är normalt mergade. PR36/40 ingick sedan tidigare; alla #36–#42 finns i release672c152. |
| Gemensam slutlig CI | **JA** | Nya [main-CI42055222273](https://github.com/sharbel0022/Mgeorge/actions/runs/42055222273) på b2e7f4b är success; faktiska loggar visar1 899 Node+3 756 Sites+47 bridge,0 fail/skip/cancel/TODO. Äldre main-CI42032260699 och dess5 650 fall redovisas historiskt. |
| Företagsisolering | **JA — syntetiskt verifierad** | Tre faktiska företag i testmiljön; verkliga Node SQLite-/Sites D1/R2-gränser, owner/admin/accountant/viewer och återkallelse under asynkront arbete. |
| Syntetisk SCA och callback | **JA — syntetiskt verifierad** | Faktisk provider-/consentkod med state, callback, replay, krypterade handles, kontoval och utgången återkallelse. Ingen verklig BankID-resa. |
| Open Payments-adapter | **JA — integrerad och syntetiskt verifierad** | Faktiska Node/Sites-adaptrar, budget per HTTP-anrop, aktuell auktoritet och bevarade original; providertransporten ersätts av kontrollerade testtransporter i acceptansen. |
| Bankgirointegration | **JA — syntetiskt verifierad** | Nativecapture/råbytes, befintlig intake, företags-/konto-/insättningsbevis, replay och noll nya fakturaallokeringar. Verklig produktionskälla är fortsatt SOURCE_NOT_CONFIGURED i de daterade kontrollerna. |
| Sites publicerad | **JA — Sites62 publicerad** | Deployment `appgdep_6aeca22254f4819197e33847966a7c70` succeeded 2026-11-05T15:35:16.437170+00:00. Källparitet575 filer,40 tabeller och läsande efterkontroller godkända inom angivet scope. Bankanslutningen är fortfarande NEJ. Produktionsbrowseracceptans är NOT_COMPLETED. |
| VERKLIG BANKANSLUTNING GODKÄND | **NEJ** | Befintlig legacybank är reauth_required efter BANK_ACCOUNT_SCOPE_INVALID; ny Open Payments-kundanslutning/SCA/produktions-mTLS är NOT_VERIFIED. Ingen återställd bankhämtning har verifierats. |
| Kommersiell lansering | **NOT_APPROVED** | Kommersiella featuregrindar är stängda; leverantörsvillkor, företagsbehörighet, banktäckning och operativ acceptans kräver separat faktiskt underlag. |

Den historiska Site61-körkoden identifieras av `672c152242add9427c8526af8dd92431c526c8c2`; uppföljningens PR43-körkod identifieras av `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f` och dess separata Sites-underträd. En senare final-main-commit som enbart uppdaterar dokument och kvitton ska redovisas separat; dess SHA får inte ersätta körkodens releaseidentitet eller dess Sites-underträd i publiceringsjämförelsen.

## 2. Kodbas, PR-historik och separat uppföljningsrelease

Fortsättningsomgången började på main [`f75a293f367980cd360eca1886a2728db9c3e1f2`](https://github.com/sharbel0022/Mgeorge/commit/f75a293f367980cd360eca1886a2728db9c3e1f2). PR40:s företagsgrund och PR36:s provider ingår i den basen. Den tidigare övergripande planens bas `14a042a` behålls som historik.

Följande remote-status finns i [versionslagrat CI-/mergekvitto](saas/evidence/2026-11-05/remote-ci.json). Ett tidigare grönt head-kvitto ersätter aldrig CI för ett nytt head.

| PR | Publicerat head / merge | Versionsbunden status |
| --- | --- | --- |
| [40 — företagsgrund](https://github.com/sharbel0022/Mgeorge/pull/40) | Merge [`f105e9cc5404d1bff3b4fe41e4e6af14d944d212`](https://github.com/sharbel0022/Mgeorge/commit/f105e9cc5404d1bff3b4fe41e4e6af14d944d212). | Normalt mergad före denna fortsättningsbas. [Main-CI 41914833272](https://github.com/sharbel0022/Mgeorge/actions/runs/41914833272) godkänd enligt det tidigare integrationskvittot. Medlemskap, roller och immutabla företagsgränser ingår i slutreleasen. |
| [36 — Open Payments-provider](https://github.com/sharbel0022/Mgeorge/pull/36) | Merge [`f75a293f367980cd360eca1886a2728db9c3e1f2`](https://github.com/sharbel0022/Mgeorge/commit/f75a293f367980cd360eca1886a2728db9c3e1f2). | Normalt mergad; denna merge är fortsättningsomgångens startbas. Providerbiblioteket anslöts därefter till faktisk consent/synk/intake och täcks av de senare kumulativa grindarna. Ingen separat ny körning av dess historiska CI påstås. Historisk [main-CI41917609246](https://github.com/sharbel0022/Mgeorge/actions/runs/41917609246) är grön i alla tre jobb. |
| [39 — medgivande](https://github.com/sharbel0022/Mgeorge/pull/39) | Head `2eab8683db7e4ece1292b4c1f68c500af2f7e128`; merge [`d6c2894c8cdb52669bf73bea64daac58701b182a`](https://github.com/sharbel0022/Mgeorge/commit/d6c2894c8cdb52669bf73bea64daac58701b182a). | Normalt mergad. [Head-CI 42023379476](https://github.com/sharbel0022/Mgeorge/actions/runs/42023379476) och [main-CI 42024120779](https://github.com/sharbel0022/Mgeorge/actions/runs/42024120779) godkända. Det sena utgångsfelet rättades därefter i PR41. |
| [41 — Bankgiro/utgångsrättning](https://github.com/sharbel0022/Mgeorge/pull/41) | Head `86730fe47aab8736c6cfb04d672c5e04a10d473d`; merge [`7a535446a99f17a6f771dd8660fe2a99c6b84248`](https://github.com/sharbel0022/Mgeorge/commit/7a535446a99f17a6f771dd8660fe2a99c6b84248). | Normalt mergad. [Head-CI 42026247960](https://github.com/sharbel0022/Mgeorge/actions/runs/42026247960) och [main-CI 42026878862](https://github.com/sharbel0022/Mgeorge/actions/runs/42026878862) godkända. |
| [42 — synk/avstämning](https://github.com/sharbel0022/Mgeorge/pull/42) | Head `6e3895218c719ad01a9382b360624d693a7a841f`; merge [`f1058371c4f68589d3f91748cf98a4ef3601e893`](https://github.com/sharbel0022/Mgeorge/commit/f1058371c4f68589d3f91748cf98a4ef3601e893). | Normalt mergad. [Head-CI 42028424467](https://github.com/sharbel0022/Mgeorge/actions/runs/42028424467) och [main-CI 42029000814](https://github.com/sharbel0022/Mgeorge/actions/runs/42029000814) godkända. Lokal representation `25608fe6f36eb49d2420b95369592f4bd51d2f26`. |
| [38 — onboarding](https://github.com/sharbel0022/Mgeorge/pull/38) | Slutligt publicerat head vid denna punkt: `a3b2b944428af5b4fbe31856e0f7076f3637405a`, motsvarande lokal `a8714d12b7d8e8f879bcbafb49a560f703b6e235`, träd `09d180c8a2b0f240f26885d731a11bfd3b9abd64`. | Fulla lokala grindar och oberoende granskning klara. Föregående head `caf1fe5` hade grön [CI 42029243279](https://github.com/sharbel0022/Mgeorge/actions/runs/42029243279). Slutlig [head-CI 42030628045](https://github.com/sharbel0022/Mgeorge/actions/runs/42030628045) är grön. Normalt mergad som [`512aec368aa23898f352e9f1eabf786546d5969a`](https://github.com/sharbel0022/Mgeorge/commit/512aec368aa23898f352e9f1eabf786546d5969a); [main-CI 42031299170](https://github.com/sharbel0022/Mgeorge/actions/runs/42031299170) grön i alla tre jobb. |
| [37 — säkerhet/acceptans](https://github.com/sharbel0022/Mgeorge/pull/37) | Fulltestad lokal `95d9a4184275dcbec830ab9558973beba35c8c06`, träd `41b5cda03ae26c619e69eeb3feb65959acc5d281`. Publicerat head `3215d40b559b5cb60daf068fd197054e809e5f83`, träd `03e5f4dafd6b272463338adda52a109ed91ceae9`, lokal integration `8c05cb853b5b54da474d7df96b1dcd0bb5e193ce`. | Alla lokala produktgrindar klara. Publicerad skillnad är endast tre granskade browserharness-/dokumentfiler; relevanta produktindata är oförändrade. [Acceptans-CI 42031544964](https://github.com/sharbel0022/Mgeorge/actions/runs/42031544964) är grön. [Huvud-CI 42031544894](https://github.com/sharbel0022/Mgeorge/actions/runs/42031544894) grön; GitHub-loggarna visar självständigt 1 899 Node, 3 704 Sites och 47 bridge. Även [push-acceptans 42031538898](https://github.com/sharbel0022/Mgeorge/actions/runs/42031538898) är grön. Normalt mergad som [`672c152242add9427c8526af8dd92431c526c8c2`](https://github.com/sharbel0022/Mgeorge/commit/672c152242add9427c8526af8dd92431c526c8c2), med samma tree `03e5f4dafd6b272463338adda52a109ed91ceae9`. Separat [main-CI 42032260699](https://github.com/sharbel0022/Mgeorge/actions/runs/42032260699) är helt grön: 1 899 Node, 3 704 Sites och 47 bridge; samtliga fail/skip/cancel/TODO är 0. |
| [43 — legacykompatibilitet och säker diagnostik](https://github.com/sharbel0022/Mgeorge/pull/43) | Head `ab941744c3ee38be7ecd4c3121b8e7496082b9ab`; lokal `47811cbbc91df25eb715af2953c79f92e8da38a1`; tree `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1`. Merge: `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`. | Nya fulla lokala **1 899 + 3 756 + 47 = 5 702**,0 fail/skip/cancel/TODO. [Huvud-CI42054035748](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035748) och [säkerhets-CI42054035605](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035605) success. Normal merge `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`. Main-CI redovisas separat. |

PR38:s fulla produktkod granskades som `b26af1a3914b2b4b4a442993dcfc5107de32a323`, träd `b01ae3974d0663f40bebcc5cbf4bab9db5af79c6`. Uppföljningen `a8714d12` ändrar enbart tre filer under `docs/integration/saas-onboarding-browser/`: README, browserharness och nytt daterat browserkvitto. Runtime, vanliga testsviter, beroenden och produktionsbyggets indata är oförändrade. Historisk 41-fallsacceptans har inte räknats om till ny acceptans genom dokumentuppdateringen.

Den ursprungliga Sites61-releasens kodidentiteter är fastställda: applikationsrelease `672c152242add9427c8526af8dd92431c526c8c2`, repositoryträd `03e5f4dafd6b272463338adda52a109ed91ceae9`, Sites-underträd `fead95370aead0d422f3b7da766ad7eb9c33d0bc`. En senare ren dokumentkvittocommit ska hållas åtskild från denna applikationsrelease. Main-CI42032260699 är helt grön. Sites61 är byggd och sparad med source `2084aa358dd24dc241213dc3b71bae975f1e1029`, Git-träd `fead95370aead0d422f3b7da766ad7eb9c33d0bc`; alla 575 källfiler matchar applikationsreleasens Sites-underträd och arbetsytan är ren. **Driftskvitto:** deployment `appgdep_6aec802803e08191b2e86f52a61d9abd` har status **succeeded**, `updatedAt=2026-11-05T13:10:23.873423+00:00`, miljörevision 9. Läsande efterkontroll bekräftar förväntat schema och bevarat underlag. Samma projekt, auth, audience, miljönyckelmetadata och scheman är bevarade. [Källarkiv](saas/evidence/2026-11-05/site-source-archive.json) · [Deployment](saas/evidence/2026-11-05/site-deployment.json) · [Efterkontroll](saas/evidence/2026-11-05/production-after.json).

## 3. Implementation och viktiga semantiska rättningar

### Företag, identitet och lagring

Företags-ID, inloggad aktör och lagringsägare är olika identiteter. Servern härleder företag och datagräns från aktuellt medlemskap. Klientens företags-ID väljer en redan behörig kontext; det kan inte skapa ägarskap över en annan arbetsyta. Node använder en exklusivt företagsbunden ekonomidatabas, medan Sites använder en verifierad lagringsägare inom den gemensamma infrastrukturen. Versioner följer medlemskap och vald kontext genom asynkrona operationer, cachar, OAuth och bakgrundsarbete.

Tidigare grundrättningar bevaras: företagsbindning kontrollerar alla ägares befintliga data atomärt, även vid samtidighet, och Node OAuth behåller den faktiska initierande företags-/aktörskontexten. Befintliga original flyttas inte till ett nytt tomt företag genom en godtycklig profiländring. Lagrad profiltext kan inte ge företagsbehörighet.

### Faktiskt medgivandeflöde och återkallelse

Samtyckesadaptern använder Open Payments-funktionerna för capability, consent, SCA, validerad redirect, callbackaktivering, kontolista, kontoval, förnyelse och återkallelse. Callbacken binds till företag, aktör, kontextversion, session och state. Krypterade resurshandtag är bundna till ägare, företag, anslutning, provider, miljö, generation och resurstyp. Persistenta idempotensnycklar och jämför-och-skriv av revision skyddar återförsök och samtidiga ändringar.

En reproducerad race tillät nästa kontoläsning efter att en annan operation hade satt återkallelse på vänt. Rättningen kontrollerar exakt beständig revision vid varje providergräns och flyttar bara spärren efter den egna lyckade skrivningen. Schemalagd synkning använder separat betrodd auktorisering och kräver inte en browsercookie som bara hör till den interaktiva callbacken.

Ett sent oberoende fynd efter PR39-mergen visade att ett utgånget krypterat medgivande blockerade sin egen DELETE. Förnyelse och frånkoppling kunde fastna i `revocation_pending`. Rättningen i den lokalt verifierade kandidaten `62c0944bcdd57752732b205bfa4d394469d07c1f`, inkluderad i [PR41-underlaget](https://github.com/sharbel0022/Mgeorge/pull/41), tillåter autentiserad öppning av ett utgånget **consent**-handtag endast för exakt återkallande DELETE. Vanliga status-, konto-, transaktions- och auktoriseringsläsningar kräver fortfarande giltig åtkomst. Medlemskap och applikationsbehörighet kontrolleras även runt tokenhämtning och transportsvar. Återkallelse blir bekräftad först efter lyckad DELETE; ett osäkert svar förblir väntande och kan försöka igen med samma sparade begäran.

Tolv regressioner med faktisk providerkod och AES-handtag täcker bland annat utgången förnyelse/frånkoppling, tappat DELETE-svar följt av utgång, fel ägare/företag/anslutning/generation/typ, spärrade läsningar och återkallat medlemskap. Oberoende omgranskning körde 111 riktade fall utan Critical/Important-fynd. Det ursprungliga sena fyndet ska inte döljas av att tidigare CI var grön.

### Bankoriginal, Bankgiro och ekonomisk innebörd

HTTP-lagret bevarar exakta begränsade UTF-8-svarsbytes, SHA-256, anropssökväg och svarskvitto. Det parsade bankobjektet har ett separat kvitto. Capture-kedjan validerar företag, konto, anslutning, generation, sidhänvisningar och fullständighet. En konkret sammanfogningsrättelse tillåter dokumenterade absoluta Open Payments-hänvisningar bara inom de två godkända API-ursprungen och samma kontosökväg; godtyckliga URL:er får ingen rätt att anropas.

Bankgiro-underlag går genom befintlig retention, parser och företagsbunden import. En rapport är inte automatiskt ytterligare pengar. Gemensam bankutfärdad insättningsidentitet krävs för att koppla detaljer till en AIS-insättning. Samma datum och belopp räcker inte. Återleverans dedupliceras; ändrade bankfakta under samma stabila identitet sparas som konflikt. Node behåller native-rapporten för granskning utan att lägga till en extra ekonomisk transaktion eller allokering. Sites bevarar skillnaden mellan ekonomisk förälder och rapportobservationer.

Referenser är text: `0599` förblir `0599` och får inte bli `599`. Allmän betalningsreferens, formell OCR, fakturanummer, kundidentitet och manuellt verifierad relation är separata evidensslag. Hashar och ett lyckat AIS-svar skapar inte rätt till Bankgiro-rapporter eller bevis för konto-/Bankgirorelation.

### Synkning, budget och läsande avstämning

Node och Sites använder konkreta Open Payments-adaptrar tillsammans med den gemensamma persistenta koordinatorn. Lokal kontextupplösning gör inga bankanrop. Varje faktisk token-, medgivande- och sidförfrågan passerar lease- och budgetreservation. Begränsningar från providern, inklusive Retry-After, behålls även när ett svar kommer sent. Stabil kontoidentitet gör att byte av provider-UID eller förnyat medgivande inte nollställer kvoten.

Original, importerade rader och kvitton skrivs med tenant-, medgivande-, workspace- och leasekontroller i samma beständiga transaktion. Tappat kvittosvar kan återhämtas utan dubbla pengar. Återkallad behörighet eller en ändrad revision hindrar nya ekonomiska skrivningar. Giltig AIS-import kan finnas kvar när ett senare Bankgirosteg är partiellt; det får inte bli ett påstående om full betalningstäckning.

Den nya Open Payments-kedjan kör originalmedveten **förhandsvisning**. Den skapar inga fakturaallokeringar och ändrar inga saldon genom ett matchningsförslag. Interna tester visar noll allokeringar även när bankrader och rapportoriginal har importerats. Manuella eller äldre separat behöriga avstämningsvägar ska inte beskrivas som automatiskt aktiverade av den nya kedjan.

Den oberoende PR42-granskningen reproducerade dessutom att Node kunde visa en äldre lyckad synkning och komplett AIS-täckning efter byte av medgivanderevision. Motsvarande Sites-kontroll fanns redan. Node-rättningen låter historisk `lastSuccessAt` vara kvar, men kräver aktuell anslutning/revision, aktiverad konfiguration, rätt credential-generation, stödd transport och giltigt medgivande för aktuell status/täckning. Sex regressioner var röda före rättningen och ingår nu i 32 godkända riktade Node-fall. Rättningen finns i `d1fd3504261f81adb3bcd066dbeae63aa5ec7e04`. Eftersom granskaren fick implementera den utförde integrationsansvarig den separata oberoende kontrollen och accepterade rättningen. Därefter passerade PR42:s fulla lokala sviter samt head- och main-CI. Det ursprungliga fyndet och författarens 32-fallskörning finns i [granskningssammanfattningen](saas/evidence/2026-11-05/review-summary.md); dess äldre väntan på separat kontroll är därmed stängd för denna integrerade rättning.

### Onboarding, roller och bankfaktaprojektion

UI:t använder riktiga autentiserade adaptrar för företag, medgivande, kontoval och synkstatus. Företagsbyte ogiltigförklarar privat innehåll och gamla svar. Mutationer kontrollerar roll, Origin, aktörsbunden CSRF, idempotens och revision. Viewer och accountant får läsa tillåtet underlag utan egen påhittad PSU-registrering, men kan inte hantera bankintegrationer.

En browserreproducerad instabil kontextprovider återställde formuläret under vanlig inmatning. Den rättades utan att ta bort skyddet som tömmer privat innehåll vid verkligt företagsbyte. Saknad bankkonfiguration, nekad åtkomst, utgånget medgivande och misslyckad synkning har uttryckliga tillstånd; ingen simulerad bank blir tillgänglig i produktflödet.

Det ytterligare Important-fyndet om bankfakta är stängt i `ad7aa57f3fe493dfa9b9e0a96cd9d72e74fffb2e`. Den gamla projektionen kunde märka manuellt ändrat betalarnamn och referens som bankobservation. Nu väljer `bankPaymentFieldSources` bevarad bankevidens: befintliga bankfält behålls, saknade bankfält förblir saknade och manuella beslut hålls åtskilda. Två regressioner följde faktisk Open Payments-normalisering och domänimport genom manuell ändring; de blev röda före fix och gröna efteråt. De två regressionerna ingår i den versionsbundna projektionsfilen och i de senare gröna helgrindarna. Integrationsansvarig accepterade rättningen oberoende. Den avslutande oberoende granskningen täckte hela PR38-diffen mot PR42: 53 filer, inklusive original-UI, kontrakt, routes och bankfaktaprojektion; inga kvarvarande Critical/Important-produktfynd. En ny 78/78-körning styrker den avgränsade bedömningen ([granskningssammanfattning](saas/evidence/2026-11-05/review-summary.md)).

Första synkningen är ett uttryckligt kundsteg efter sparat kontoval. Dashboardläsning varken anropar banken eller registrerar jobb. Ett accepterat mutationssvar ger en ny tillståndsläsning och presenteras inte som en lyckad import. Viewer/accountant kan läsa tillåten historik med integrationsåtgärder spärrade av både server och UI.

### Beroenden och körmiljö

Isolerad remote Node-CI avslöjade att det nya gemensamma importträdet behövde `@noble/hashes` i rotpaketet; lokalt installerade Sites-beroenden hade dolt luckan. Rotmanifest och lockfil deklarerar den redan använda versionen 2.4.0 uttryckligen. En ren rotinstallation och full körning användes som korrigerande kontroll.

En senare merge lämnade två identiska `@noble/hashes: 2.4.0`-nycklar i rotens manifest och lockfil. `650e0dcce2b6370fe49f5990cedf791c466afaf0` tar endast bort den andra deklarationen i vardera filen. Parsade JSON-objekt är djupt lika före/efter; inga versions- eller andra semantiska värden ändras. Detta är inte samma ändring som den tidigare nödvändiga explicita rotdeklarationen. Kvitto: [granskningssammanfattningen](saas/evidence/2026-11-05/review-summary.md); jämförelsen återkontrollerades när detta utkast förbereddes.

Miljö- och fixturfel redovisas som sådana: explicit syntetisk OpenSSL-konfiguration, rätt npm-CLI-kontext, verklig Node 24.22.1 och lägre testkonkurrens ersatte felaktiga eller avbrutna körningar. Assertions för konto-, roll-, tenant- och originalgränser har inte mjukats upp för att få gröna tester. Avbrutna minnespressade körningar och felaktig Node-alpha-invokering räknas inte som verifiering.

### Senare legacykompatibilitet och kanonisk diagnostik — PR43

Den oberoende granskningen reproducerade en giltig kompatibilitetsregression: äldre Sites synk kontrollerade valda konton, medan den nya gemensamma kontrollen krävde likhet för hela den cachade kontomängden. Ett fortfarande godkänt valt konto kunde därför blockeras när ett annat, ovalt konto drogs tillbaka. Livefelkodens exakta kontopredikat är okänt; rättningen och den verkliga incidenten måste hållas isär.

En separat legacyadapter kontrollerar fullständiga begränsade, unika UUID-inventeringar och exakt likhet mellan färska GET-konton och GET-kontodata före projektion. Samtliga valda konton måste finnas entydigt i både sparad och aktuell data. Valda konton prövas sedan av den oförändrade strikta policyn: business-usage, singular identitetshash, transaktionsscope, bank/land/PSU, status och samtliga utgångsgränser. UID-lösa GET-kontodata avvisas fortfarande; inget UID gissas från hash.

Kontoval, synk och detaljhämtning använder adaptern endast efter giltigt läst null/legacy-metadata. Parserfel får aldrig välja legacygrenen. Detaljhämtningen provar hela det sparade kontovalet; ett återkallat valt B stoppar en begäran om A. Company-mode och nya callbacks behåller strikt fullmängdskontroll. Node legacy hade redan sin separata kontroll av valt konto. Befintliga tenant-, medlemskaps-, generations-, lease-, cooldown- och persistensgränser ändras inte.

I den sparade synkdiagnostiken och auditloggen får samtyckesfel en fast tillåten kod och ett meddelande rekonstruerat ur den interna tabellen. Godtycklig providertext, okända koder och gettervärden förs inte vidare. Kodvärdet läses en gång inne i try/catch; regressionen för ett föränderligt gettervärde stängdes före slutgranskningen. Ingen anslutning flyttas från reauth_required till connected, ingen historik nollställs och ingen ny verklig bankförfrågan ingår. [Sjufilsgranskning](saas/evidence/2026-11-05/bank-compat-independent-review.md).

## 4. Migrationer, journal och backup

Foundationmigrationen och dess metadata behålls. Consent fick en egen efterföljande migration i stället för att skriva över foundationens `0019`.

| Journalindex | Migration | Ansvar |
| ---: | --- | --- |
| 19 | `0019_company_boundaries` | Företags-/medlemskapsgrund, ägargränser och tillhörande foundationkontrakt. |
| 20 | `0020_bank_consent_context` | Medgivandekontext och krypterat beständigt `saas_bank_state`, med ägarkontroller. |
| 21 | `0023_saas_bank_sync` | Företagsscope, jobb, requestbudget och beständiga importkvitton. |
| 22 | `0024_company_sync_boundaries` | Kumulativa företagsgränser för synkningen. |

Journalindex och filprefix är avsiktligt olika för de två sista posterna: **21 → 0023, 22 → 0024**. Det kumulativa journal-/snapshotträdet ska verifieras som en kedja. PR41 tillför i sig ingen separat SQL-migration.

Den nya backupinventeringen omfattar **27 ägarbundna tabeller**. Exakta historiska uppsättningar med **20, 22 och 23 tabeller** stöds fortsatt. Historiska snapshots fylls inte ut med uppfunna tomma tabeller, och en ofullständig ny inventering får inte utge sig för att vara ett gammalt giltigt format. Medgivandet och de fyra synktabellerna ingår i den nya inventeringen.

Isolerad evidensåterställning bevarar original och kontrollerar företagsdestinationen. Sparade jobb-leases ogiltigförklaras i återställningskopian; backupen får inte återuppliva en worker eller skapa ny medlems-/bankbehörighet. Dessa kod- och syntetiska återställningsprov är separata från läget för de verkliga produktionsbackuperna nedan.

Den avslutade Sites-helkörningen på `95d9a418` innehåller godkända prov för additiv uppgradering med bevarade ekonomiska bytes, tidigare payload/ägarscope, exakta historiska 20/22/23-tabellsformat samt unik ordnad migrationsjournal och fullständigt länkade snapshots. Källor: [slutgrindar](saas/evidence/2026-11-05/local-gates.json), [CI-kvitto](saas/evidence/2026-11-05/remote-ci.json) och [loggfingeravtryck](saas/evidence/2026-11-05/local-log-hashes.json); testspecifikationer bland annat `sites/tests/company-bank-sync-backup.test.mjs` och den kumulativa migrationskontrollen. Dessa syntetiska kodgrindar är stängda för kandidatens träd. Den lyckade deploymenten innehöll alla fyra nya journalposter. Läsande liveobservation visar 29 → 40 tabeller, inklusive samtliga11 förväntade nya tabeller. Detta styrker det förväntade schemaslutläget tillsammans med native-deploymentkvittot; direkt SQL-export av triggerkatalogen var inte tillgänglig. Backupens27 ägarbundna tabeller är ett separat mått. [Migrations-/deploymentkvitto](saas/evidence/2026-11-05/site-deployment.json).



### Cutover, migrationsutfall och bakåtkompatibilitet

Integrationsansvarigs deploymentgranskning bekräftar att migrationerna `0000`–`0018` och deras journalprefix är oförändrade. Snapshotens tabellantal går **29 → 35 → 36 → 40 → 40** genom basen, foundation0019, consent0020, sync0023 och boundary0024. Hosting- och autentiseringskonfigurationen är oförändrad i det granskade underlaget.

Cutoverkravet är **alla fyra nya migrationer före den nya Workern**. Native-deploymentpaketet innehöll den oförändrade äldre journalen plus 0019/0020/0023/0024 och publiceringen lyckades; liveschemat visar det förväntade slutantalet 40 tabeller. Befintliga etablerade Enable Banking-rader bevarades vid migrationen; detta bevisar inte att de behåller aktuell bankbehörighet, vilket den senare incidenten visar. Däremot måste identifieringar som redan hade lämnat den gamla Workern för bankredirect före cutover startas om: den nya callbacken avvisar tom migrerad initieringskontext. Detta är en avsiktlig kontextgräns, inte en automatisk återauktorisering av äldre redirects. Workerpubliceringens faktiska kvitto finns i [site-deployment.json](saas/evidence/2026-11-05/site-deployment.json). Den direkta nollräkningskontrollen omfattade endast `companies`, `company_memberships`, `company_worker_grants`, `saas_bank_state` och `company_bank_sync_jobs`; fyra rolldefinitioner var seedade. Övriga nya tabeller omfattas inte av detta nollpåstående.

## 5. Verifiering och dess giltighetsområde

Överlappande fokusgrupper adderas inte till helsviterna. Varje kvitto behåller sin SHA, miljö, omfattning och eventuella begränsning. Lokala slutkörningar använde Node 24.22.1; remote Node-CI redovisas genom sina egna länkar.

| Verifieringspunkt | Resultat | Proveniens och gräns |
| --- | --- | --- |
| PR39 slutpunkt och rotberoendefix | 1 692 Node + 3 382 Sites i angivna slutkörningar; inga fel/skip/cancel/TODO. | Separat grön [main-CI39](https://github.com/sharbel0022/Mgeorge/actions/runs/42024120779); historisk consentpunkt. Den senare utgångsrättningen ingick ännu inte. |
| PR41 med `62c0944`, träd `82563cb198cc4d6519c9dd074568dae619933bc6` | 1 710 Node + 3 497 Sites + 47 bridge; syntax 147, types och build godkända. | Historiskt PR41-kvitto; publicerad tree och remote-grindar i [remote-ci.json](saas/evidence/2026-11-05/remote-ci.json). |
| PR42, lokalt `25608fe6` / publicerad tree `f7d125883631d9354a3b7a730c3f6ad4d2fda73f` | **1 886 + 3 616 + 47 = 5 549** godkända. | Head/main-CI gröna; exakta identiteter och antal i [remote-ci.json](saas/evidence/2026-11-05/remote-ci.json). |
| PR38 produktpunkt `b26af1a` / tree `b01ae3974d0663f40bebcc5cbf4bab9db5af79c6` | **1 886 + 3 675 + 47 = 5 608** godkända; syntax 165, types/build godkända. | Onboardingkvitto identifierat i [loggfingeravtrycken](saas/evidence/2026-11-05/local-log-hashes.json); remote-status i CI-kvittot. Node kördes på ad7; enda efterföljande ändring före b26 var Sites testharness, med alla Node-indata oförändrade. |
| PR37 kumulativ kandidat `95d9a418` / tree `41b5cda03ae26c619e69eeb3feb65959acc5d281` | **1 899 + 3 704 + 47 = 5 650**, samtliga godkända utan fail/skip/cancel/TODO. | [local-gates.json](saas/evidence/2026-11-05/local-gates.json), avslutad2026-11-05T12:47:33Z. Rent träd före/efter; fulla lokala loggar identifieras av hashmanifestet. |
| Utökad intern säkerhetsacceptans på samma `95d9a418` | **325 Node + 739 Sites = 1 064** godkända, inga fail/skip/cancel/TODO. | [security-acceptance.json](saas/evidence/2026-11-05/security-acceptance.json); överlappar de 5 650 fallen ovan. |
| Oberoende utgångsrättningsgranskning | 111/111 riktade fall. | [review-summary.md](saas/evidence/2026-11-05/review-summary.md); omfattar de 12 nya utgångsregressionerna. |
| Node-statusfix / faktisk providerimport | 32/32 efter sex avsiktliga röda regressioner; ytterligare Sites-/request-/referensjoin 18/18. | [granskningssammanfattningen](saas/evidence/2026-11-05/review-summary.md); efterföljande oberoende kontroll av integrationsansvarig accepterad. |
| Oberoende PR38 kumulativ granskning | 78/78; 0 fail/skip/cancel/TODO, 7 969,115772 ms. | [Granskningssammanfattning](saas/evidence/2026-11-05/review-summary.md). Granskning av 53 ändrade filer och sex historiska bilder; ingen ny CUA-körning av granskaren. |
| Schema, återhämtning och skala | 45/45, cirka 43,09 s för hela gruppen. | Det versionsbundna skalprovet;1/10/100-mätningen särredovisas nedan och ingår i [acceptansmanifestet](saas/evidence/2026-11-05/security-acceptance.json). |
| PR43 separat slutkandidat `47811cbbc91df25eb715af2953c79f92e8da38a1` / tree `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1` | **1 899 Node + 3 756 Sites + 47 bridge = 5 702**,0 fail/skip/cancel/TODO. | [bank-compat-gates.json](saas/evidence/2026-11-05/bank-compat-gates.json). Nya fulla körningar på exakt fryst index; senare commit/head är trädidentiska. |
| PR43 säkerhets-CI42054035605 | **325 Node + 750 Sites = 1 075**,0 fail/skip/cancel/TODO. | Ny separat faktisk GitHub-körning, överlappar5 702; ingen ometikettering av tidigare1 064. |
| PR43 riktad komplettering | Oberoende **54 + 36 + 90 = 180** och författare **54 + 130 + 90 = 274**. | Överlappar de nya5 702; [oberoende kvitto](saas/evidence/2026-11-05/bank-compat-independent-review.md). Befintliga assertions behållna; giltig UUID i detaljfixturen. |

Den ursprungliga säkerhetskandidatens övriga lokala grindar: syntax för 170 Nodefiler och bridge, Sites TypeScript, separat produktionsbygge och verifiering av installerade minimatch-mitigeringsbytes godkända. Rootaudit och bridgeaudit har 0 fynd; full Sites-audit har 8 moderate, 0 high/critical. Sites produktionsaudit på PR38 hade 0 fynd; Sites lockfil och produktionsberoenden har inte ändrats i säkerhetskandidatens uppföljning. Det senare fulla auditkvittot redovisas separat.

Miljömisslyckanden har inte raderats ur historiken eller räknats som godkända. PR38:s initiala sex React-harnessfel och ett saknat isolerat bridgeberoende följdes av rättade, fullständiga gröna körningar. En initial säkerhetskörning via `npm exec -- node` råkade välja cachad Node 27-alpha, avslutades med 130 och exkluderades; fulla körningar startades om med exakt Node 24-exekverbar fil. Den slutliga produktkoden ändrades inte för alpha-miljön.

Det finns **ingen kvarstående lokal verifieringsgrind för den frysta `95d9a418`-kandidaten** enligt kvittot. Integrationsansvarig har dessutom jämfört `95d9a418` med den publicerade PR37-kandidaten via `8c05cb853b5b54da474d7df96b1dcd0bb5e193ce`: endast de tre granskade browserharness-/dokumentfilerna skiljer. Oberoende konstruerat förväntat träd motsvarar publicerad tree `03e5f4dafd6b272463338adda52a109ed91ceae9`. De fulla lokala produktkvittona gäller därmed oförändrade relevanta indata; någon ny automatisk browserkörning följer inte av detta. PR37:s huvudworkflow 42031544894 och båda acceptansworkflows 42031544964/42031538898 är nu gröna, och normal merge672c152 är genomförd med samma repositoryträd. GitHub-loggarna styrker självständigt helsviternas 1 899/3 704/47-resultat. Separat main-CI42032260699 är nu helt grön med samma 1 899/3 704/47 och 0 fail/skip/cancel/TODO. Sites61-deploymenten har därefter lyckats och autentiserade läsande efterkontroller har passerat; se [produktionskvittot](saas/evidence/2026-11-05/production-after.json).

För PR43 kördes dessutom syntax 170, TypeScript, separat build och mitigation om på det nya frysta trädet och passerade. Root-, bridge- och Sites-produktionsaudit visar 0; full Sites-audit har 8 moderate/0 high/critical, med oförändrade manifest och lockfiler. Provisoriska femfils-Node/Sites-körningar avbröts med130 när detaljvägen lades till; de räknas inte som pass. De slutliga sjufilskörningarna ovan ersätter dem. Ett separat runnerfel före TypeScriptstart är redovisat som exkluderat; den faktiska typkontrollen kördes därefter och passerade. [Nya grindars proveniens](saas/evidence/2026-11-05/bank-compat-gates.json).

## 6. Faktiska tre företagsgränser och roller

Acceptansen skapar tre syntetiska företag genom de faktiska foundation-API:erna. Node använder separata SQLite-partitioner. Sites använder verklig medlemskaps-/scope-/requestkod med syntetiska autentiserings-, D1- och R2-transporter. Detta är inte tre kommersiellt onboardade kunder.

En gemensam aktör har olika roller per företag; owner/admin/accountant/viewer kontrolleras uttryckligen. Identiska faktura-, transaktions-, medgivande- och jobb-ID:n får inte blanda original eller cachar mellan företag. Tester omfattar återkallat medlemskap under await, fångade SQL-statements efter rollnedgradering, försök att återanvända en annan företagskontext, viewer-uppladdning, accountant-hantering av integrationer och gamla browserresponser efter företagsbyte.

Ett avbrutet R2-originalsvar efter medlemsåterkallelse levereras inte till klienten, samtidigt som det sparade originalet bevaras. Företagsbunden backup får bara återställas till rätt verifierad destination. Avgränsad oberoende granskning av den ursprungliga PR37-säkerhetsändringen fann inget Critical/Important-fynd i den angivna omfattningen. Den senaste utökade acceptansen inkluderar verkliga Open Payments-adaptrar, utgångsrättning, råsvarskvitton, aktuell auktoritet, onboardingserver och läsande betalningsprojektion. Dess etikett är `INTERNAL_BOUNDARIES_PASSED`; `productionAcceptance` är fortfarande `NOT_VERIFIED` och `commercialLaunch` `NOT_APPROVED`. Källor: [security-acceptance.json](saas/evidence/2026-11-05/security-acceptance.json), [granskningssammanfattningen](saas/evidence/2026-11-05/review-summary.md) och `docs/integration/saas/security-integrated-acceptance.md`.

## 7. Mätning med 1, 10 och 100 företag

Källa: de tre JSON-mätposterna från den lokala körningen av versionsbundet `sites/tests/company-sync-scale.test.mjs`. Körningen ingår i [acceptansmanifestet](saas/evidence/2026-11-05/security-acceptance.json); mätvärdena återges här utan krav på tillgång till scratchloggen. Testet använder riktig tenantdatabas och den persistenta koordinatorn, fem samtidiga workers som övre gräns, syntetiska requestresultat, ett beständigt kvitto per företag och återleverans. Inga provideranrop eller ekonomiska skrivningar utförs i själva skaltestet.

| Syntetiska företag | Provisionering | Första körning | Återleverans | Beständiga kvitton |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 16,50 ms | 37,71 ms | 15,75 ms | 1 |
| 10 | 24,99 ms | 166,25 ms | 112,08 ms | 10 |
| 100 | 221,50 ms | 1 508,73 ms | 1 188,28 ms | 100 |

Återleverans gav noll nya importer och en dubblett per företag. Auditposter och kvitton stannade inom respektive scope trots kolliderande syntetiska identifierare. Mätningen är ett avgränsat lokalt koordinationsprov och anger varken bankens svarstid, produktionskapacitet, kostnad per kund eller en SLA.

## 8. Browseracceptans och produktionsinspektion

Integrationsansvarig använde den tillåtna hanterade browsern mot en ny fixturebaserad bundle av faktiska CompanyWorkspace- och BankPage-komponenter på `ad7aa57`; b26-uppföljningen ändrade endast testharness. Det separat daterade [integrerade browserkvittot](integration/saas-onboarding-browser/integrated2026-11-05.md) redovisar följande faktiska mätningar:

| Begärd viewportbredd | Uppmätt clientWidth / scrollWidth |
| ---: | ---: |
| 320 | 305 / 305 |
| 390 | 375 / 375 |
| 768 | 753 / 753 |
| 1024 | 1 009 / 1 009 |
| 1440 | 1 425 / 1 425 |

Skillnaden på 15 px beror på den vertikala rullisten. Ingen horisontell overflow observerades. Skapa-företag-formuläret låg kvar under inmatning och fokusbyte; Avbryt återställde fokus. Frånkopplingsdialogen började på Behåll, höll tangentbordsfokus inom dialogen och återställde triggerfokus efter Escape. En bank utan konfiguration startade ingen auktorisering. Viewer kunde läsa status; knappar för bankmutationer var **inaktiverade**, inte frånvarande. Utgånget medgivande visade förnyelse och spärrade kontoval/synkning. Nekad åtkomst ersatte appen med åtkomstfel. Företagsbyte visade övergångstillstånd och därefter den valda företagets rubriker, roll och kontext.

Den automatiska 41-fallsloggen, dess manifest och sex screenshots är **historiska från 2026-11-04**. Aktuell separat root-CUA är inte en omkörning av dessa 41 fall. `a8714d12` anpassar harnessen till exakt `name` + `confirmEmptyCompany:true`, null för obekräftat organisationsnummer och 201-svar. Dokumenten markerar den tidigare loggens historiska omfattning; ingen ny automatiserad 41/41-framgång påstås.

### Avgränsad visuell produktionskontroll

Efter publicering lyckades bootstrap av den anslutna browsern. Navigeringsbegäran fick timeout och sessionen återställdes; nästa dokumenterade API-referens var undefined. **Ingen DOM observerades och ingen visuell produktionsbrowseracceptans räknas som godkänd.** En direkt oautentiserad CLI-HTTP-förfrågan gav 403. Separata autentiserade MCP-läsningar lyckades, och native deployment, källparitet samt läsande D1-/status-/underlagskontroller styrker den redovisade produktionsomfattningen.

Detta är ett avslutat, avgränsat inspektionsutfall; timeouten bevisar ingen applikationskrasch. Inga ytterligare browserförsök ingår i slutkvittot. Fysisk mobil, manuell skärmläsaracceptans och verklig BankID-resa påstås inte heller. [Browserbegränsning och godkända autentiserade läsningar](saas/evidence/2026-11-05/site-deployment.json).

## 9. Aktuell bankstatus, historisk cutover och uppföljningspublicering

### Aktuell verklig bankanslutning: NEJ

Det schemalagda legacybankförsöket **2026-11-05T14:04:35.832Z** misslyckades med **`BANK_ACCOUNT_SCOPE_INVALID`**, bekräftat i det fullständiga automationsresultatet och den läsande kontrollen **14:47:11.579Z**. Raden är `reauth_required`, `connected=false`, `sync_failures=1`, `blocked=false`; senaste lyckade synk är fortfarande **08:05:14.646Z**. Sparad giltighet löper till **2027-01-25T19:45:06.954Z**, och äldre consentmetadata saknas. En framtida utgångsdag bevisar inte aktuell auktorisering. [Daterat incidentkvitto](saas/evidence/2026-11-05/bank-incident.json).

Bekräftad felväg är samtyckesvalideringen, och den tidigare generiska felrapporteringen tappade den specifika ConsentError-diagnosen. **Exakt felande kontopredikat är inte fastställt:** det verkliga providersvaret har varken bevarats eller hämtats på nytt. Den separat reproducerade legacyregressionen gäller ett giltigt valt konto när ett annat, ovalt konto lämnar den cachade fullmängden. Dess rättning ska inte presenteras som bevisad orsak till dagens livefel.

0599 lästes på nytt **15:01:10.767Z**: revision 51, `snapshotCurrent=true`, `changed=false`, fortfarande en ekonomisk AIS-observation och en icke-ekonomisk rapport på 62 500 öre vardera (625 kr), noll allokeringar, oregistrerad faktura och ofullständigt underlag. Jämförelsen mot 13:13 är **inte helt identisk**: utöver lästiden ändrades tre fält för aktuell samtyckesbedömning. Två kontoförklaringar kräver nu en aktiv ägarbunden anslutning och rapportens aktuella AIS-medgivande kräver granskning. Övriga valda svarsfält är lika. Efter Sites62 lästes samma valda svar15:37:27.308Z och jämfördes med15:01:10.767Z: **0 skillnader när enbart rekursiva checkedAt-fält undantas**. De tre samtyckesbedömningsskillnaderna mot13:13 kvarstår; ekonomin är bevarad. Ingen full workspacepayloadjämförelse påstås.

Cachelagrad applikationsmetadata från **2026-10-27T19:45:36.601Z** innehåller callback på den äldre `asdasdsa213`-hosten, medan publicerad applikation använder `sharbelrasho.chatgpt.site`. Providerregistrering och callbackens nåbarhet behöver verifieras inför en behörigt initierad förnyelse. Detta är läst D1-cache, **ingen färsk verifiering eller ändring hos providern**. Inga manuella bankanrop, produktionsdataåterställningar, ekonomiska åtgärder eller schemaändringar gjordes. Sites62-publiceringen återställde inte reauthstatusen. Den läsande efterkontrollen15:38:53Z visar fortfarande `connected=false`, `reauth_required`, ett misslyckat försök, samma last_success08:05:14.646Z och oförändrad bankradstid14:04:45.787Z. Ingen verklig bankåterhämtning är verifierad. [Efterkontroll](saas/evidence/2026-11-05/bank-compat-release.json).

### Historisk Sites61-cutover, inte aktuell bankhälsa

Applikationsrelease `672c152242add9427c8526af8dd92431c526c8c2`, repositoryträd `03e5f4dafd6b272463338adda52a109ed91ceae9`, publicerades som Sites61 från source `2084aa358dd24dc241213dc3b71bae975f1e1029`. Git-trädet `fead95370aead0d422f3b7da766ad7eb9c33d0bc` matchade exakt med 575 jämförda källfiler. Deployment `appgdep_6aec802803e08191b2e86f52a61d9abd` lyckades **13:10:23.873423+00:00**. [Historiskt deploymentkvitto](saas/evidence/2026-11-05/site-deployment.json).

Vid **13:13:22.521Z** var de maskerade bank-/Gmail-/Bankgiro-/backupobjekten identiska mot förkontrollen. Livetabellerna var 40, varav 11 nya; en arbetsyta behöll ägare/revision 51/uppdateringstid. **Endast de fem uttryckligen kontrollerade tabellerna** `companies`, `company_memberships`, `company_worker_grants`, `saas_bank_state` och `company_bank_sync_jobs` är belagda med 0 rader; `company_roles` hade 4. Detta är ingen census av samtliga nya auktoritetstabeller. Auth/audience/scheman och miljörevision9 med 17 nycklar var oförändrade. [Före](saas/evidence/2026-11-05/production-before.json) · [Historiskt efter](saas/evidence/2026-11-05/production-after.json).

Bankens connected-status i detta historiska kvitto ersätts av den senare underkända statusen ovan. Gmail förblir pausat med okänd verifierad pausorsak; senaste lyckade hämtning2026-11-03T18:38:10.461Z och separat tom `connection.last_synced`. Bankgirokälla `SOURCE_NOT_CONFIGURED`. BackupNov5 hade362 kopierade/35 verifierade filer; senast fullaNov4 hade362/362, verifierad21:32:59.743Z. API-kvitton16 respektive15 och112 poster utan kvitto är andra mått än filverifiering. Historisk [OCR42013301104](https://github.com/sharbel0022/Mgeorge/actions/runs/42013301104) påf75 hade processed0/failed0; tidigare404-originfel var rättat före fortsättningen. Ingen ny dokumentgenomströmning eller full katastrofåterställning certifieras.

Aktuell separat fixture-CUA täckte fem bredder, stabil inmatning och dialogfokus; viewer kunde läsa status medan mutationsknappar var inaktiverade. Historiska41 Chromiumfall räknas inte som en ny körning. Produktionsbrowserns bootstrap lyckades men navigeringen fick verktygtimeout/sessionreset, utan DOM-observation. Ingen visuell produktionsacceptans eller appkrasch påstås; autentiserade MCP-/D1-läsningar lyckades inom sitt avgränsade scope.

### Separat kompatibilitetsrelease, PR43

[PR43](https://github.com/sharbel0022/Mgeorge/pull/43), head `ab941744c3ee38be7ecd4c3121b8e7496082b9ab`, motsvarar lokal commit `47811cbbc91df25eb715af2953c79f92e8da38a1`, repositoryträd `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1` och Sites-underträd `a17a42a1c9a4976717003defc40aeb54b9624bfa`. Alla nya fulla grindar kördes på detta frysta index utan ostagade skillnader; senare commit och publicerat head har exakt samma träd. Det är nya körningar, inte återanvända672-resultat. [Nya grindar](saas/evidence/2026-11-05/bank-compat-gates.json).

**1 899 Node + 3 756 Sites + 47 bridge = 5 702 godkända**, med 0 fail/skip/cancel/TODO. Syntax 170, typer, build och installerad minimatch-mitigering godkända. Runtimeaudits är 0; full Sites-audit har 8 moderate och 0 high/critical, på oförändrade beroenden. Oberoende 180 och författarnas 274 riktade fall överlappar fullsviterna. [Oberoende granskning](saas/evidence/2026-11-05/bank-compat-independent-review.md) · [fil-/logghashar](saas/evidence/2026-11-05/bank-compat-independent-review.json).

Sju filer korrigerar kontoval, synk och detaljhämtning för **endast befintlig legacykontext**. Fulla råa UID-inventeringar måste fortfarande vara begränsade, giltiga och unika; alla valda konton måste finnas i cache och aktuellt medgivande. Därefter bevaras strikt kontroll av vald usage, identitetshash, bank/PSU, transaktionsscope och utgång. Nya callbacks och company-mode förblir strikt fullmängdskontrollerade. Detaljhämtning kontrollerar hela det sparade kontovalet. Kanoniska felkoder/meddelanden bevaras utan providertext eller föränderliga gettervärden. Status, leaser, cooldowns, tenantgränser och data återställs inte. Tidigare assertions behålls; detaljfixturens konto-ID rättas till giltig UUID.

| Uppföljningsfält | Verifierat slutkvitto |
| --- | --- |
| PR43 huvud-CI | [42054035748](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035748), **success**; hämtade faktiska loggar visar1 899 Node+3 756 Sites+47 bridge,0 fail/skip/cancel/TODO. |
| PR43 säkerhets-CI | [42054035605](https://github.com/sharbel0022/Mgeorge/actions/runs/42054035605), **success**;325 Node+750 Sites=1 075 överlappande fall,0 fail/skip/cancel/TODO. |
| Normal merge / runtime-release-SHA | `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f` |
| Separat main-CI | [42055222273](https://github.com/sharbel0022/Mgeorge/actions/runs/42055222273), **success** på b2e7f4b; skapad15:27:51Z, uppdaterad15:33:32Z. Faktiska jobb127341662492/127341662657/127341662877 visar1 899/3 756/47,0 fail/skip/cancel/TODO. |
| Uppföljningens Sites-version / source | **62, publicerad** / `1972b9a803458e20c6dedd30a8624ad4b96016f7`;575 källfiler matchar exakt Sites-trädet a17a42a1c9a4976717003defc40aeb54b9624bfa; ren arbetsyta. |
| Deployment | `appgdep_6aeca22254f4819197e33847966a7c70`, **succeeded**, uppdaterad `2026-11-05T15:35:16.437170+00:00`, miljörevision9 och samma URL. |
| Läsande efterkontroll | Kvitto15:38:53Z: publicerad version62,40 tabeller, samma arbetsyta/revision51, oförändrad auth/audience/miljömetadata och alla tre scheman. Bank fortfarande reauth_required.0599 kl.15:37:27.308Z är identisk mot15:01 utom rekursiva checkedAt-fält. |

Normal merge är `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`; även den separata main-CI-körningen är success. Slutlig proveniens finns i [bank-compat-release.json](saas/evidence/2026-11-05/bank-compat-release.json). Sites62 använder source `1972b9a803458e20c6dedd30a8624ad4b96016f7`; versionerna60 och61 finns kvar. Hosting- och migrationsfiler är byte-identiska mot61. De fem namngivna auktoritetstabellerna har fortsatt0 rader, roller4 och arbetsytor1. Hemliga värden var maskerade; oförändrad miljörevision/metadata och avsaknad av mutation är konfigurationsbeviset. **Den lyckade deploymenten bevarade reauth_required; verklig bankanslutning är fortfarande NEJ.**

Färsk läsande OCR-kontroll **2026-11-05T15:39:02Z** hittade ingen nyare schemalagd körning bland API-listans senaste15. Senaste observerade är [42013301104](https://github.com/sharbel0022/Mgeorge/actions/runs/42013301104), jobb127197454985, headf75; faktisk logg10:45:30.6420193Z gav **processed0, failed0**, schedule success. Detta verifierar varken bearbetning av ett verkligt dokument eller den nya b2e7-körkoden. Ingen workflowdispatch utfördes. [Sanerat OCR-kvitto](saas/evidence/2026-11-05/final-ocr-observation.json).

## 10. Säkerhetsgrindar och kvalitetspoäng

Den nya PR43-rättningens root-, bridge- och Sites-produktionsaudit har **0 fynd**, enligt [bank-compat-gates.json](saas/evidence/2026-11-05/bank-compat-gates.json). Den ursprungliga säkerhetskandidatens root- och bridgeaudit hade också0. Full Sites-audit redovisar fortfarande **8 moderate-fynd i utvecklingsberoenden, 0 high och 0 critical**. Sites produktionsaudit var 0 i PR38-kvittot; produktionsberoendena är oförändrade. Dessa mått hålls åtskilda i [local-gates.json](saas/evidence/2026-11-05/local-gates.json) och onboardingkvittot identifierat i [hashmanifestet](saas/evidence/2026-11-05/local-log-hashes.json). En passerad high-grind avlägsnar inte moderate-fynden. Befintlig minimatch-mitigering och dess obligatoriska bytekontroll behålls; tidigare lintskuld är inte åtgärdad eller omklassificerad av detta uppdrag.

Node-login har en 8 KiB budget före autentisering, även för strömmade kroppar. Sites räknar hela multipartströmmen före parsing, med 16 MB totalgräns och bibehållen 15 MB filgräns. Transportloggning använder fasta händelser utan godtycklig providertext, tokens eller radinjektion. Testguardens loopbackbegränsning hindrar oavsiktlig extern trafik; den påstås inte vara en säker sandbox mot skadlig testkod. GitHub Actions-referenser är pinnade.

**Alla 33 numeriska kvalitetspoäng är oförändrade: 255/330 = 7,73/10; 0/33 är minst 9,5.** Testmängd, fler företag i fixturer eller en lokal byggframgång höjer inte produktionsberoende poäng. Den befintliga [QUALITY-SCORECARD.md](https://github.com/sharbel0022/Mgeorge/blob/f75a293f367980cd360eca1886a2728db9c3e1f2/QUALITY-SCORECARD.md) är jämförelsebas; integrationsansvarig uppdaterar endast evidens och kvarstående begränsningar i slutlig matris.

## 11. Slutbedömning och kvarstående externa gränser

**VERKLIG BANKANSLUTNING GODKÄND: NEJ. KOMMERSIELL LANSERING: NOT_APPROVED.** Den faktiska legacyanslutningen är reauth_required efter ett bekräftat BANK_ACCOUNT_SCOPE_INVALID-fel; ny verklig Open Payments-anslutning är NOT_VERIFIED. Slutbedömningen gäller dessa faktiska tillstånd även om den separata kodrättningen får grön CI och publiceras.

PR36–42, deras historiska main-CI och Sites61-cutovern är avslutade. De tidigare kodfynden62c0944, d1fd350 och ad7aa57 är stängda inom respektive testade omfattning. PR43 korrigerar en separat reproducerad legacyregression i alla tre Sites-läsoperationer och säkrar diagnostiken; nya fulla lokala grindar och oberoende granskning är klara. Normal PR43-merge `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f`, PR:ens huvud-/säkerhets-CI och separat main-CI42055222273 är godkända. Sites62-publicering och läsande efterkontroll är också genomförda med ett separat faktiskt kvitto i avsnitt9. Den lagrade underkända bankstatusen är uttryckligen bevarad.

Ingen återauktorisering, manuell providerhämtning eller datareset genomfördes för att ändra produktionsutfallet. En lagrad utgångsdag i framtiden ersätter inte ett aktuellt giltigt medgivande. Cachelagrad callbackmetadata behöver verifieras mot faktisk providerregistrering/nåbarhet inför en behörigt initierad förnyelse. Exakt felande predicate i det tidigare livesvaret är okänt.

Produktionsbrowsern nådde ingen DOM på grund av verktygtimeout/sessionåterställning; ingen visuell produktionsacceptans påstås. Gmail förblir pausat utan verifierad pausorsak. Bankgirokälla är inte konfigurerad. 0599 förblir ekonomiskt oförändrat, oregistrerat, ofullständigt och utan allokering; tre aktuella samtyckesbedömningsfält försämrades vid den senare kontrollen. Samtliga 33 kvalitetspoäng är oförändrade,255/330=7,73/10. Syntetiska pass och lyckad appdeployment ändrar inte den operativa bankbedömningen.

## 12. Versionslagrade kvitton och reproducerbara källor

Rapportens resultat, identiteter och begränsningar står i själva texten. Följande kompakta kvitton ligger under `docs/saas/evidence/2026-11-05/` i dokumentationsleveransen. De är relativa repositorylänkar; de stora scratchloggarna påstås inte vara kopierade eller committade.

| Kvitto | Vad det styrker |
| --- | --- |
| [remote-ci.json](saas/evidence/2026-11-05/remote-ci.json) | Samtliga PR36–42, huvud-/merge-SHA:er, historisk remote-CI för ursprunglig applikationsrelease672, dess repository-/Sites-träd och ursprungliga mainens1 899/3 704/47. |
| [local-gates.json](saas/evidence/2026-11-05/local-gates.json) | Fryst lokalt 95d9-träd, Nodeversion, 5 650 helsvitspass, syntax, typer, build, audit, mitigation och exkluderade miljöförsök. |
| [security-acceptance.json](saas/evidence/2026-11-05/security-acceptance.json) |1 064 överlappande fall, exakta testvägar, tre företag/roller och uttalade gränser för produktion/kommersiell aktivering. |
| [review-summary.md](saas/evidence/2026-11-05/review-summary.md) | Avgränsade oberoende granskningar, bekräftade fynd/rättningar,111/32/18/78-fokusgrupper och skillnaden mellan testat rootträd och identiska produktindata. |
| [local-log-hashes.json](saas/evidence/2026-11-05/local-log-hashes.json) | SHA-256 och storlek för angivna lokala slutloggar/reviewunderlag. Ett loggfingeravtryck är inte en committad full logg. |
| [site-source-archive.json](saas/evidence/2026-11-05/site-source-archive.json) | Sparad Sites-källa/träd/arkiv, samma projekt/bindningar och de fyra migrationsposterna. |
| [site-deployment.json](saas/evidence/2026-11-05/site-deployment.json) | Sites61 succeeded, version/source/treeparitet,575 jämförda källfiler, miljörevision, migrationernas schemautfall, bevarad tidigare version och browserbegränsning. |
| [production-before.json](saas/evidence/2026-11-05/production-before.json) | Maskerad skrivfri Site60-/bank-/Gmail-/Bankgiro-/backup-/0599-baslinje med exakta fält och lästid. |
| [production-after.json](saas/evidence/2026-11-05/production-after.json) | Historisk Sites61-kontroll kl. 13:13:40 tabeller, fem namngivna tabeller med 0 rader, fyra roller och daterade oförändratjämförelser; inte aktuell bankhälsa. |
| [bank-incident.json](saas/evidence/2026-11-05/bank-incident.json) | Senare schemalagt konto-/medgivandefel, faktisk reauthstatus, okänt exakt livepredikat,0599-jämförelse kl. 15:01 och cachelagrad callbackbegränsning. |
| [bank-compat-gates.json](saas/evidence/2026-11-05/bank-compat-gates.json) | Nya5 702 fulla pass på ed92, nya syntax-/typ-/buildgrindar, audits, överlappande riktade grupper och exkluderade provisoriska försök. |
| [bank-compat-independent-review.md](saas/evidence/2026-11-05/bank-compat-independent-review.md) och [JSON](saas/evidence/2026-11-05/bank-compat-independent-review.json) | Hela sjufilsdiffen granskad,180 oberoende pass, oförändrade företagsgränser och ingen verklig bankåterställning. |
| [final-ocr-observation.json](saas/evidence/2026-11-05/final-ocr-observation.json) | Färsk läsande15:39-observation av samma historiska schemalagda OCR-jobb påf75:0 behandlade/0 fel, ingen ny genomströmnings- eller b2e7-acceptans. |
| [bank-compat-release.json](saas/evidence/2026-11-05/bank-compat-release.json) | Faktisk PR43-merge b2e7, grön ny main-CI, succeeded Sites62/sourceparitet, läsande efterjämförelser och uttryckligen underkänd verklig bankstatus. |

[Full ändringsinventering](saas/FINAL-CHANGED-FILES.txt) avser applikationsdiffen **f75a293 → b2e7f4b: 219 filer, 75 ändrade och 144 tillagda, 0 raderade**. Den omfattar de fem fortsättnings-PR:erna och PR43 efter PR40/PR36-baslinjen. Alla sju uppföljningsfiler ingick redan bland de219, så de läggs inte till en gång till. Senare dokument-/kvittotillägg hålls separat.

Reproducerbara huvudvägar:

| Bevisområde | Versionsbundet kod-/testunderlag |
| --- | --- |
| Consent/utgång | PR41-head `86730fe47aab8736c6cfb04d672c5e04a10d473d`: `sites/tests/openpayments-expired-revocation.test.mjs`, `openpayments-lifecycle.test.mjs`, `saas-bank-runtime.test.mjs`. [Utgångsregressioner](https://github.com/sharbel0022/Mgeorge/blob/86730fe47aab8736c6cfb04d672c5e04a10d473d/sites/tests/openpayments-expired-revocation.test.mjs). |
| Synk och original | Historiskt verifierad release `672c152242add9427c8526af8dd92431c526c8c2`: `test/openpayments-company-bank-sync.test.js`, `test/openpayments-company-bank-sync-normalization.test.js`, `sites/tests/openpayments-company-sync.test.mjs`, `openpayments-request-boundary.test.mjs`, `openpayments-raw-receipt.test.mjs`. [Node-regressioner](https://github.com/sharbel0022/Mgeorge/blob/672c152242add9427c8526af8dd92431c526c8c2/test/openpayments-company-bank-sync.test.js). |
| Migration/backup | Samma historiskt verifierade release672: `sites/tests/company-sync-boundary-integration.test.mjs`, `company-bank-sync-backup.test.mjs`, `company-backup.test.mjs`, `sites/drizzle/meta/_journal.json` och `sites/lib/backup-engine.ts`. [Historiska snapshotprov](https://github.com/sharbel0022/Mgeorge/blob/672c152242add9427c8526af8dd92431c526c8c2/sites/tests/company-bank-sync-backup.test.mjs). |
| Onboarding/bankfakta | `sites/tests/saas-onboarding-{client,contract,projection,server,views}.test.mjs`, `sites/tests/company-workspace-ui.test.mjs` och den faktiska synk-/serverprojektionen. [Originalfältsregressioner](https://github.com/sharbel0022/Mgeorge/blob/672c152242add9427c8526af8dd92431c526c8c2/sites/tests/saas-onboarding-projection.test.mjs). |
| Tre företag/roller och säkerhet | `test/saas-company-acceptance.test.js`, `sites/tests/saas-company-acceptance.test.mjs`, `scripts/run-saas-security-acceptance.mjs`, login-/testisoleringsprov samt Sites transportprivacy/uploadgränser. Exakt manifest finns i acceptanskvittot ovan. |
| PR43 legacykompatibilitet | Publicerat head `ab941744c3ee38be7ecd4c3121b8e7496082b9ab`: `sites/lib/bank-consent-policy.js`, `sites/lib/banking/{service,details-service}.ts` samt `sites/tests/{bank-consent-policy,banking-security,bank-details}.test.mjs`. Alla tre läsoperationer och säker diagnostik omfattas. |
| Skala 1/10/100 | `sites/tests/company-sync-scale.test.mjs` och den verkliga persistenta koordinatorn. Mätvärden och avgränsning finns fullständigt i avsnitt 7; inga live-providerprestanda påstås. |

Historisk runtime-release672c152/Sites61, separat PR43-runtime-release `b2e7f4b23d26e9bf3aa84c6fdc21702562f3aa4f` och eventuell senare ren dokumentationscommit ska hållas åtskilda i driftjämförelsen. [Kommersiella grindar](saas/COMMERCIAL-LAUNCH-GATES.md) och [kvalitetspoäng](../QUALITY-SCORECARD.md) behåller sina uttryckliga gränser.
