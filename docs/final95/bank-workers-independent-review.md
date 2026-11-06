# Oberoende granskning av Sites mTLS-koppling

Datum:2026-11-06. Granskare: bank-recovery-delagenten, som inte implementerade Sites-transporten.

Granskade commits är `b924aa30d5eb0a22d7974f2a93720d72df751d02` och `cad3b8f5ad8530aa12cf9636e3350d783d154fb6`. Läsningen omfattade nya transporten och deklarationerna, `saas-runtime.ts`, `openpayments-account-state.ts`, `openpayments-company-sync.ts`, tillhörande transport-/runtimeassertions och den officiella Workers-dokumentationen. Inga Sites-produktfiler ändrades av granskaren.

**Resultat: inga materiella fel hittades i denna avgränsade Sites-koppling.** Detta är ett oberoende kod-/kontraktsreview, inte ett eget produktions- eller Cloudflare-certifikatprov. Root ansvarar för den slutligt integrerade kodens test-, typ-, bygg- och releasekvitton.

| Granskningspunkt | Bedömning |
| --- | --- |
| Saknad eller felaktig konfiguration | Avstängd/sandbox/saknad mTLS-config kan inte opta in produktion. Fel generation, certifikat, fingerprint, binding eller metadata avvisas; ingen vanlig fetch-fallback finns. |
| Faktisk bindning | En serverägd binding med egen fetch-funktion krävs. Produktionen skriver över en caller-supplied transport. Publik certifikatmetadata kan inte introspektera Cloudflares uppladdade certificateId; verklig matchning är tydligt en deploymentgate. |
| Certifikat och rotation | X.509-tider och SHA256 kommer från faktiska publika certifikatbytes. Rå provider-/mTLS-konfiguration, bindingobjekt och fetch-funktion pinnas. Ändring före headers, under väntan och vid body-läsning spärrar resultat. |
| Cacheidentitet | WeakMaps kopplar en opak identitet till aktuell verifierad binding/config. Byte, malformed metadata, disable, saknad config och expiry pensionerar tidigare identitet permanent. Tokens lagras i den avgränsade shared-cachen, inte i dessa metadataobjekt. |
| Tillåtna anrop | Två fasta production HTTPS-origins, begränsade konto-/consent-/metadata-/tokenroutes, headerallowlist och manuella redirects. Betalningsroutes, främmande origin, Host-override, encodade paths och caller-supplied cf-resolveOverride släpps inte fram. |
| Deadline och cancel | Shared HTTP-klienten behåller deadline och bytegräns. Bindingseamen avbryter oberoende om fetch ignorerar AbortSignal, annullerar sent inkomna response bodies och avbryter pending body-läsning. |
| Synk och lagrad status | Certifikatets sista giltighet begränsar resolved sync-context och account-state. Gamla transportclosures kontrolleras även när ny konfiguration har samma stringhash. Företags-/medgivande-/arbetsyterevision och DB-fence behålls. |
| Typat optionskontrakt | Senaste kopplingen använder samma `OpenPaymentsOptions.applicationTokenCache: {identity}` som shared provider och Node. Varje operation behåller sin egen requestBoundary. |
| Testernas räckvidd | Granskade assertions täcker stale headers/body, abort, felbinding,1/10/100 faktiska isolerade Sites-företagsrequests, en app-token, korsbolagsnekande och oförändrad saas_bank_state vid discovery. Bindingsvar är syntetiska; detta är inte ett verkligt TLS-/bankprov. |

Officiella källor kontrollerades2026-11-06:

- [Workers mTLS](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/) beskriver faktisk certifikat-/nyckeluppladdning och binding.fetch. Den dokumenterade begränsningen för Cloudflare-proxied origin/520 kvarstår som driftskontroll.
- [Wrangler certificates](https://developers.cloudflare.com/workers/wrangler/commands/certificates/) visar UUID-formade certificateId och certifikat-/nyckelfiler som separata uppladdningsargument.
- [Workers node:crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) anger stöd för node:crypto-API:er med uttryckliga undantag; X.509 är inte bland undantagen. Den befintliga runtime-kompatibiliteten ska ändå verifieras av build/workerd-grinden.
- [Workers node:https](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/) kan inte ersätta mTLS-binding med vanliga cert/key/CA-optioner.

Den motsatta oberoende granskningen av shared-tokenkoden hittade sen401- och app-wide429-problem. De gäller shared tokenstate, inte Sites-bindingen, och rättas i `7fd5af2764ef3387341758601eea2ff45a5d0a18`. De får inte utelämnas vid integration.
