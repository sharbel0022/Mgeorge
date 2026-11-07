# Implementationsrapport: säker grenstädning

## Leverans och avgränsning

Implementationscommit: `091e5ceaab3c5c636c6a0ba1c029dffafdb26885`. Efterföljande dokumentationscommit: `ec1791fc4569a49327d325f84a8b279f49f414aa`. Den senare ändrar enbart `docs/operations/branch-cleanup.md` till svenska; kodexempel, kontrakt och teknisk omfattning är bevarade. Arbetsgren: `branchwork/cleanup-release`, arbetskopia: `/workspace/scratch/2236a42849dc/worktrees/release-tools`.

Implementationen omfattar endast `scripts/release/branch-cleanup.mjs`, `test/branch-cleanup.test.js`, `.github/workflows/branch-cleanup.yml` och driftinstruktionen. Inga beroenden har tillkommit.

Skriptet har torrkörning som standard. Verkställande kräver både `--execute`, manifestets `execute: true` och rätt Actions-repository/händelse/körningsgren. Exakta SHA:n, PR:ernas käll- och målgrenar, uttryckligt frånvarande grenskydd, historik och aktiva undantag kontrolleras. Alla kandidater arkiveras med beständiga fjärrtaggar innan en bundle verifieras genom en oberoende återställning och strikt fsck. Kontrollerna upprepas före varje radering, som använder en exakt SHA-spärr. `main`, känt avbrutet SaaS-arbete och körningsgrenen behålls.

## RED/GREEN

| Steg | Kommando | Observerat resultat |
|---|---|---|
| Initial RED | `node --test --test-name-pattern='dry run leaves' test/branch-cleanup.test.js` | 0/1, exit 1: implementationen saknades. |
| Beteende-RED | `node --test --test-name-pattern='another branch cannot' test/branch-cleanup.test.js` | 0/1, exit 1: fel grenidentitet i API-svaret medgav radering i den isolerade fixturen. |
| Slutlig GREEN | `node --test test/branch-cleanup.test.js` | **27/27**, exit 0, inga fail/cancel/skip/TODO, 3 777,771994 ms. |
| Syntax | `node --check scripts/release/branch-cleanup.mjs` | Exit 0. |
| Diff | `git diff --cached --check` | Exit 0. |
| Arbetsflöde | YAML-tolkning och villkorskontroll | Exakt pushgren och behörigheterna `contents: write`/`pull-requests: read` verifierade. |

Rättningen efter beteende-RED kräver att API-svarets grenidentitet motsvarar den efterfrågade grenen. Testerna omfattar även farliga namn, main/aktiva/körande grenar, öppna PR:er på båda sidor, skydd som är aktiva eller okända, flyttad main/gren, ny PR mellan raderingar, avvisad arkivskrivning, nekad API-åtkomst, saknat/avstängt manifest och en verklig konflikt med SHA-spärren efter sista läsningen.

**Loggsökväg:** `/workspace/scratch/2236a42849dc/Mgeorge/.superpowers/sdd/2026-11-07-cleanup/release-verification.log`. Loggen är ett sparat utdrag av redan observerade verktygsutdata, inte en ny testkörning. Den innehåller de två RED-resultaten, alla 27 GREEN-testnamn och totalsummorna. Verifieringen gäller implementationen i `091e5ceaab3c5c636c6a0ba1c029dffafdb26885`; dokumentationsöversättningen ändrar inga kod- eller testfiler och testerna kördes inte om enligt uppdraget.

## Kvarstående gränser

Ingen bred projektsvit har körts av denna agent. Ingen GitHub-gren har skickats eller raderats, inget Actions-arbetsflöde har startats och ingen produktion har berörts. Testernas Git-skrivningar skedde enbart i tillfälliga lokala repositoryn med syntetiska commits. Oberoende kodgranskning och slutlig CI för den sammanförda kandidaten hanteras av samordnaren. Aktuella fjärrreferenser och medarbetares aktivitet måste fortfarande verifieras vid den verkliga städningen; tom PR-lista bevisar inte inaktivitet.
