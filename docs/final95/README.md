# MG Fakturakoll — slutlig integration och releasegrindar

Uppdaterad: 2026-11-06 22:59:55 UTC. **Beslut tills vidare: NOT APPROVED för den begärda 9,5-releasen. Målet 314/330 är inte styrkt.**

## Verifierad bas

Main är `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`, rottree `c1912a91e44ecaca7095dcaca1201c3904df87d7`, Sites-tree `c2feb372a4c0ef121ffe594784684957c14ddac1`. Publicerad produkt är **Site 69**, native commit `1df8cb96eda374f2506c81aa776263388ddb666a`, lyckad driftsättning, miljörevision 10. Ingen ny produktversion har publicerats av detta integrationsarbete.

## Leveranser och granskning

Den första inventeringen 22:45 UTC föregick publiceringen av de fem nya grenarna. Alla finns nu. Den tidigare observationen ligger kvar i Git-historiken; den ska inte läsas som aktuell frånvaro.

| Agent | PR | Gren | Aktuell integrationsstatus |
| --- | --- | --- | --- |
| 1 | [64](https://github.com/sharbel0022/Mgeorge/pull/64) | `feature/95-openai-invoices` | Testfall/plan; produktimplementation ännu inte granskad |
| 2 | [67](https://github.com/sharbel0022/Mgeorge/pull/67) | `feature/95-document-automation` | Klientprotokoll publicerat; server och full acceptans pågår |
| 3 | [65](https://github.com/sharbel0022/Mgeorge/pull/65) | `feature/95-bank-recovery` | Kodgranskning och CI pågår |
| 4 | [68](https://github.com/sharbel0022/Mgeorge/pull/68) | `feature/95-bankgiro-reconciliation` | Testfall/plan; produktimplementation ännu inte granskad |
| 5 | [66](https://github.com/sharbel0022/Mgeorge/pull/66) | `feature/95-saas-readiness` | Kodgranskning och CI pågår |

**Ingen av dessa fem PR:er är ännu integrerad.** Alla nio äldre 95-grenar är redan förfäder till main. Historiska PR61 och PR62 ligger redan i main/Site69 och räknas inte som nya integrationer. [Exakta SHA, beroenden och granskningsdimensioner](integration-matrix.json).

Integrationsordning: gemensam säkerhet/företagsisolering → Gmail/OCR-kö → OpenAI → bank → Bankgiro/avstämning → full SaaS-acceptans. Särskilt granskas originalens SHA-256, worker lease/run/kvitto, aktuellt medgivande, mottagare/källbehörighet, kostnadsreservation och återställning utan återaktivering av gamla behörigheter.

## Färsk normal CI på oförändrad produktbas

[Ordinarie kvalitetskörning 42307160013](https://github.com/sharbel0022/Mgeorge/actions/runs/42307160013) är klar och godkänd. Head `70d2f74c1aa8f1a994658d0cd6cc7c573be72e7d`; GitHubs testade PR-checkout `30ad8ecfb56c98371ff7bc8e34495b9f1f0f73cf`. Endast fem dokument skilde detta head från main.

| Grind | Färskt resultat |
| --- | --- |
| Node 22.23.4 | 3 012/3 012; inga fel, avbrott, överhopp eller TODO |
| Node 24.22.1 | 3 012/3 012; inga fel, avbrott, överhopp eller TODO |
| Sites | 5 820/5 820; verifierade installationer, typer, audits och produktionsbygge godkända |
| Bankgiro SFTP bridge | 47/47; installation, syntax och audits godkända |
| Chromium | Syntetisk acceptans godkänd; detaljkvittot finns i CI-artifakten |
| 1/10/100 företag | Syntetisk korrekthet/prestanda godkänd; latensdetaljer finns i CI-artifakten |
| Separat säkerhetsacceptans | [42307159929](https://github.com/sharbel0022/Mgeorge/actions/runs/42307159929): 377 Node + 1 225 Sites; överlappar fullsviterna |

[Råa resultat sammanfattade med artefakternas SHA-256 och storlekar](ci-baseline-fresh.json). Dessa körningar verifierar basprodukten; de godkänner inte nya agentändringar som ännu inte ingår.

Den separata workflowen `final95-recovery.yml` kör samma befintliga återställningsmotor med **430 syntetiska original / 185 567 855 byte**, isolerad SQLite, temporära nycklar och nätverksspärr för testprocessen. Den kör på varje PR/main-kandidat, behåller exakt checkout och rått återställningskvitto samt avvisar förändrad källkod. Första körningens resultat är ännu inte känt i detta dokumentationscommit. Detta är ett syntetiskt återställningsprov, aldrig produktionsåterställning.

### Bevarade fel och verifieringsbegränsningar

Det nya lokala Node-försöket passerade syntax/audits men fick optiska workerfel, en fil med SIGKILL och slutligen exit 137. Kvittot blev ofullständigt och miljön blev otillgänglig. Grundorsaken är inte fastställd. De nya rena CI-resultaten är ytterligare belägg; de raderar inte det avbrutna försöket. [Avbrottsrecord](local-interruption.json).

Ny visuell produktionskontroll blockerades av browseranslutningen. En direkt läsning av arbetsytans databastabell trunkerade dess stora payload; den kan därför **inte** styrka fullständigt oförändrade fakturor, bankhändelser och allokeringar. [Begränsning för ekonomisk före/efter-kontroll](financial-comparison-limit.json). Inga produktionsskrivningar har utförts av integrationsagenten.

## Produktionsobservationer

- Gmail är anslutet: 427 granskningsdokument, 47 väntar på OCR, 4 på PDF; 66 accepterade dokument i terminalt jobbstatus under föregående 24 timmar. Köstatus vid observationen: 0 aktiva, 0 utgångna leases, 0 uttömda försök, 0 fel.
- Schemalagd moln-OCR [42304814299](https://github.com/sharbel0022/Mgeorge/actions/runs/42304814299), exact main ovan, avslutades 22:29 UTC med 6 behandlade och 0 fel. Detta styrker den körningen, inte OCR-precision eller jämn 15-minuterstakt.
- Gmails separata externa schemadispatch är fortfarande obekräftad. Automationens `no_update` räcker varken som lyckat anrop eller bevis på uteblivet anrop.
- Swedbank: `connected=false`, `reauth_required`, `BANK_RECONNECT_REQUIRED`, `syncAllowed=false`. Inget bankanrop gjordes av denna granskning.
- Bankgiro: `DISABLED / SOURCE_NOT_CONFIGURED`, auktorisation `UNKNOWN`, inga intagsjobb. Ingen behörighet eller beviskedja har fabricerats.
- Senast verifierad riktig backup: 430/430 original, 185 567 855 byte, `manifest_pass` kl. 00:48:58.086 UTC. Senare importer ingår inte i detta frysta manifest.
- Miljörevision 10 har 18 konfigurerade nyckelnamn. Hemliga värden maskeras av verktyget; null är inte belägg för saknad hemlighet. Inga OpenAI- eller SaaS Open Payments-nyckelnamn finns i denna observation.

[Sanerad produktionsobservation](production-observation.json). OpenAI-modellåtkomst, livebenchmark och ny oberoende optisk acceptans är ännu inte verifierade. Tidigare dokumenterad poäng **258,5/330 = 7,83/10** höjs inte av enbart fler tester.

## Kvarvarande releasegrindar

1. Granska och integrera färdiga Agent 1–5-leveranser på exakta SHA; testförst-commits är inte färdiga leveranser.
2. Kör samtliga suites, säkerhet, migrationsprov, backup/restore, Chromium, 1/10/100 företag, AI/OCR-mätningar och driftscenarier på fryst slutversion.
3. Verifiera ordinarie PR-CI och därefter ordinarie main-CI för rätt mergad commit.
4. Säkerställ aktuell backup, verifierbar rollback, GitHub/native-källparitet och tillgänglig publiceringsmiljö.
5. Kontrollera publicerad API/UI och ekonomiska invariants; redovisa verklig bank/Bankgiro separat.
6. Slutför alla 33 kriterier med historiska och nya kod-, test- och produktionsbevis samt kvarstående risk.

Saknat bankavtal/medgivande är en extern blockerare. Ofärdiga agentleveranser, AI/OCR-kvalitet, schemabevis och verifieringsmiljö är egna grindar och får inte döljas bakom bankstatusen.
