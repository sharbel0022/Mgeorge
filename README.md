# MG Fakturakoll – M.George Vitvaror AB

**Körbar, fristående källkodsversion** av ett faktura- och bankavstämningssystem. Hanterar kund- och leverantörsfakturor, bankhändelser, CSV/camt-import, manuell betalningsmatchning samt läsanslutning till Swedbank via Enable Banking (AIS).

> **Viktig versionsinformation:** Det här är en **nyimplementerad källkodsversion** baserad på det tidigare arbetets funktioner, inte en byte-för-byte-export av den publicerade ChatGPT Sites-versionen. Den publicerade webbplatsen på [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/) kör fortfarande sin egen kod och databas. Ingen kund- eller bankdata har exporterats till GitHub, och ändringar i GitHub publiceras **inte automatiskt** på ChatGPT Sites.

## Kom igång lokalt

Kräver **Node.js 22.13+** (använder inbyggda `node:sqlite`). Inga externa npm-paket krävs.

```bash
git clone https://github.com/sharbel0022/Mgeorge.git
cd Mgeorge
cp .env.example .env
# Ändra .env och välj långt, unikt administratörslösenord samt slumpade nycklar.
# Nycklar (64 hextecken vardera): node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node --env-file=.env src/server.js
```

Öppna `http://localhost:3000`. Logga in med `MG_ADMIN_PASSWORD` från `.env`.

`NODE_ENV=test npm test` kör automatiska tester med tillfällig databas. `npm run check` syntaxkontrollerar koden.

## Anslut Swedbank för att läsa bankhändelser

1. Skapa en app i [Enable Banking Control Panel](https://enablebanking.com/cp/applications), välj lästjänsten **AIS** och rätt miljö. För riktiga bankkonton krävs produktionsåtkomst och eventuella avtal.
2. Registrera exakt din returadress i appen: `https://din-domän.se/api/bank/callback` utan queryparametrar. För localhost krävs en separat lokalt åtkomlig redirect som tillåts av leverantören.
3. På **servern**: ange `ENABLEBANKING_APP_ID` och `ENABLEBANKING_PRIVATE_KEY_FILE` i `.env`. PEM-filen ska finnas **utanför projektets Git-katalog**. Ange även en riktig `https://`-adress i `APP_ORIGIN` vid publik drift.
4. Starta om, öppna **Bankanslutning → Koppla Swedbank**, godkänn hos banken med BankID och hämta sedan bokförda händelser för ett valt konto och datumintervall.

**Endast läsning:** Inga betalnings- eller överföringsfunktioner är implementerade. Banker kan begränsa datumintervall och åtkomst. Bankgiro som visas som en totalsumma behöver ibland en separat camt.054-/betalningsspecifikation för att kunna identifiera betalare.

## Viktiga säkerhetsregler

- **Repositoryt är offentligt.** Committa aldrig `.env`, PEM/RSA-nycklar, åtkomsttoken, kundregister, fakturor, bankutdrag eller lokala SQLite-filer.
- Koden använder scrypt-lösenordshash, serverstyrda HttpOnly-sessioner, origin-kontroll på skrivningar, CSP, AES-256-GCM för bankens sessionsuppgifter och revisionslogg.
- Använd **HTTPS**, en säker miljö för hemligheter, skyddad databas, säkerhetskopior och åtkomstkontroll innan produktion. Kör säkerhetsgranskning och integritet-/GDPR-bedömning.
- Bekräfta OCR/betalare manuellt. Beloppslikhet ensam innebär **inte** att en faktura är betald.
- Testa mot Enable Banking Sandbox innan riktig bankåtkomst. Leverantörens API och bankens stöd behöver verifieras i just din konfiguration.
- Automatisk Gmail-synk, OCR/PDF-extraktion, multi-user arbetsytor, schemalagd bankhämtning och produktionsdrift är **inte** färdigimplementerade här.

## Projektstruktur

```
public/             Webbgränssnitt (HTML, CSS, JavaScript)
src/server.js       HTTP API, behörighet och fakturaflöden
src/db.js           SQLite-schema, transaktioner och matchning
src/importers.js    CSV och camt.053/.054-import
src/bank.js         Enable Banking AIS-integrationsadapter
src/security.js     Lösenord, cookies och kryptering
test/               Automatiska enhetstester
docs/               Systembeskrivning och överlämning
```

## Föreslagen nästa fas

Migrera den faktiska kodbasen från ChatGPT Sites med en auktoriserad export eller arkiv av källkoden och jämför skillnader med denna nyimplementering. Därefter konfigureras hosting, riktig bankintegration, medgivanden och datamigrering utan att exponera affärsdata i GitHub.
