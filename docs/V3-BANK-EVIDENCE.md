# V3: individuellt bankunderlag och verifiering

Granskad 28 oktober 2026. Arbetet utgår från `main` på `73e0777` och beaktar UI-PR [#9](https://github.com/sharbel0022/Mgeorge/pull/9). PR:n är en liten textändring i banklistan; den tillför inget nytt bankunderlag. V3 bygger vidare på befintliga importer, arbetsyta, ägaråtkomst och scheman.

## Rätt källa för Swedbank

Swedbanks **Inbetalningar bankgiro** erbjuder individuell elektronisk redovisning i ISO 20022 XML och betalningsdetaljer i internetbanken. Banken anger att tillgängliga betalaruppgifter kan omfatta namn, adress och organisationsnummer samt flera OCR-referenser per betalning. Ett fält är känt först när det finns i företagets verkliga underlag. [Swedbanks tjänstebeskrivning](https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html).

Aktuella MIG-sidan listar camt.054.001.02 Credit Notification och camt.053.001.02 Account Statement samt separata versioner av bankens guider. Parsern läser både standard- och prefixnamnrymder och rätt direkta XML-sökvägar; den utför begränsade struktur- och verksamhetskontroller, inte fullständig XSD-/MIG-validering. Andra ISO-versioners motsvarande fält läses när samma struktur finns. Bankens aktuella Credit-MIG-PDF gick inte att läsa automatiskt (HTTP 403). Exakt kompatibilitet med företagets filversion måste därför verifieras med ett riktigt anonymiserat original. [Swedbanks MIG- och schemaindex](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html).

Internetbankens nya **Inbetalningar** ersätter ELIN; historisk och ny redovisning kan under övergången ligga på olika ställen. Swedbank uppger att stöd för tidigare Bankgiroformat upphörde den 1 september 2026. Bg Max är därmed en historisk datakälla, inte valt framtida hämtningsformat. Repositoryt har ingen Bg Max-parser; historiska original behöver exporteras/konverteras till en granskad CSV eller hanteras manuellt. [Swedbanks information om övergången](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige.html).

Swedbank dokumenterar automatisk bankintegration med ISO-filer via SFTP och API-kopplingar. Detta innebär **inte** att MG Fakturakolls befintliga PSD2-medgivande ger tillgång till dessa rapporter. Automatisk hämtning av individuella filer är **externt blockerad tills företagets avtal, kommunikationskanal, tekniska behörighet och leverantörsåtkomst har bekräftats**. Ingen sådan filkanal eller nya bankbetalningsfunktioner aktiveras här. Fungerande alternativ är export från bankens behöriga kanal och import av original XML/CSV i samma app. [Swedbanks bankintegration](https://www.swedbank.se/foretag/betala-och-ta-betalt/bankintegration-med-affarssystem.html).

Enable Banking erbjuder `debtor`/`creditor`, konton, `reference_number`, referensschema och `remittance_information`, samt ett separat detaljanrop när banken lämnar `transaction_id`. Dessa fält är valfria. `entry_reference` är stabil per konto och används för idempotens; detalj-ID är inte stabilt och får inte identifiera en ekonomisk post. Att API:t har en fältdefinition bevisar inte att Swedbank levererar individuella Bankgirobetalningar genom just denna anslutning. Samlingsposter utan sådant underlag förblir spärrade. [Enable Bankings API-referens](https://enablebanking.com/docs/api/reference/).

## Ändringar i verifieringen

- Förhandsgranskning av camt och återläsning av sparade Bankgirooriginal använder samma begränsade parser. Utländska/odeklarerade namnrymder kan inte utge sig för att vara ISO-fält. Endast poster under rätt rapport och direkta `NtryDtls/TxDtls` läses som betalningar.
- Samlingspostens konto, bokföringsdatum, bankidentifierare, valuta och totalsumma måste stämma med hela barnuppsättningen. Ofullständiga eller tvetydiga filer ligger kvar för granskning. Originalposten bevaras och räknas ekonomiskt bara en gång.
- Individuell betalare, organisationsidentitet, maskerat betalarkonto, ostrukturerat meddelande och samtliga referenskällor bevaras. Bankens referens, mottagarens Bankgiro, betalarens Bankgiro och fakturareferenser hålls åtskilda.
- Separata strukturerade referenser och fakturanummer kan stödja samma faktura utan att ett sammanfogat textfält skapar en falsk konflikt. Konkurrerande ostrukturerade referenser bevaras också för konfliktkontroll; ett första `Ustrd` får aldrig tysta senare referenser. Motstridiga referenser stoppar automatiken. Nollor i `0599` och `000018` bevaras.
- En uttrycklig `OCR`/`SE OCR`-typ kontrolleras med modulus 10. Ett numeriskt fakturanummer eller en ospecificerad strukturerad referens blir inte därmed OCR. Företagets avtalade OCR-längdregel är ännu inte verifierad; ingen sådan regel gissas. En egen Bankgiroreferens spärrar automatisk matchning även om den av misstag lagrats som OCR på fakturan.
- Originalets storlek och SHA-256 kontrolleras mot dokumentregistret före import. Ägaråtkomst, transaktionslås/revision och revisionshändelser behålls. Manipulerat original, parallella bekräftelser och återimport ger ingen dubbel betalning.
- En redan sparad individuell specifikation som väntar på sin samlingspost omprövas automatiskt vid avstämning. Grupp-ID, ursprungligt antal och ursprunglig totalsumma sparas vid originalimporten. Hela gruppen måste finnas kvar oförändrad och redo: en undantagen, saknad eller dubblettspärrad delpost blockerar gruppen. Äldre importer utan denna metadata behöver importera originalet igen. Gruppen släpps endast när samma exakta länkregler lyckas; beslutet sparar original-ID, hash, barn-ID:n och regelversion. Identitets- och referenskontroller för fakturakopplingen körs därefter separat.
- Vanliga camt.053-poster utan individuella detaljer, till exempel kortköp eller lön, blir inte automatiskt samlingsbetalningar. Klassificering för saknad Bankgirospecifikation gäller de poster som faktiskt känns igen som samlings-/Bankgiroinbetalningar.

Regelversionen är `verified-reference-2026-10-28.3`. Bankändringarna är additiva i befintlig JSON-arbetsyta; inga fakturor, betalningar, anslutningar eller original raderas.

## Regressioner mot masterpromptens 15 scenarier

Alla data är syntetiska. Befintliga tester behålls och utökas.

| Scenario | Testfil och verifierad spärr/effekt |
| --- | --- |
| 1. Samlingsinsättning 625 kr och förslag 0599 utan bank-OCR | `bankgiro.test.mjs`, `payment-references.test.mjs`: aggregat kan inte automatallokeras |
| 2. Entydig individuell betalning | `bankgiro.test.mjs`: exakt referens, betalare och länkat original reglerar fakturan en gång |
| 3. Samma belopp, flera kunder | `bankgiro.test.mjs`, `payment-references.test.mjs`: belopp skapar inget betalningsbevis |
| 4. Flera kundbetalningar i en insättning | `bankgiro.test.mjs`: komplett barnsumma ersätter föräldern ekonomiskt |
| 5. En betalning, flera fakturor | `domain.test.mjs`, Node `reconciliation.test.js`: fördelning för manuell granskning |
| 6. Inledande nollor | `bankgiro.test.mjs`, `payment-references.test.mjs`: exakt sträng och separat OCR-kontroll |
| 7. Motstridiga referenser | `bankgiro.test.mjs`, `payment-references.test.mjs`: inga allokeringar |
| 8. Betalare annan än kund | `bankgiro.test.mjs`, `customer-messages.test.mjs`: särskild kontroll; verifierade relationer testas i Node |
| 9. Delbetalning | `bankgiro.test.mjs`: återstående heltalsöre och överskott bevaras |
| 10. Samma fil två gånger | `bankgiro.test.mjs`, `bankgiro-api.test.mjs`: en betalning och bevarad historik |
| 11. Fel konto eller total | `bankgiro.test.mjs`: underlag spärras, förälderns ekonomi bevaras |
| 12. API saknar detaljer | `bank-details.test.mjs`: ingen påhittad identitet eller OCR |
| 13. Felaktig/stor/skadlig XML | `bankgiro.test.mjs`, `bankgiro-api.test.mjs`: DTD, struktur, namnrymd, storlek, förfalskat original stoppas |
| 14. Referensen är eget Bankgiro | `bankgiro.test.mjs` och båda `payment-references`-sviterna: ingen automatallokering |
| 15. Senare specifikation/insättning | `bankgiro.test.mjs`: omprövning är idempotent och fel konto/total spärrar |

API-tester kontrollerar dessutom fel ägare, utgången session, fel origin, konkurrerande skrivningar och att originalet återläses i stället för webbläsarens ändrade rader. Slutliga totalantal, bygge och gränssnittsbilder redovisas i V3-leveransrapporten.

## Före produktionspublicering

Verifiera en anonymiserad Swedbank-specifikation från företagets aktuella tjänst: namespace/MIG-version, eventuell bank-envelope, kontosamband, datum, individuella och sammanlagda belopp, identiteter och referensschema. Stäm av OCR-kontrollnivå/längd mot bankavtalet. Bekräfta avtalad automatisk rapportkanal innan filhämtning byggs eller aktiveras. Ett riktigt bankflöde och Bg Max är **inte verifierade** av dessa syntetiska tester. Befintliga bank-/Gmail-/backupjobb ska kontrolleras i sin nuvarande driftmiljö utan att dupliceras.
