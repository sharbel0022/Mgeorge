# Oberoende metodkontroll av giltigt SEK-blindprov

**PASS för metod, aritmetik och den sparade källbindningen. Kvalitetsmålet 85 % recall tillsammans med 98 % precision är inte uppnått.** Detta kvitto dokumenterar den redan genomförda läsande granskningen den 6 november 2026. Ingen ny utvärdering kördes när kvittot skrevs.

## Omräknat förstautfall

Värdena nedan räknades oberoende i Python från sparade parserutfall mot det frysta facitets normaliseringsregler. De gäller **separat för både Node och Sites**.

| Population | Dokument | TP | FP | FN | Nämnare | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Normal, primär | 12 | 62 | 0 | 46 | 108 | 57,4074 % |
| Normal, svenska | 6 | 34 | 0 | 20 | 54 | 62,9630 % |
| Normal, engelska | 6 | 28 | 0 | 26 | 54 | 51,8519 % |
| Completed-only, diagnostik | 12 | 62 | 0 | 46 | 108 | 57,4074 % |
| Stress, separat | 2 | 10 | 0 | 8 | 18 | 55,5556 % |

Samtliga fall-, fält- och populationssummor stämmer. Normalfälten har 4 korrekta fakturanummer, 2 motparter, 8 organisationsnummer, 6 utställningsdatum, 6 förfallodatum, 12 totalbelopp, 12 nettobelopp, 0 momsbelopp och 12 valuta. Varje fält har tolv förväntade värden och noll FP.

Normalfallen har **0/12 fullständiga dokument, 8 röda, 4 gula och 0 gröna**. Stress har 0/2 fullständiga och två röda. Riktning är separat metadata: 12/12 normal och 2/2 stress. Den ingår inte i de nio bildfälten. Alla workers slutfördes; completed-only exkluderar därför inget dokument.

## Kontrollmetod och grundbindning

Granskaren läste protokoll, mätkod, generator, manifest, köranspråk, sparade observationer och parserresultat. Ingen produktmodul importerades eller kördes. Kontrollen verifierade:

- **19 frysta filhashar**, både på disk och i preregistreringscommit, samt **54 leveranshashar**.
- Tidsordningen freeze → preregistreringscommit → köranspråk → resultat.
- Produktbytes mot godkänd `f5d178ea816d276457685fbc0421cf144f7cf655`, registrerade modellhashar och identisk lockfil för återanvänd installation.
- **84 sparade logghändelser:** 14 sekventiella workerförsök, 14 Node- och 14 Sites-parseranrop. Bildhasharna matchar observationernas inputhashar. Alla workers rapporterar `ocr`, utan worker-/parserfel.
- Giltigt organisationsnummerformat och Luhn, tredje siffra minst 2, SEK, exakt heltalsaritmetik med 25 % moms och 30 dagars datumintervall för samtliga 14 goldposter.
- Sex svenska och sex engelska normaldokument, med två dokument per layout och språk. Node/Sites-utdata skiljer endast i `extracted_at`.

Exekverad preregistreringscommit var `cb83472359927adadf99cb50b54f9e9aeaded19a`, med oförändrade produktbytes mot godkänd källa. Freeze skedde `2026-11-06T15:43:21.883995+00:00`, köranspråket `15:43:30.523Z` och resultatet avslutades `15:44:12.622Z`.

| Artefakt | SHA-256 |
| --- | --- |
| `freeze.json` | `0fd6c4de10ad0b4e8c883b727aa9c3a5a5a7a2a9d272957cee11469b9cb44758` |
| `first-results.json` | `241a8ef5cce3cc956dd2771e75b11602e5ebccbf25e9b0418331eba6805885a4` |
| `REPORT.md` | `e92ba18a7c6492432b385f99bc83020e392a9a044709cc5492bad58d4c1f55e2` |

## Förbehåll

**14 optiska observationer används av 28 parseranrop.** Motorerna ger ingen dubblerad oberoende population. De tre syntetiska layoutfamiljerna, en mottagare och en momssats begränsar generalisering. Observerad precision **62/62** avser lämnade obligatoriska värden; den visar inte att 98 % precision gäller i produktion. **0 falskgröna med 0 gröna** ger ingen uppskattning av precision bland gröna dokument.

Organisationsnumren är kontrollerade för syntax och checksumma, inte registrering. Granskaren verifierade bildhashar och generator/facit men gjorde ingen ny visuell läsbarhetscertifiering. Författarens ursprungliga bildgranskning och uppgift om blindhet är separat attribuerade; sparade artefakter bevisar inte frånvaro av all eventuell oregistrerad aktivitet.

Det första äldre oberoende provet bevaras separat. Skillnaden mellan kohorter visar inte att workerfixen orsakade ändrade fel eller ändrad recall. Detta kvitto ändrar ingen poäng, produkt, korpus eller ursprungligt resultat. **Noll optiska anrop, produktparseranrop och produktionsanrop gjordes av denna metodgranskning.**

Källor: [protokoll](../quality8/independent-supported-20261106/protocol.md), [första resultat](../quality8/independent-supported-20261106/first-results.json), [utvärderarens rapport](../quality8/independent-supported-20261106/REPORT.md), [freeze](../quality8/independent-supported-20261106/freeze.json), [köranspråk](../quality8/independent-supported-20261106/run-claim.json) och [fullständigt metodkvitto](supported-ocr-independent-review.json).
