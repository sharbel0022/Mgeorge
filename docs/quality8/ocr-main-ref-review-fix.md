# OCR: färsk main-referens före credential-steget

Datum: 2026-11-05. Rättning av reviewfynd I2 på `9c4a8b0f09e567c02bbf0a0747f74239e56a0df1`.

## Bekräftat problem

Den tidigare grinden jämförde `workflow_run.head_sha` med `github.sha`. Båda hör till den utlösande körningen. En godkänd körning för commit A kunde ligga i kö eller köras om efter att `main` flyttats till B, och ändå använda OCR-hemligheten med A. `github.sha` är den commit som utlöste workflowet, inte en ny avläsning av branchens referens; se [GitHubs kontextreferens](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context).

## Ändrat beteende

`verify-cloud-ocr-trigger.mjs` behåller samtliga tidigare event-, repository-, branch- och SHA-kontroller. Därefter läser den GitHubs fasta endpoint `GET https://api.github.com/repos/{owner}/{repo}/git/ref/heads/main` med workflowets `GITHUB_TOKEN`. Workflowets rättigheter är fortfarande `contents: read`, vilket är den dokumenterade behörigheten för [Get a reference](https://docs.github.com/en/rest/git/refs#get-a-reference). Begäran använder API-version `2026-03-10`, som anges i GitHubs aktuella exempel.

Kontrollen kräver HTTP 200, exakt förväntad svars-URL, `refs/heads/main`, ett commit-objekt och samma SHA som den kod som checkats ut. Både referensens och commit-objektets API-URL måste peka på samma repository. Redirects följs inte. Begäran använder `no-store`/`no-cache`, avbryts efter tio sekunder och begränsar det lästa svaret till 64 KiB. Saknad token, nätfel, timeout, HTTP-fel, felaktig JSON, saknad/annan referens och repo-/SHA-avvikelse nekar körningen. Feltexter och tokenvärden skrivs inte till loggen.

Workflowet kör kontrollen två gånger:

1. Efter pinnad checkout och Node-installation, före dependencyinstallationen.
2. Efter `npm ci --ignore-scripts`, i steget omedelbart före OCR-körningen som får `MG_SITES_OCR_TOKEN`.

Endast kontrollstegen får den läsbehöriga GitHub-tokenen som explicit miljövariabel. OCR-tokenen är fortsatt begränsad till OCR-steget. Pinnade Actions-versioner, aktiveringsflaggan, concurrency, periodiska/manuella triggers och gränsen sex OCR-jobb bevaras.

## Verifiering

Red/green: före implementationen passerade 13 befintliga triggertester medan de 30 nya kontrollerna misslyckades. Efter implementationen passerar **43/43 triggertester**.

Tester täcker aktuell main, köad respektive omkörd A när main är B för `workflow_run`, `schedule` och `workflow_dispatch`, fel repository i referens/commit/svars-URL, annan branch, taggobjekt, saknat objekt, ogiltig SHA, redirects, 404/500, trasig JSON, array/null, för stort svar, saknad token, nätfel och timeout. Ett workflowtest kräver båda kontrollstegen och placerar den andra kontrollen direkt före credential-steget.

Fokuserad regression på Node 24.22.1/Linux gav **84/84 godkända tester**, utan fel eller överhoppade fall, för trigger- och OCR-klienttesterna. Syntaxkontrollen passerade också:

```sh
node --test test/cloud-ocr-trigger.test.js test/sites-ocr-pull.test.js
node --check scripts/verify-cloud-ocr-trigger.mjs
```

Alla HTTP-svar i testerna är syntetiska; inga verkliga GitHub- eller OCR-tokenvärden används och ingen produktions-OCR körs av dessa tester.

## Exakt garanti och kvarstående gränser

En godkänd kontroll visar att den hämtade `main`-referensen motsvarade den checkade committen **vid preflighten**. Den låser inte GitHubs branch. `main` kan flyttas efter kontrollen eller under den efterföljande OCR-körningen; någon garanti mot det påstås inte.

Rättningen gäller körningar som innehåller den nya kontrollen. Den skriver inte om äldre workflowrevisioner. Verklig exekvering på GitHub och faktisk OCR-köprogress måste fortfarande observeras efter integration/publicering. GitHub-avbrott eller otillräcklig läsbehörighet stoppar här OCR-steget säkert och lämnar den beständiga kön till en senare tillåten körning.
