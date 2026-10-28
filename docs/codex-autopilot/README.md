# Codex 24h – säker lokal förbättringsloop för Mgeorge

Detta är en **körbar styrprocess**, inte en påbörjad bakgrundskörning. Den kör fristående `codex exec`-iterationer i upp till 24 timmar, med hård tidsgräns per iteration, oberoende tester, sparad status och stopp vid fel. Den ändrar **enbart en separat lokal Git-gren**. Ingen push, PR, merge eller Sites-publicering görs automatiskt. Processen kan avslutas tidigare när arbetet bedöms färdigt, testerna är gröna vid upprepade iterationer eller den fastnar. En grön testsvit ger **inte** ett bevis på en felfri produkt eller att ett verkligt OCR finns i bankens uppgifter.

## Innan du börjar

Använd en **helt ny, isolerad klon på en separat Windows-användare, VM eller container** utan anslutna banker, Gmail, Sites, MCP-kopplingar, produktionsnycklar eller kundfiler. Kör inte detta i produktionsserverns mapp. Isolering av hosten är nödvändig: Codex sandbox och filtrerade miljövariabler skyddar inte mot alla lokala sidoeffekter när projektets egna testkommandon körs. Använd en begränsad Codex-identitet utan externa verktyg. Håll maskinen igång, med internet till Codex-API och npm audit. En sovande/stängd dator stoppar processen. Codex användningsgränser och eventuella kostnader gäller.

Krav: **Python 3.10+**, **Node.js 22.13+**, npm, Git och installerad/inloggad [Codex CLI](https://developers.openai.com/codex/quickstart/). Testerna använder endast syntetiska fixtures. Installation av beroenden är en separat, avsiktlig åtgärd med internet innan den obemannade körningen.

### Windows PowerShell

```powershell
git clone https://github.com/sharbel0022/Mgeorge.git Mgeorge-autopilot
cd Mgeorge-autopilot
npm ci --ignore-scripts
Push-Location sites
npm run install:ci
Pop-Location
npm install -g @openai/codex
codex login
py -3 scripts/codex_24h.py --dry-run
py -3 scripts/codex_24h.py --hours 24 --max-rounds 48 --round-minutes 40
```

### Linux/macOS

```bash
git clone https://github.com/sharbel0022/Mgeorge.git Mgeorge-autopilot
cd Mgeorge-autopilot
npm ci --ignore-scripts
(cd sites && npm run install:ci)
npm install -g @openai/codex
codex login
python3 scripts/codex_24h.py --dry-run
python3 scripts/codex_24h.py --hours 24 --max-rounds 48 --round-minutes 40
```

**Om installationen görs innan denna ändring har mergats till main**, checka först ut grenen med autopilot-filerna. Kontrollera `git status` är rent. Körningen skapar automatiskt grenen `codex/autopilot-YYYYMMDD-HHMMSS` och börjar med en baslinjemätning. Den accepterar inte en checkout med `.env`, `.dev.vars`, `.pem`, SQLite, `data/`, `private/`, `uploads/` eller `secrets/`. Spara därför aldrig företagets material i klonen.

## Vad sker under en körning?

1. Kontroll av rätt GitHub-repo, ren klon, icke-produktionsmiljö och verktyg. Orkestreraren vägrar fortsätta om känsliga filer finns eller om skyddade filer ändras.
2. Baslinje: `git diff --check`; Node syntax/test/audit; Sites TypeScript/test/audit/build. Resultaten, även eventuella fel, sparas.
3. En Codex-iteration får undersöka, förbättra och lägga till regressionstester i sin begränsade sandbox (`workspace-write`, ingen interaktiv höjning av rättigheter).
4. Samma oberoende kontroller körs igen. Testräknaren får inte minska jämfört med baslinjen, och överhoppade test stoppar grönt resultat.
5. Upprepa vid fel och kvarvarande arbete. Försök igen efter enstaka Codex-fel/timeout; avbryt vid upprepade fel, skyddsfel, ändrad Git HEAD, uteblivet framsteg, upprepat verifierat tekniskt grönt resultat eller max 24 timmar.

Ingen del av körningen kontaktar med avsikt Swedbank, Bankgirot, Gmail eller ChatGPT Sites. Kör därför ändå i ett avskilt system med inga verkliga hemligheter, eftersom automatiskt genererad testkod inte kan garanteras vara sidoeffektsfri.

## Rapport, avbrott och färdigställning

- Läs **`.codex-work/autopilot/REPORT.md`** och **`.codex-work/autopilot/state.json`**. Varje varv har egna loggar i `round-001/`, `round-002/`, osv. `.codex-work/` är Git-ignorerad.
- Avsluta säkert med `Ctrl+C`. Efter avbrott kan `py -3 scripts/codex_24h.py --resume` återuppta **samma** kvarvarande tidsfönster och gren. En ny 24-timmarsperiod kräver ny isolerad klon.
- Granska `git diff`, testresultaten och filändringarna innan du manuellt gör `git add`, `git commit`, `git push` och öppnar en PR. Inga automatiska commits eller deployer görs.
- Alla automatiska kontroller gröna innebär bara **kodverifierad kandidat**. Godkänn inte 10/10 utan manuell granskning av anonymiserade, verkliga bank/Bankgiro-underlag, fakturakällor, UI, återställning och produktionsintegrationer. En samlingspost utan individuella betalardetaljer kan inte verifieras av Kodex.

### Fel och begränsningar

Om Codex saknar autentisering, träffar användningsgräns, får timeout eller om körningen ändrar skyddade filer stoppas loopen. `state.json` visar då status, och originalkoden på `main` ändras inte. `npm audit` kräver internet; nätverksfel är **inte** en godkänd säkerhetsgranskning. Välj en separat server/VM som kan vara igång dygnet runt om datorn inte kan det. Starta aldrig med `--dangerously-bypass-approvals-and-sandbox`, `--yolo` eller ett produktionsrepo.

Officiellt exempel för strukturerade Codex-loopar: [OpenAI Cookbook](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex).
