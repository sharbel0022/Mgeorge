# Betalare, OCR och Swedbanks rapportkanaler

Kontrollerat **2026-11-01** mot primärkällor. Kodinventeringens bas är `9d456563a15e9681d8500a0e09f3ef32314c67b1`. Företagets rapportavtal, avtalade MIG/XSD, godkänd automatisk transport och autentiskt individuellt bankoriginal är fortfarande inte verifierade. Den tidigare användarbekräftelsen att avtals- och rapportuppgifter saknas finns i [V4-SWEDBANK-CHANNELS.md](V4-SWEDBANK-CHANNELS.md). En offentlig produktbeskrivning bevisar inte företagets tillgång.

## Tre skilda informationskällor

| Källa | Vad den kan lämna | Begränsning |
| --- | --- | --- |
| Befintlig AIS-transaktionslista | Kontots bokförda händelser och de frivilliga betalar-/referensfält banken faktiskt skickar. | Bankgirobetalningar kan vara en enda samlingsinsättning utan individuella betalare. |
| AIS-detalj-API | Ytterligare uppgifter om samma bankhändelse, när banken tillhandahåller ett tillfälligt `transaction_id`. | Skapar ingen individuell rapportbehörighet och är inget löfte om uppdelning av en samlingspost. |
| Inbetalningar bankgiro | Elektronisk individuell redovisning i ISO 20022/XML; tillgängliga betalaruppgifter och flera OCR-referenser kan ingå. | Fälten måste finnas i det verkliga originalet. Tjänst, format och transport behöver bekräftas för företaget. |

Enable Banking beskriver uttryckligen Bankgirots samlade bokföring. `entry_reference` identifierar en post tillsammans med kontot; `transaction_id` används för detaljhämtning och kan ändras. Bakgrundshämtning ska sakna PSU-headers. Många banker begränsar sådan hämtning till fyra gånger per dygn; leverantören rekommenderar sex timmars väntan efter den spärren. [Enable Banking FAQ](https://enablebanking.com/docs/faq/).

Swedbanks tjänst beskriver namn, adress och organisationsnummer som tillgänglig betalarinformation samt möjlighet till flera OCR-referenser i samma betalning. Detta är produktens möjlighet, inte garanterad fälttäckning för en viss betalning. [Inbetalningar bankgiro](https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html).

## Fälttyper får inte byta betydelse

Enable Bankings `SEBG` betyder svensk Bankgiro-OCR. `SEPG` finns inte i den publicerade uppräkningen och behandlas därför som okänt schema. `reference_number` är annars en strukturerad betalningsreferens, inte automatiskt OCR. Partens frivilliga `organisation_id` har identifierare, schema och eventuell utfärdare. `COID` avser organisationsidentifiering från nationell myndighet; `CUST`, `BANK`, `TXID`, `BGNR` och `PGNR` avser andra identifieringsslag. Dessa ger inte i sig ett verifierat svenskt organisationsnummer. [Enable Banking API-schema](https://enablebanking.com/docs/api/reference/).

ISO-fältet `AnyBIC` är organisationens åtta eller elva tecken långa ISO 9362-kod. Det är inte ett svenskt organisationsnummer. `OrgId/Othr` kan förekomma flera gånger och innehåller identifierare med valfritt schema och utfärdare; alla värden behöver bevaras med sin typ. Källa: [ISO:s Cash Management-definitioner, tryckta sidor 397–398](https://www.iso20022.org/sites/default/files/2020-12/ISO20022_MDRPart2_CashManagement_2020_2021_v1_ForSEGReview.pdf#page=397). Dokumentet är ett ISO-granskningsunderlag och används här för identifierarnas betydelse, inte som företagets avtalade Swedbank-MIG.

## OCR-kontroll och avtal

Bankgirots regler skiljer mellan mjuk och hård checksifferkontroll, variabel längdsiffra och fast längd. Variabel kontroll jämför näst sista siffran med hela referensens längd modulo tio. Fast kontroll tillåter en eller två avtalade längder. OCR är numeriskt, med 2–25 siffror och modulus-10-kontrollsiffra sist. Vid mjuk kontroll kan banken acceptera ett annat referensbegrepp efter varning. Företagets bankavtal avgör vilken regel som gäller. [Bankgirots OCR-referenskontroll](https://www.bankgirot.se/tjanster/inbetalningar/bankgiro-inbetalningar/ocr-referenskontroll/).

Den lokala funktionen `validateOcrAgreement(value, agreement)` kontrollerar endast uttryckligen tillförda logiska regler. Avsaknad av avtal eller ogiltig konfiguration ger `status: unknown`. Ett lokalt `valid` bevisar varken ett verkligt avtal eller att en betalning har accepterats av banken. Den valfria kontrollen aktiverar ingen automatisk fakturamatchning och inga företagsregler har gissats.

Referensextraktorn klassificerar API-schemat `SEBG` samt uttryckliga XML-typer `OCR`/`SEOCR` som OCR. Generisk `SCOR` förblir strukturerad referens. Varje kandidat bevarar källsökväg, exakt ursprungligt fältvärde i `rawValue`, tolkat värde och typ. För en etikett i ett meddelande bevaras hela meddelandet i `rawValue`, medan `value` innehåller den extraherade referensen. Ett ogiltigt uttryckligt OCR ger den befintliga avstämningsmotorn ett granskningshinder; samma nummer som fakturan räcker inte för automatisk bokning.

## Format och automatisk leverans

Swedbanks index listar `camt.054.001.02` Credit under både MIG 1.0 och 2.0, standard `camt.053.001.02` och separat Envelope för direktintegration. Namespace ensamt identifierar därför inte avtalad MIG. Credit-, kontoutdrags- och Envelope-PDF:erna gav åter HTTP 403 i researchverktyget. Deras fullständiga profilregler har inte verifierats; felet bevisar inte att företaget saknar dokumentåtkomst. [Swedbanks MIG-index](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html).

Swedbank skiljer också standard `camt.053`, utökad `camt.053 E` och `camt.054` i integrationsutbudet. Utökad rapporttäckning får inte härledas från standardkontoutdrag eller AIS. [ERP-integration](https://www.swedbank.se/foretag/betala-och-ta-betalt/bankintegration-med-affarssystem.html).

Internetbanken kan användas för behörig filhämtning. Direktintegration använder SFTP; tredjepartsintegration använder en part som har integration med banken. Bankens säkerhetslösning och leveransprodukt behöver avtalas. [Anslutning Företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html).

Innan automatisk rapporthämtning kan aktiveras behövs:

1. Bekräftad rapporttjänst för rätt företag, Bankgiro och mottagarkonto.
2. Exakt rapportprodukt, ISO-version, MIG-utgåva, XSD och eventuellt Envelope/signatur-/krypteringskrav.
3. Bankgodkänd läsande kanal med endpoint, kund-/avtalsidentitet, rättigheter, serveridentitet och skyddat installerade nycklar.
4. Leveranstid, pollinggräns, återleverans, retention, unikhetsregler och eventuell kvittens.
5. Godkänt anonymiserat strukturellt original och jämförelse mot rätt samlingspost, med kontroll av konto, datum, referens, valuta, individuella belopp och total.
6. Företagets OCR-kontrollnivå och eventuella längder.

Den generiska XML-läsaren är inte en XSD- eller Swedbank-MIG-validator. Syntetiska parserprov får inte beskrivas som verifiering av företagets rapportprofil. Ingen ny automatisk rapportkanal aktiveras av dessa kodändringar.

## Verifiering av referensändringen

Nio dedikerade regressioner per motor skrevs och observerades fallera före respektive rättelse. Därefter passerade de tillsammans med befintliga referenstester: **26 Node-tester och 25 Sites-tester**. Testerna använder endast syntetiska data och omfattar bland annat felaktig SEBG-OCR som tidigare kunde matcha ett fakturanummer, återkommande XML-referenser med verkliga fältsökvägar, oförändrade originalmeddelanden, okända scheman och explicita längdregler. Fullständig slutverifiering redovisas i uppdragets leveransrapport när hela ändringen har frysts.

Referensversionen är `payment-references-2026-11-01.1`. Tidigare sparade härledningar får inte automatiskt upphöjas till den nya versionens bevis. Kompatibilitetskontroll behöver jämföra tidigare faktiska referensfakta och hålla nytillkommen OCR-konflikt eller ofullständig tolkning för granskning; byte av version får inte ändra tidigare ekonomiska original eller allokeringar.
