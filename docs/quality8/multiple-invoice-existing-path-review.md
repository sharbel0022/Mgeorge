# Område 23: befintliga skrivvägar och oberoende granskningsmatris

2026-11-05. Läsande granskning, inga ändrade poäng. Första reproduktion på
74186185672c6c83e35ad2d28451c546c10ac67f; den sparade harnessens omkörning
17:49 UTC på 72c7c6c3667821cb43165721ffb16f6d9d953a7d gav **15/15**:
10 Sites, 3 Node HTTP, 2 C4. Node 24.22.1, Linux. Inga externa bank-/Gmailanrop,
produktionsdata eller kundoriginal användes.

## Slutsats

Direkt upprepad matchning mot samma bankoriginal med två eller tre olika
M.George-fakturareferenser stoppas av befintlig referenspolicy i båda motorerna.
Sites har en fungerande alternativ väg: **Dela upp samlingsbetalning**, därefter
separata delmatchningar. Den bevarar bankoriginal och totalsumma men består av
flera commits. Node har ingen motsvarande manuell uppdelningsväg. C4 är fortsatt
ett läsande förslag, även efter ett i övrigt giltigt lagrat godkännande.

Detta är avgränsad funktions- och säkerhetsevidens. Rapporten påstår inte att ett
verkligt flerfakturaflöde är godkänt i produktion eller att område 23 nått 8.

## Konkreta kontrakt och reproduktioner

| Gräns | Kodställe på granskad kod | Observerat utfall |
|---|---|---|
| Strikt referenspolicy | src/db.js:209, anrop på :562; sites/lib/domain.ts:194, anrop på :561 | Varje bevarad bankreferens måste passa den enskilda fakturan. Två/tre olika referenser ger Node 409 eller Sites 400, även med referenceCorrection:true. |
| Node manual-UI | public/app.js:210, route src/server.js:886 | UI föreslår upprepad delmatchning, men den vägen fungerar inte för det reproducerade M.George-flerreferensfallet. |
| Sites uppdelning | sites/app/dashboard.tsx:356 och :382; sites/lib/domain.ts:545 | Exakta positiva heltalsören skapar manuellt verifierade delposter. Bankföräldern bevaras. Uppdelningen ger först noll allokeringar. |
| Sites slutskrivning | sites/app/api/state/route.ts:12 och :42; sites/lib/reconciliation-evidence.ts:194 | Request-id, revision och kontomedgivandets slutliga transaktionsspärr skyddar respektive deloperation. |
| C4 godkännande | sites/lib/reconciliation-contract.js:324 och :379 | Flerfakturaförslag är REVIEW. Även VERIFIED bankevidens och perfekt stored approval ger DECISION_NOT_VERIFIED; writesAllowed förblir false. |

Positiva syntetiska fördelningar: **73 100 öre = 30 001 + 43 099**, respektive
**73 100 = 10 001 + 20 002 + 43 097**. Sites kan färdigställa dem via sin befintliga
stegvisa väg. Bankens original-JSON och den ekonomiska totalsumman är oförändrade.

Efter första delgodkännandet i trefakturafallet är 10 001 öre bokat och
20 002 + 43 097 återstår. Återkallat medgivande stoppar nästa steg men bevarar den
tidigare delen. Detta styrker säker delprogress, inte atomärt godkännande av hela
vektorn. En senare operation kan också använda befintlig automatisk avstämning;
provet tillskriver inte alla slutallokeringar en enda uttrycklig manuell åtgärd.

Samtidiga identiska Sites-anrop gav 200/409; replay gav 200 utan dubblering.
Förändrat kontoval omedelbart före commit gav 409 och rullade tillbaka både
workspace och audit. +/-1 öre i uppdelningssumman, halva ören och motsatt riktning
avvisades. Node-försöken hade uttryckligen verifierade bank-/fakturaoriginal och
giltigt ägarkonto; positiv singelkontroll gav 201/400 och en allokering.

## Körbara oberoende prov

- scripts/review-multiple-invoice-paths.mjs
- scripts/lib/multiple-invoice-review-cases.mjs

~~~sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/review-multiple-invoice-paths.mjs --source-root /path/to/reviewed/checkout
~~~

Utelämnad source-root använder repositoryt där harnessfilen finns. --case sites,
--case node och --case contract kan köras separat. Harness läser befintliga
fixtureuppsättningar, provar riktiga moduler och routes, skriver endast syntetiska
temporära SQLite-data och avvisar externa fetch. Node HTTP går till loopback.
Sites ersätter identitet/kontoresursavkodning; Node använder befintlig syntetisk
krypterad kontofixtur. PDF-bytes här är verifierade lagringsoriginal, inte ett
nytt OCR/PDF-renderingstest. Fixturegränser som ändras ger uttryckligt fel.

Källcommit, runtime och SHA-256 för de centrala modulerna skrivs ut. Dessa filer
kontrolleras även efter körningen. TAP-resultat omfattar 10 + 3 + 2 prov. De ska
inte läggas ihop med överlappande produktionssviter eller tidigare acceptansfall.

## Designkrav för den nya sammanhängande vägen

Betalningsspåret föreslår ett separat manuellt vektorgodkännande för 2–20 rader,
utan nya bankbarn och utan ändrad C4-/enfakturapolicy. Granskningen kräver att
hela vektorn binds till ägare/företag, original, konto, medgivande och revision;
allokeringar, audit och beständigt idempotenskvitto ska sparas i samma transaktion.

Designen avgränsades före implementation för Nodes befintliga UNIQUE-par
(faktura, bankpost): operationen ska antingen förbruka hela bankens tillgängliga
belopp eller lösa samtliga refererade fakturors hela återstående skuld. Att
samtidigt lämna bankrest och fakturarest avvisas, liksom ett redan allokerat par.
Ingen generell top-up-/justeringsväg utlovas.

Fullständig referenstäckning betyder alla relevanta bevarade bankreferenser och
exakt en fakturaägare per referens i hela företagets census, även stängda eller
konfliktbärande original. Man får inte filtrera bort originalets motbevis per
allokeringsrad. Under-/överbetalning får vara ett uttryckligt granskat manuellt
val med synliga faktura- och betalningsrester; ändring efter godkänt quote avvisas.
En generell tillåtelse att exekvera REVIEW eller försvagad referenceCorrection
är inte denna operation.

Ett förlorat svar ska lösas med det exakta ägarbundna kvittot. Replay återger
historisk framgång utan att skriva igen, även om gamla saldon eller medgivande
därefter ändrats; aktuell ägarbehörighet gäller fortfarande. Oläsbart kvitto
lämnar utfallet okänt. Metadatafäktning i D1 är inte i sig ett atomärt löfte om
R2-bytes: faktisk originalversion/oföränderlighet måste bindas där den finns,
och den återstående gränsen ska anges.

## Negativ matris inför oberoende kodgranskning

Matrisen beskriver beteendekrav, inte en godkänd implementation. Positiva fall
måste ha fullständiga giltiga syntetiska original och medgivanden. Negativa fall
jämför beständiga saldon, allokeringar, audit, kvitto och original före/efter.

| ID | Scenario | Krävt utfall |
|---|---|---|
| P1/P2 | Två/tre explicit styrkta fakturor, ojämna heltalsören enligt ovan | Alla avsedda allokeringar skrivs exakt en gång i ett godkänt atomärt resultat. |
| P3 | Annan ordning på samma godkända vektor | Deterministisk identitet; ingen extra allokeringsmöjlighet. |
| A1 | Annan ägare, annat företag, främmande faktura eller bankpost | Avslag före ekonomisk skrivning; inget läckage eller korsvis kvitto. |
| A2 | Membership/roll/företagskontext ändras efter review eller före commit | Färsk auktoritet krävs; samtliga nya skrivningar rullas tillbaka. |
| A3 | Konto avvalt/bytt, generation/session ersatt, consent expired/revoked | Avslag även i sista commit-fönstret; inget halvt resultat. |
| O1 | Saknat eller ändrat bankoriginal, fel hash eller ägarbindning | Avslag för hela vektorn. |
| O2 | En fakturas original saknas, byts eller motsäger registrerad referens | Avslag för hela vektorn; inga godkända övriga delrader. |
| O3 | Saknad/manuell betalare, ofullständiga referenser, ogiltig OCR, källkonflikt | Får inte bli bankbevis genom manuellt vektorgodkännande. |
| R1 | Ledande nollor, separator eller delsträng skiljer sig | Exakt avsedd referens krävs; inga normaliserade gissningar. |
| R2 | Två fakturor inom samma företag äger samma referens, även stängd, annan kund eller konfliktbärande faktura | Avslag; ingen automatisk ägarselektion. Andra företags register ska inte blandas in i censust. |
| R3 | En bankreferens eller refererad faktura lämnas utanför vektorn | Ingen tillåten delmängd genom att filtrera bort originalets motbevis. |
| R4 | En faktura/delrad förekommer två gånger | Avslag; ingen dubbel fördelning. |
| M1 | +/-1 öre ändrat efter quote eller över giltigt tillgängligt saldo | Avslag för hela den gamla godkända vektorn. |
| M2 | Uttryckligt granskad under-/överbetalning | Exakta synliga rester bevaras; positiv delrad för varje refererad faktura och ingen överfördelning. |
| M3 | Halvören, noll, negativt, NaN/Infinity, sträng, osäkert/stort heltal | Avslag före någon beständig skrivning. |
| M4 | Saldo ändras genom kredit, återtag eller annan betalning | Gammalt godkännande avvisas; ingen implicit ny vektor. |
| M5 | Icke-ekonomisk rapport, parent+child eller samma original genom två källor | Ingen extra ekonomisk post eller dubbelräkning. |
| M6 | Vektorn lämnar både bankrest och någon fakturarest, eller använder redan allokerat par | Avslag enligt uttrycklig minimiavgränsning; inget löfte om fortsatt top-up. |
| V1 | Revision/hash ändrad efter review; gammalt eller utgånget godkännande | Avslag; användaren måste se nytt underlag. |
| V2 | Belopp/ID/original/owner ändras i klientens submit | Avslag även med samma request-id; klienten kan inte ändra godkänd vektor. |
| C1 | Samma request-id och vektor samtidigt/efter omstart | Högst ett nytt ekonomiskt resultat; beständigt replay svarar entydigt. |
| C2 | Samma request-id, annan vektor eller annan ägare | Idempotenskonflikt; aldrig återanvändning av någon annans godkännande. |
| C3 | Olika request-id för samma bankbelopp eller konkurrerande fakturasaldo | Högst en giltig commit; förloraren lämnar inga delrader/audit. |
| F1 | Fel efter första/andra allokeringen men före audit/kvitto/commit | Hela den nya operationen rullas tillbaka. |
| F2 | Audit- eller kvittoskrivning misslyckas | Inga nya allokeringar; kvittot får inte vara separat från pengarna. |
| F3 | Commit lyckas men svaret försvinner | Replay ger det lagrade resultatet utan ny allokering. |
| F4 | Samma förlorade svar och kvittot kan inte läsas | Utfallet anges okänt; inga falska påståenden om framgång/rollback eller påhittad failed-audit. |
| F5 | Revocation/lease-/kontextbyte precis före commit | Atomärt avslag; tidigare fristående historik bevaras. |
| S1 | Anrop utan det nya uttryckliga godkännandet eller från automation | Ingen vektorskrivning; C4 och vanlig matchning behåller sina gränser. |
| S2 | Ändring av enbart presentation eller omläsning | Noll ekonomiska skrivningar. |

Oberoende kodgranskning av den nya operationen återstår. Ingen rad i matrisen ska
rapporteras godkänd förrän den faktiskt reproducerats mot den levererade koden.
Fulla integrerade grindar och verklig produktionsacceptans ligger utanför rapporten.
