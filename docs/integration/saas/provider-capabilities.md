# Open Payments: verifierade API-krav och gränser för SaaS-användning

Granskat: 2026-11-04. Underlaget består av Open Payments officiella dokumentation och publicerade villkor. Det beskriver leverantörens publicerade kontrakt för API:et, inte att funktionerna är aktiverade för M.George eller att en viss bank levererar ett visst underlag. Inga kundspecifika avtal eller produktionsbehörigheter har granskats. Inga autentiseringsuppgifter har tillhandahållits och inga anrop mot en riktig sandbox eller produktionsbank har körts.

## 1. Miljöer, OAuth och transport

### Miljöer

| Miljö | API-bas | OAuth-bas |
| --- | --- | --- |
| Sandbox | `https://api.sandbox.openbankingplatform.com` | `https://oauth.sandbox.openbankingplatform.com` |
| Produktion | `https://api.openbankingplatform.com` | `https://auth.openbankingplatform.com` |

Guiderna använder produktionsadresser; sandbox använder motsvarande sandbox-värdar. `X-Request-ID` är ett nytt UUID för spårning av anrop. Publicerade resursvägar använder `/v1/`. De granskade sidorna etablerar inget gemensamt versionshuvud som ska läggas till utöver dessa vägar. [S3]

### Appens åtkomsttoken

`POST /connect/token` tar `application/x-www-form-urlencoded` med `client_id`, `client_secret`, `grant_type=client_credentials` och blankstegsseparerad `scope`. Svaret innehåller `access_token`, `expires_in` (exemplet anger 3600), `token_type=Bearer` och `scope`. Dokumentationen anger en timmes livslängd, högst en aktiv token per kontext och högst två tokenutgivningar per timme. Någon refresh-tokenprocess beskrivs inte på denna sida. [S1]

| Scope | Dokumenterad funktion |
| --- | --- |
| `accountinformation` | Kontoinformation |
| `bankgiroinformation` tillsammans med `accountinformation` | ISO-baserad transaktionsberikning från svenska Bankgirot |
| `corporate` | Företagskontext |
| `private` | Privatpersonskontext |
| `aspspinformation` | Bankinformation i produktion |

För företagskonton med Bankgiroberikning är den dokumenterade kombinationen alltså `accountinformation bankgiroinformation corporate`. Scope-strängen bevisar inte att produkten eller varje konto är kommersiellt aktiverat. [S1]

### Produktionscertifikat och signering

Open Payments anger att **alla produktionsanrop till API:et kräver ett klientcertifikat**, unikt för organisationen. Produktionsåtkomst föregås av företagsuppgifter och godkännande; certifikatet tillgängliggörs därefter. Applikationens valda produkter styr åtkomst, och redirect-URI:er registreras för applikationen. [S2]

Detta ger stöd för en transport med mTLS. **Ytterligare HTTP-signering med exempelvis `Signature` eller `Digest` har inte verifierats i de granskade officiella sidorna.** Lägg därför inte till ett egenkonstruerat signeringsprotokoll. Detta är en avgränsning av det verifierade underlaget, inte ett bevis för att ingen annan produkt eller bilateral överenskommelse någonsin kräver signering. Betalningssignering och SCA är andra delar av protokollet. [S2][S3]

## 2. AIS, Bankgiroinformation och ISO-underlag

AIS-guiden visar följande vägar:

| Funktion | Väg |
| --- | --- |
| Skapa samtycke | `POST /psd2/consent/v1/consents` |
| Konton | `GET /psd2/accountinformation/v1/accounts` |
| Kontodetaljer | `GET /psd2/accountinformation/v1/accounts/{accountId}` |
| Saldon | `GET /psd2/accountinformation/v1/accounts/{accountId}/balances` |
| Transaktioner | `GET /psd2/accountinformation/v1/accounts/{accountId}/transactions` |

**Bankgiroberikningen presenteras i AIS-flödet, via samma transaktionsresurs och `Consent-ID`.** Guiden visar ingen separat BGI-samtyckesresurs. Transaktionssvaret skiljer på `booked[]`, `pending[]` och `bankgiro[]`. Dessa källor behöver bevaras åtskilda; förekomst i en berikningslista innebär inte i sig en ny bokförd bankhändelse. Det senare är en rekommendation för konsumentens datamodell. [S5]

Kontosvaret beskriver `bankgiroNumber`, `paymentsEnabled`, `lastTransactionEnrichmentDateTime` och `lastTransactionEnrichmentDateTimeUtc`. Guiden anger daglig ISO-hämtning; berikningens tidsstämpel behövs därför för att bedöma aktualitet. Transaktioner kan filtreras med `bookingStatus`, `dateFrom` och `dateTo`; följ den returnerade länken `_links.next` för fortsättning. Bygg inte en egen sidnumrering. [S5]

### Vad samtycket inte fastställer

Ett giltigt AIS-samtycke och begärda scopes fastställer inte att kundens ISO-källa, Bankgirotflöde eller varje bankkonto har anslutits. De granskade sidorna ger ingen komplett, kundoberoende procedur som bevisar att sådan onboarding är klar. Följande behöver därför verifieras separat i kundens produktåtkomst och överenskommelse: ISO/BGI-tjänst, berörda juridiska personer, banker/konton, rapportleverans och eventuell särskild beställning.

Changelog för november 2025 beskriver en **ISO-fallback efter utgånget PSD2-samtycke för användare som uttryckligen väljer detta**. Då omfattas konton som ingick i samtycket. Det är inte ett generellt tillstånd att fortsätta hämta genom ett utgånget samtycke. Funktionen måste vara tillämplig och aktiverad innan den används. [S11]

## 3. Företagsidentifiering och samtyckesauktorisering

Consent-API:et kräver bland annat `X-Request-ID`, `X-Bic-Fi`, `PSU-ID`, `TPP-Redirect-Preferred`, `PSU-IP-Address` och `PSU-User-Agent`. **`PSU-Corporate-ID` är obligatoriskt med företagskontext**; dokumentationen nämner svenskt organisationsnummer och nederländskt KVK-nummer. `PSU-Corporate-ID-Type` behövs när banken kräver det. `X-Affiliated-ASPSP-ID` kan identifiera en ansluten bank/filial. [S6]

Samtyckeskroppen innehåller `access`, `recurringIndicator`, `frequencyPerDay`, `validUntil` och `combinedServiceIndicator`. `access` kan ange konton eller ett tomt objekt för det dokumenterade allkontoflödet. `frequencyPerDay` är minst ett och högst fyra utan bilateral överenskommelse mellan TPP och ASPSP; engångssamtycke använder ett. Banken kan begränsa giltigheten. Ett nytt återkommande samtycke ersätter det tidigare när det auktoriseras. [S6]

Det granskade `X-Consent-Type`-fältet anger `sepaDirectDebit`; det ger inget stöd för ett påhittat värde `bankgiro`. Samtyckets status behöver hanteras separat från auktoriseringens status. [S6]

### Redirect och decoupled

För ett samtycke är resursbasen `/psd2/consent/v1/consents/{consentId}`. Starta auktorisering med `POST {resursbas}/authorisations`. Svaret ger `authorisationId`, `scaMethods` och `scaStatus`. Välj en returnerad metod med `PUT {resursbas}/authorisations/{authorisationId}` och `{"authenticationMethodId":"<returnerat metod-ID>"}`. Följ svarets `aspsp-sca-approach`, som anger `REDIRECT` eller `DECOUPLED`. [S7]

| SCA-sätt | Dokumenterat nästa steg |
| --- | --- |
| Redirect | Använd `_links.scaOAuth`, fyll klient-ID, registrerad redirect-URI och eget bundet `state`. |
| Decoupled | Använd returnerad `challengeData`; BankID kan ge autostarttoken. Läs status via `_links.scaStatus.href`. |

Efter redirect innehåller callbacken `code`, `scope` och `state`. Guiden kräver separat aktivering med `grant_type=authorization_code` mot tokenendpointen, exakt redirect-URI och föreskrivna resurs-/auktoriseringshuvuden. Aktiveringens token kastas; den vanliga app-token används vidare. Callbacken ensam bevisar inte slutförd SCA. Kontrollera `finalised` respektive `failed`. QR-flödet har tidskänslig polling; guiden anger 500–1000 ms och QR-giltighet på en sekund. [S7]

## 4. Banklista, kapabiliteter och faktisk täckning

| Anrop | Returnerade uppgifter enligt API-referensen |
| --- | --- |
| `GET /psd2/aspspinformation/v1/aspsps` | `aspsps[]` med `bicFi`, `name`, `logoUrl`; filtret `isoCountryCodes` accepterar kommaseparerade landskoder. |
| `GET /psd2/aspspinformation/v1/aspsps/{bicFi}` | Bland annat `supportedAuthorizationMethods`, `affiliatedAspsps`, `globalPaymentProducts`, `accountInformation`, `paymentInitiation`. |
| `GET /psd2/aspspinformation/v1/countries` | Länder som bankinformationstjänsten exponerar. |

Auktoriseringsmetoder har `name` och `uri`; anslutna ASPSP-poster har `id` och `name`. [S8]

AIS-schemat beskriver `transactionHistoryMaxDays`, `extendedTransactionHistoryMaxDays`, `extendedTransactionHistoryAvailableWindowMinutes` och `transactionHistoryMaxCount`. PIS-schemat har exempelvis `signingBasketsSupported` och `signingBasketLimit`. Dessa betalningsfält beskriver inte HTTP-signering. Något uttryckligt allmänt booleskt fält för företagskonto- eller BGI-täckning har inte identifierats i de granskade schemana. [S9]

Den publicerade banksidan beskriver banktäckning som föränderlig. En bank i listan, en logotyp eller en fungerande privatkontointegration är därför inte tillräckligt underlag för ett löfte om företagskonto, visst kontoslag, BGI eller en viss historiklängd. Verifiera målbankens aktuella detaljsvar och det aktuella kundkontots stöd. [S10]

## 5. Sandbox och verifieringsnivå

Sandbox kräver en registrerad applikation och dess egna autentiseringsuppgifter. Bankinformationstjänsten använder **`accountinformation` i sandbox**, medan produktion använder `aspspinformation`. Dokumentationen tillåter normalt valfria PSU-/företagsidentifierare och publicerar följande särskilda testidentiteter. [S4]

| PSU-ID | Dokumenterat scenario |
| --- | --- |
| `99990101001` | Saknade samtyckesrättigheter: `PSU_RIGHTS_MISSING` |
| `99990101002` | Betalning kräver ytterligare PSU: `AUTHORISATION_PENDING_API` |
| `99990101003` | Samtycke kräver ytterligare PSU |
| `99990101004` | Utgången autentisering: `AUTHENTICATION_SESSION_EXPIRED` |
| `99990101005` | BankID inte aktiverat: `BANKID_NOT_ACTIVATED` |

Detta dokument innehåller ingen rapport om genomförda sandboxtester. Lokala fixtures kan verifiera hur klienten hanterar publicerade kontrakt; en separat körning med riktiga sandboxuppgifter behövs för integrationen. Sandbox fastställer inte produktionsbankens funktioner, kundens ISO-leverans eller avtalsrättigheter. [S4]

## 6. Publicerade villkor och kundens SaaS-avtal

De publicerade villkoren anger att villkor och orderform tillsammans utgör avtalet. De beskriver kundgodkännande/KYC och kundens skyldighet att ha nödvändiga tillstånd. Villkoren behandlar uttryckligen tjänster till externa PSU:er, inklusive att dessa ska informeras om Open Payments och om uppgifter som lämnas till kunden. Licensen är bland annat icke-exklusiv, icke-överlåtbar och återkallelig samt förenad med avgifter och efterlevnadskrav. [S12]

Detta visar att externa slutanvändare förekommer i den publicerade avtalsmodellen. **Det bevisar inte att M.Georges specifika avtal omfattar en SaaS-tjänst med flera kundföretag, white-label, återförsäljning eller ISO/BGI för dessa företag.** Kundens signerade orderform, produktbilagor och eventuella bankkrav har inte granskats. Villkorens begränsningar av kopiering/licensiering av Open Payments material bör inte omtolkas till ett generellt förbud mot all SaaS utan avtalsanalys. [S12]

## Officiella källor

- [S1 — Get access token](https://docs.openpayments.io/docs/get_access_token)
- [S2 — Get started](https://docs.openpayments.io/docs/getstarted)
- [S3 — API och miljöer](https://docs.openpayments.io/docs/api)
- [S4 — Sandbox](https://docs.openpayments.io/docs/sandbox)
- [S5 — Consent and AIS](https://docs.openpayments.io/docs/consent_and_ais)
- [S6 — Consent Service API](https://docs.openpayments.io/api/consent-service)
- [S7 — Authorisations](https://docs.openpayments.io/docs/authorisations)
- [S8 — ASPSP Information Service API](https://docs.openpayments.io/api/aspsp-information-service)
- [S9 — API-scheman](https://docs.openpayments.io/api/~schemas)
- [S10 — Banks](https://docs.openpayments.io/docs/banks)
- [S11 — Changelog november 2025: ISO fallback](https://docs.openpayments.io/docs/changelog/2025-11)
- [S12 — Terms & Conditions for Open Payments Products](https://docs.openpayments.io/legal/Terms%20&%20Conditions.pdf)
