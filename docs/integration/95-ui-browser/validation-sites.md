# Slutlig Sites-verifiering

Produktkod `495de1166292cc141030cac7803f03a5f055d646`, integrerad bas `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`. Körningen omfattar även sista rättningarna för utkast, företagsval, inloggningsstatus och kontrast. **333 app-, komponent-, stil-, test- och paketindata hade identiska SHA256-värden före och efter hela körningen.** Inga produktfiler ändrades under verifieringen.

| Grind | Kommando | Resultat | Tid |
| --- | --- | --- | ---: |
| Typkontroll | `npm run check` | godkänd | 5,93 s |
| Produktion | `npm run build` | godkänt | 21,37 s |
| Hela Sites-sviten | `NODE_ENV=test CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false npm run test:isolated` | **3 888/3 888**, 0 fail/skip/cancel/TODO | 439,18 s |
| Audit | `npm audit --audit-level=high --json` | high-grind godkänd; **8 moderate, 0 high/critical** | separat läsning |
| Befintlig backport | `node scripts/minimatch-backport.mjs --check` | 1 mål, 0 skrivningar, verifierad | separat kontroll |

[Maskinläsbart kvitto och logghashar](validation-sites.json). Lokal runtime: Linux x86_64, Node 24.22.1, npm 11.9.0. PR-CI:s Node 22-resultat ska läsas separat på den faktiska head-versionen. [Root/bridge](validation-root-bridge.md) har 1 997 respektive 47 godkända tester. Tillsammans ger de tre fulla sviterna **5 932 godkända**; harnessens åtta fixture-/HTTP-tester redovisas separat.

## Försök och begränsningar

Den första tidigare Sites-helkörningen hade ett filnivåfel i `mcp-evidence-read.test.mjs` utan registrerat påståendefel; riktad omkörning gav 34/34. Efterföljande fulla körningar blev gröna, inklusive denna slutkörning. Det ursprungliga misslyckandet räknas inte som godkänd verifiering.

Lokala försök med ren Sites-`install:ci`/`npm ci` avslutades med exit 137. Befintliga låsta beroenden färdigställdes via lokal cache; en ofullständig lucide-installation reparerades från lockfilens exakta tarball/integritet. `npm ls --depth=0`, typer, backportkontroll och bygge passerade. Inga paket- eller lockfiler ändrades av denna UI-leverans. Detta är **inte ett påstående om lyckad ren lokal Sites-installation**; den rena installationsgrinden ska verifieras av PR-CI. Root och bridge hade lyckade låsta installationer tidigare i sessionen.

De åtta moderate-fynden finns i befintliga Sites-utvecklingsberoenden och har inte lösts genom ett obestyrkt paketbyte. Ingen high/critical-fyndbild döljs och inga beroendeförändringar ingår här.
