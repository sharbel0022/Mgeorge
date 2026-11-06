# Färsk kontroll av leverantörskontrakt

Kontrollerat 2026-11-06 cirka 14:30 UTC av integrationsansvarig. Detta kompletterar [bankrapportens](bank.md) tidigare versionslåsta research. Dokumentationen ger inget bevis för att användarens avtal, certifikat, kontobehörighet eller SCA är aktiverade.

| Officiell källa | Aktuellt observerat kontrakt | Konsekvens för kandidaten |
| --- | --- | --- |
| [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) | Auktorisationsflödet återför code/state; sessionen ger tillgängliga konton. Kontofältet usage är valfritt, med ORGA/PRIV som definierade värden. Transaktionssidor använder continuation_key. | Saknad usage bevisar varken privatkonto eller rätt företagsbehörighet. Den får inte uppfinnas. Callback-, konto- och sidgränser ska bevaras. |
| [Open Payments access tokens](https://docs.openpayments.io/docs/get_access_token), sidan daterad 2026-10-15 | OAuth client credentials; API-scopes kombineras med corporate/private. bankgiroinformation kompletterar accountinformation. Leverantören anger en aktiv token per PSU-kontext. | Kandidatens delade applikationstokenkoordinator och kombinerade företagsscopes behövs; token är inte kundmedgivande. |
| [Open Payments get started](https://docs.openpayments.io/docs/getstarted), sidan daterad 2026-10-15 | Produktionsåtkomst behöver godkännas. API-anrop i produktion använder organisationsbundet klientcertifikat; appen har produktval och godkända returadresser. | Faktisk produktåtkomst, certifikat/binding och callbackregistrering är externa aktiveringskrav. Inga hemligheter skapades eller ändrades här. |
| [Open Payments consents](https://docs.openpayments.io/docs/create_consent), sidan daterad 2026-10-15 | Företagsmedgivande skiljer PSU-ID och PSU-Corporate-ID; användaren måste auktorisera medgivandet innan användning, därefter kontrolleras dess status. | En lyckad applikationstoken eller syntetisk SCA-testsekvens räcker inte som verklig företagsacceptans. |
| [Swedbank Anslutning Företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html) | Avtal och val av överföringskanal krävs; direktintegration beskrivs som SFTP mellan kundens system och banken. | Bryggans lokala acceptans kan inte aktivera bankens leverans eller ersätta kundavtal. |
| [Swedbank MIG](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) | Separata 1.0-/2.0-profiler och Swedbank Envelope. Nyhetsnotis 2026-08-07 anger uppdaterad camt.054C/Envelope. | Kundens faktiska MIG/XSD/Envelope-version och bankoriginal behöver verifieras innan källan kan accepteras. |

De officiellt länkade PDF:erna för **MIG 2.0 camt.054 Credit** och **Swedbank Envelope** gav båda HTTP 403 även vid denna nya kontroll. Deras innehåll är inte påstått verifierat. Ingen annan kanal användes för att kringgå åtkomsten.

Sökning efter PKCE i den lästa Enable Banking API-referensen gav ingen träff. Detta är ingen generell bevisning om leverantörens alla möjligheter. Adapterkontraktets faktiska stöd och bankens SCA ska redovisas separat; det finns inget nytt verifierat PKCE-anspråk.

Detta var läsning av publik dokumentation. Inga leverantörsanrop med produktionscredentials, bankmedgivanden, banktransaktioner eller ekonomiska skrivningar ingick.
