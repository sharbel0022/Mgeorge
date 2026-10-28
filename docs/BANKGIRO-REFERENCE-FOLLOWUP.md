# OCR och fakturanummer – uppföljning 2026-10-28

Användarens skärmbild visade att den faktiska 625-kronorsposten fortfarande saknade OCR och fakturanummer. Version 24 hade infört import men inte fyllt dataluckan för den befintliga bankposten.

## Verklig kontroll

Swedbanks sparade CSV visar 625 kr den 26 oktober och texten 58197013. Samma text återkommer på många andra insättningar och är företagets Bankgiro 5819-7013, inte ett kund-OCR. Den får inte användas som fakturanummer.

Bankintegrationen använde bara kontots transaktionslista. Version 25 lade till Enable Bankings dokumenterade detalj-API. Kontot, den stabila bankreferensen, bokföringsdatumet, beloppet, valutan och riktningen kontrolleras mot en ny lista innan aktuellt tillfälligt transaction_id används. Bankens svar sparas som ägarskyddat original i R2 och kontrollen loggas. Ursprungliga bankfält, samlingsstatus, allokeringar och fakturasaldon ändras inte.

Den autentiserade produktionskontrollen av just 625-kronorsposten visade att Swedbank inte lämnar ytterligare individuella uppgifter via den befintliga anslutningen. Detaljkontrollen sparades utan någon betalningsbokning. Ett verkligt OCR 0599 kan därför inte hämtas från detta bank-API för den posten.

## Faktura 0599 finns i Gmail-underlagen

Den befintliga kön innehåller redan en PDF-faktura med den efterfrågade referensen, samma belopp och ett tidigare fakturadatum. Den ligger för granskning och är inte registrerad som en bekräftad betald faktura. Kundens faktiska uppgifter visas endast i den privata arbetsytan och kopieras inte till denna källkodsrapport.

Den tidigare referenssökningen läste `fields.invoice_number` som en sträng. Den verkliga tolkningen använder `fields.invoice_number.value`. Det gjorde att sökningen missade redan hämtade fakturanummer. Detta är rättat för både nuvarande och äldre fältformat, med bevarade inledande nollor.

En ny skrivskyddad kandidatsökning visar möjliga fakturanummer från registrerade fakturor och hämtade Gmail-original. Förslag kräver rätt riktning, samma belopp och ett fakturadatum senast på betalningsdagen. Exakt tillgänglig betalningsreferens prioriteras. Redan betalda, avvisade och makulerade fakturor återintroduceras inte via sina dokument. Flera kandidater hålls isär.

I banklistans kolumn Faktura/OCR visas exempelvis **Förslag: 0599**, och betalningsdetaljen visar **Fakturanummer · förslag: 0599 · behöver bekräftas**. Kunden anges som kund på den möjliga fakturan. Kunden görs inte automatiskt till verifierad betalare. Bankens OCR-fält förblir saknat när banken inte har lämnat det. Granska faktura 0599 öppnar det verkliga Gmail-originalet.

## Säkerhet och verifiering

Sites **version 26** är publicerad i samma befintliga projekt. Källcommit: `bfe08dc667c839697634735a6eb988e0814905e3`. Deployment: `appgdep_6ae1f219be908191b15822ed92d17159`, status `succeeded`.

Den autentiserade produktionsvyn verifierades efter omladdning. Den riktiga 625-kronorsposten den 26 oktober visar nu Förslag: 0599 i listan och Fakturanummer · förslag: 0599 · behöver bekräftas i detaljen. En länk öppnar det redan hämtade originalet för granskning. Den saknade bank-OCR:n visas separat. Ingen faktura markerades betald och ingen betalning registrerades av kandidatsökningen.

Lokalt bildbevis: `.codex-work/bankgiro-0599-production.png`. Bilden innehåller produktionsuppgifter och ingår inte i GitHub-repositoryt.

- Kandidater är ett separat läsresultat och blir aldrig betalningsbevis eller allokeringar.
- 0594 om 4 375 kr föreslås inte för 625-kronorsposten.
- API:erna kontrollerar användaridentitet och ägare. Detaljhämtningen kräver rätt origin, valt företagskonto och befintligt bankmedgivande; inga klientstyrda konto- eller ägar-ID:n accepteras.
- Inga scheman återaktiveras och inga kundmejl skickas.
- 228 Sites-tester passerar, inklusive 19 nya tester för detalj-API, verkligt inbäddade extraktionsfält, osäkra fakturaförslag, ägaråtkomst och bevarade betalningsoriginal. TypeScript är godkänt och produktionsbygget verifieras vid paketering.

Fullständig verifiering av vem som faktiskt betalade och vilken referens som användes kräver fortfarande Bankgiros individuella betalningsspecifikation. Ett lika belopp eller ett fakturaförslag räcker inte för att markera fakturan som betald.

Dokumenterad detaljtjänst: https://enablebanking.com/docs/api/reference/#get-transaction-details.
